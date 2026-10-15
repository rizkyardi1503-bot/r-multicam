-- R Project Multicam AI · payment + version hardening (2026-10-15)
-- Run once in the Supabase SQL editor BEFORE deploying the three updated payment functions.
--
-- 1) plugin_payment_orders.checkout_url — lets create-lifetime-checkout re-use an open Midtrans checkout
--    instead of creating a new order on every click.
-- 2) plugin_entitlement: a new release no longer locks out every older version automatically.
--    Before: allowed only if plugin version >= latest public release (plus a grace window that ends
--    2026-10-28). The moment a new version is published, every customer on the previous version is
--    blocked within a minute.
--    After: allowed if plugin version >= c_min_supported. Older-but-supported versions keep working and
--    are told an update is available (update_required=true, reason UPDATE_AVAILABLE).
--    To force an upgrade later, raise c_min_supported deliberately and re-run this function.
-- Signature, SECURITY DEFINER, search_path and grants are unchanged.

BEGIN;

ALTER TABLE public.plugin_payment_orders ADD COLUMN IF NOT EXISTS checkout_url text;

CREATE OR REPLACE FUNCTION public.plugin_entitlement(p_device_id text, p_platform text, p_plugin_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare
  v_uid uuid:=auth.uid();
  v public.plugin_profiles;
  v_allowed boolean;
  v_remaining bigint;
  v_latest text;
  v_is_latest boolean;
  v_supported boolean;
  c_min_supported constant text:='2.3.11.2';
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v from public.plugin_profiles where user_id=v_uid for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v.device_id is not null and v.device_id<>p_device_id then
    return jsonb_build_object('allowed',false,'license_status',v.license_status,'email',v.email,'session_replaced',true,'reason','SIGNED_IN_ON_ANOTHER_DEVICE','server_time',now());
  end if;
  update public.plugin_profiles set last_active_at=now(),plugin_version=p_plugin_version,device_platform=p_platform,
    license_status=case when license_status='trial' and trial_expires_at<=now() then 'expired' else license_status end,updated_at=now()
    where user_id=v_uid returning * into v;
  v_latest:=plugin_release_internal.latest_public(p_platform);
  v_is_latest:=coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(v_latest),false);
  v_supported:=v_is_latest or coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(c_min_supported),false);
  v_allowed:=v_supported AND (v.license_status='lifetime' or (v.license_status='trial' and v.trial_expires_at>now()));
  v_remaining:=case when v.license_status='lifetime' then null else greatest(0,floor(extract(epoch from (v.trial_expires_at-now())))::bigint) end;
  return jsonb_build_object('allowed',v_allowed,'license_status',v.license_status,'email',v.email,'device_id',v.device_id,
    'trial_started_at',v.trial_started_at,'trial_expires_at',v.trial_expires_at,'remaining_seconds',v_remaining,
    'update_required',NOT v_is_latest,
    'minimum_version',c_min_supported,
    'latest_version',v_latest,
    'grace_until',null,
    'update_url','https://r-multicam.pages.dev/',
    'reason',CASE WHEN NOT v_supported THEN 'UPDATE_REQUIRED' WHEN NOT v_is_latest THEN 'UPDATE_AVAILABLE' ELSE NULL END,
    'server_time',now());
end $function$;

COMMIT;

-- Check afterwards (should list checkout_url):
--   select column_name from information_schema.columns where table_name='plugin_payment_orders' and column_name='checkout_url';
