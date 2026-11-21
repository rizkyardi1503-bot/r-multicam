-- Subscriptions, phase 1 (owner approved 2026-11-21; see docs/subscriptions-phase-1.md).
-- Prepaid monthly (30 days) and annual (365 days) plans next to lifetime. Additive: trial and lifetime accounts keep
-- exactly the access they have today, and panels since 2.3.11.11 need no update (they follow `allowed`).

-- 1. Profiles: subscription end, current plan, founder price.
alter table public.plugin_profiles
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists subscription_plan text,
  add column if not exists founder_price_locked boolean not null default false;

alter table public.plugin_profiles drop constraint if exists plugin_profiles_license_status_check;
alter table public.plugin_profiles add constraint plugin_profiles_license_status_check
  check (license_status = any (array['trial', 'lifetime', 'expired', 'blocked', 'subscription']));
alter table public.plugin_profiles drop constraint if exists plugin_profiles_subscription_plan_check;
alter table public.plugin_profiles add constraint plugin_profiles_subscription_plan_check
  check (subscription_plan is null or subscription_plan = any (array['monthly_v1', 'annual_v1']));
alter table public.plugin_profiles drop constraint if exists plugin_profiles_subscription_state_check;
alter table public.plugin_profiles add constraint plugin_profiles_subscription_state_check
  check (license_status <> 'subscription' or (subscription_expires_at is not null and subscription_plan is not null));

-- 2. Orders: the three products, and whether the order carries the founder price (monthly only, never with a promo).
-- lifetime_activated_at now means "access granted from this order" for every product: the affiliate commission trigger
-- and the owner dashboard revenue already key on it.
alter table public.plugin_payment_orders
  add column if not exists founder_price boolean not null default false;
alter table public.plugin_payment_orders drop constraint if exists plugin_payment_orders_product_code_check;
alter table public.plugin_payment_orders add constraint plugin_payment_orders_product_code_check
  check (product_code = any (array['lifetime_v1', 'monthly_v1', 'annual_v1']));
alter table public.plugin_payment_orders drop constraint if exists plugin_payment_orders_founder_price_check;
alter table public.plugin_payment_orders add constraint plugin_payment_orders_founder_price_check
  check (not founder_price or (product_code = 'monthly_v1' and affiliate_code is null));

-- 3. Guard: lifetime can only come from a lifetime order. Code that predates plans (or a rolled-back function) would
-- otherwise write lifetime for any paid order; this makes such a write fail, so Midtrans retries until the current code
-- grants the plan instead. Lifetime set by hand without an order id (owner grants) is unaffected.
create or replace function public.guard_lifetime_from_lifetime_order()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.license_status = 'lifetime' and new.lifetime_order_id is distinct from old.lifetime_order_id
     and new.lifetime_order_id is not null
     and not exists (select 1 from public.plugin_payment_orders
                      where order_id = new.lifetime_order_id and product_code = 'lifetime_v1') then
    raise exception 'LIFETIME_NEEDS_LIFETIME_ORDER';
  end if;
  return new;
end $function$;

create or replace trigger guard_lifetime_from_lifetime_order before update on public.plugin_profiles
  for each row execute function public.guard_lifetime_from_lifetime_order();

-- 4. Grant a paid plan order exactly once (webhook, check-payment and checkout reconcile may all try).
-- The order row is locked first, then the profile; the stamp and the new end date commit together.
create or replace function public.grant_subscription_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.plugin_payment_orders;
  p public.plugin_profiles;
  v_days integer;
  v_end timestamptz;
  v_founder boolean;
begin
  select * into o from public.plugin_payment_orders where order_id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND'); end if;
  if o.product_code is distinct from 'monthly_v1' and o.product_code is distinct from 'annual_v1' then
    return jsonb_build_object('ok', false, 'reason', 'NOT_SUBSCRIPTION');
  end if;
  if o.paid_at is null then return jsonb_build_object('ok', false, 'reason', 'NOT_PAID'); end if;
  -- A paid order is settlement/capture until the money goes back (refund, chargeback, merchant cancel).
  if o.status not in ('settlement', 'capture') then return jsonb_build_object('ok', false, 'reason', 'REFUNDED'); end if;
  select * into p from public.plugin_profiles where user_id = o.user_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_NOT_FOUND'); end if;
  if o.lifetime_activated_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'license_status', p.license_status,
      'subscription_expires_at', p.subscription_expires_at, 'subscription_plan', p.subscription_plan);
  end if;
  if p.license_status = 'blocked' then return jsonb_build_object('ok', false, 'reason', 'BLOCKED'); end if;
  if p.license_status = 'lifetime' then return jsonb_build_object('ok', false, 'reason', 'ALREADY_LIFETIME'); end if;
  v_days := case o.product_code when 'monthly_v1' then 30 else 365 end;
  -- Paying early adds the days on top of an ACTIVE plan only. Any other state (trial, lapsed, or a plan the owner
  -- revoked by hand after a refund) starts from now, so revoked days never come back.
  v_end := case when p.license_status = 'subscription' and p.subscription_expires_at > now()
                then p.subscription_expires_at else now() end + make_interval(days => v_days);
  -- The founder price sticks to the first 100 accounts only: a founder checkout opened while spots were left but paid
  -- after they ran out is honoured for that payment, without keeping the price for renewals.
  v_founder := p.founder_price_locked;
  if o.founder_price and not p.founder_price_locked then
    perform pg_advisory_xact_lock(hashtext('plugin_founder_price_slots'));
    v_founder := (select count(*) from public.plugin_profiles where founder_price_locked) < 100;
  end if;
  update public.plugin_profiles
     set license_status = 'subscription',
         subscription_expires_at = v_end,
         subscription_plan = o.product_code,
         founder_price_locked = v_founder,
         updated_at = now()
   where user_id = o.user_id;
  update public.plugin_payment_orders set lifetime_activated_at = now(), updated_at = now() where order_id = o.order_id;
  return jsonb_build_object('ok', true, 'already', false, 'license_status', 'subscription',
    'subscription_expires_at', v_end, 'subscription_plan', o.product_code, 'period_days', v_days);
