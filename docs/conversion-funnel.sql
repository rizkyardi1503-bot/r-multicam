-- Owner-only report: run in the Supabase SQL editor or authenticated management tool.
-- Never expose this query as an anonymous RPC or publish its results with customer identities.
-- Rolling 30-day, first observed website-touch cohort; not lifetime acquisition attribution.
-- Optional stages can be skipped. Each metric is distinct visitors, not total clicks.
-- New accounts / actual activation / payment use server records, not client claims.
WITH events AS (
 SELECT * FROM public.website_analytics_events
 WHERE occurred_at >= now() - interval '30 days'
 AND coalesce(metadata->>'reporting_exclude','false') <> 'true'
 AND coalesce(utm_source,'') NOT IN ('qa','test')
), touches AS (
 SELECT DISTINCT ON (visitor_id) visitor_id, occurred_at AS touched_at,
 CASE WHEN lower(utm_source) IN ('ig','insta','instagram') THEN 'instagram'
 WHEN lower(utm_source) IN ('thread','threads') THEN 'threads'
 ELSE coalesce(utm_source,CASE WHEN referrer_host IS NOT NULL THEN 'referral' ELSE 'direct_or_unknown' END) END AS source,
 coalesce(utm_medium,'unknown') AS medium, coalesce(utm_campaign,'none') AS campaign,
 coalesce(metadata->>'content_id','none') AS content_id
 FROM events WHERE event_name='page_view' AND visitor_id IS NOT NULL
 ORDER BY visitor_id, occurred_at, id
), identities AS (
 SELECT visitor_id, count(DISTINCT user_id) AS accounts,
 (array_agg(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL))[1] AS user_id
 FROM events WHERE user_id IS NOT NULL GROUP BY visitor_id
), flags AS (
 SELECT t.*, coalesce(i.accounts,0)>1 AS ambiguous_identity,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='demo_started') AS demo,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='pricing_view') AS pricing,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='guide_opened') AS guide,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='compatibility_checked') AS compatibility,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='trial_cta_clicked') AS trial_cta,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='signup_submitted') AS signup_submit,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='download_started') AS download,
 EXISTS(SELECT 1 FROM events e WHERE e.visitor_id=t.visitor_id AND e.event_name='checkout_opened') AS checkout_open,
 i.accounts=1 AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=i.user_id AND u.created_at>=t.touched_at) AS new_account,
 i.accounts=1 AND EXISTS(SELECT 1 FROM public.plugin_profiles p WHERE p.user_id=i.user_id AND p.first_activated_at>=t.touched_at) AS plugin_activation,
 i.accounts=1 AND EXISTS(SELECT 1 FROM public.plugin_profiles p WHERE p.user_id=i.user_id AND p.trial_started_at>=t.touched_at) AS trial_activation,
 i.accounts=1 AND EXISTS(SELECT 1 FROM public.plugin_payment_orders o WHERE o.user_id=i.user_id
 AND o.paid_at>=t.touched_at AND o.status IN ('settlement','capture')
 AND (o.fraud_status IS NULL OR lower(o.fraud_status)='accept')) AS verified_paid
 FROM touches t LEFT JOIN identities i USING(visitor_id)
)
SELECT source, medium, campaign, content_id, count(*) AS observed_visitors,
 count(*) FILTER(WHERE demo) AS demo_visitors, count(*) FILTER(WHERE pricing) AS pricing_visitors,
 count(*) FILTER(WHERE guide) AS guide_visitors, count(*) FILTER(WHERE compatibility) AS compatibility_visitors,
 count(*) FILTER(WHERE trial_cta) AS trial_cta_visitors,
 count(*) FILTER(WHERE signup_submit) AS signup_submit_visitors,
 count(*) FILTER(WHERE new_account) AS new_account_visitors,
 count(*) FILTER(WHERE download) AS download_visitors,
 count(*) FILTER(WHERE plugin_activation) AS actual_plugin_activation_visitors,
 count(*) FILTER(WHERE trial_activation) AS actual_trial_activation_visitors,
 count(*) FILTER(WHERE checkout_open) AS checkout_open_visitors,
 count(*) FILTER(WHERE verified_paid) AS server_verified_paid_visitors,
 count(*) FILTER(WHERE ambiguous_identity) AS identity_ambiguity_visitors,
 round(100.0*count(*) FILTER(WHERE trial_activation)/nullif(count(*),0),2) AS visitor_to_trial_pct,
 round(100.0*count(*) FILTER(WHERE verified_paid)/nullif(count(*),0),2) AS visitor_to_paid_pct
FROM flags GROUP BY source,medium,campaign,content_id ORDER BY observed_visitors DESC;
-- Limitations: blockers, cleared storage, bots and cross-device navigation can under/overcount.
-- Anonymous signup without a later authenticated event cannot be joined safely.
-- A visitor may be counted in more than one historical cohort; this is not a revenue ledger.
-- Do not sum paid visitors as unique customers or revenue; use payment orders for finance.
