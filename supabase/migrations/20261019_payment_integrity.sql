-- Payment integrity (2026-10-19).
-- 1. Every Midtrans transaction_status can be stored. Before, chargeback/partial_chargeback/authorize/failure
--    failed the CHECK, the webhook answered 500 and Midtrans retried forever while the order stayed "settlement".
-- 2. A chargeback voids the affiliate commission, like a refund already does.
-- 3. Owner alerts written by the webhook (refund, paid but not activated, duplicate payment) pass the event CHECK.
-- 4. At most one open (created/pending, unpaid) order per customer, so two clicks cannot create two payable orders.
--    Older open orders are expired first: their Snap links expired 24 h after creation.

alter table public.plugin_payment_orders drop constraint plugin_payment_orders_status_check;
alter table public.plugin_payment_orders add constraint plugin_payment_orders_status_check check (status = any (array[
  'created','pending','authorize','capture','settlement','deny','cancel','expire','failure',
  'refund','partial_refund','chargeback','partial_chargeback','failed']));

create or replace function public.record_affiliate_commission()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
 if new.affiliate_user_id is null then return new; end if;
 if new.status in ('refund','partial_refund','chargeback','partial_chargeback','cancel','deny','expire','failure','failed') then
  update public.plugin_affiliate_commissions set status='void' where order_id=new.order_id;
 elsif new.status in ('settlement','capture') and new.paid_at is not null and new.lifetime_activated_at is not null then
  insert into public.plugin_affiliate_commissions(user_id,order_id,amount_idr,available_at)
  values(new.affiliate_user_id,new.order_id,round(new.gross_amount_idr*new.affiliate_commission_percent/100.0),new.paid_at+interval '14 days') on conflict(order_id) do nothing;
 end if;
 return new;
end $function$;

alter table public.website_analytics_events drop constraint website_analytics_event_name_chk;
alter table public.website_analytics_events add constraint website_analytics_event_name_chk check (event_name = any (array[
  'page_view','pricing_view','trial_cta_clicked','demo_started','signup_submitted','login_success','download_requested',
  'download_started','checkout_started','checkout_created','purchase_paid','guide_opened','compatibility_checked',
  'checkout_opened','purchase_refunded','purchase_paid_not_activated','purchase_duplicate']));

update public.plugin_payment_orders set status='expire', updated_at=now()
 where status in ('created','pending') and paid_at is null and created_at < now() - interval '24 hours';

create unique index if not exists plugin_payment_orders_one_open_per_user
 on public.plugin_payment_orders (user_id) where status in ('created','pending') and paid_at is null;