end $function$;

revoke all on function public.grant_subscription_order(text) from public, anon, authenticated;
grant execute on function public.grant_subscription_order(text) to service_role;

-- 5. Public price facts for the pricing page (no personal data: one aggregate count).
create or replace function public.subscription_pricing()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'monthly_idr', 99000,
    'monthly_founder_idr', 59000,
    'annual_idr', 799000,
    'lifetime_idr', 2000000,
    'founder_limit', 100,
    'founder_slots_left', greatest(0, 100 - (select count(*) from public.plugin_profiles where founder_price_locked)),
    'lifetime_sales_end', '2026-12-01T00:00:00+08:00'
  )
$function$;

revoke all on function public.subscription_pricing() from public;
grant execute on function public.subscription_pricing() to anon, authenticated, service_role;

-- 6. Entitlement: an active subscription is allowed like an active trial. For panels released before plans existed,
-- trial_expires_at / remaining_seconds carry the subscription end so their countdown is right (they label it TRIAL).
-- The minimum-version exemption now follows the owner role instead of a hard-coded address (same single account).
create or replace function public.plugin_entitlement(p_device_id text, p_platform text, p_plugin_version text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v public.plugin_profiles;
  v_allowed boolean;
  v_remaining bigint;
  v_access_until timestamptz;
  v_latest text;
  v_is_latest boolean;
  v_supported boolean;
  c_min_supported constant text:='2.3.11.11';
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v from public.plugin_profiles where user_id=v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v.device_id is not null and v.device_id<>p_device_id then
    return jsonb_build_object('allowed',false,'license_status',v.license_status,'email',v.email,'session_replaced',true,'reason','SIGNED_IN_ON_ANOTHER_DEVICE','server_time',now());
  end if;
  update public.plugin_profiles set last_active_at=now(),plugin_version=p_plugin_version,device_platform=p_platform,
    license_status=case
      when license_status='trial' and trial_expires_at<=now() then 'expired'
      when license_status='subscription' and (subscription_expires_at is null or subscription_expires_at<=now()) then 'expired'
      else license_status end,
    updated_at=now()
    where user_id=v_uid returning * into v;
  v_latest:=plugin_release_internal.latest_public(p_platform);
  v_is_latest:=coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(v_latest),false);
  v_supported:=v_is_latest or coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(c_min_supported),false)
    or exists(select 1 from auth.users u join public.plugin_profiles op on op.user_id=u.id
              where u.id=v_uid and u.email_confirmed_at is not null and op.account_role='owner');
  v_allowed:=v_supported AND (v.license_status='lifetime'
    or (v.license_status='trial' and v.trial_expires_at>now())
    or (v.license_status='subscription' and v.subscription_expires_at>now()));
  -- The later of the trial end and the plan end: a plan bought during the trial always ends later, and a lapsed plan
  -- then reports 0 remaining instead of an old trial date.
  v_access_until:=case when v.subscription_expires_at is not null and (v.trial_expires_at is null or v.subscription_expires_at>v.trial_expires_at)
    then v.subscription_expires_at else v.trial_expires_at end;
  v_remaining:=case when v.license_status='lifetime' then null else greatest(0,floor(extract(epoch from (v_access_until-now())))::bigint) end;
  return jsonb_build_object('allowed',v_allowed,'license_status',v.license_status,'email',v.email,'device_id',v.device_id,
    'trial_started_at',v.trial_started_at,'trial_expires_at',v_access_until,'remaining_seconds',v_remaining,
    'subscription_expires_at',v.subscription_expires_at,'subscription_plan',v.subscription_plan,
    'update_required',NOT v_is_latest,
    'minimum_version',c_min_supported,
    'latest_version',v_latest,
    'grace_until',null,
    'update_url','https://r-multicam.pages.dev/',
    'reason',CASE WHEN NOT v_supported THEN 'UPDATE_REQUIRED' WHEN NOT v_is_latest THEN 'UPDATE_AVAILABLE' ELSE NULL END,
    'server_time',now());
end $function$;
