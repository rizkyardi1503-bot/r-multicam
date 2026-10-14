-- v2.3.11.3 release: 14-day grace period for v2.3.11.2.
-- Before: any plugin older than the latest public version (from plugin-update-manifest) was blocked at once.
-- After:  v2.3.11.2 keeps working until 2026-10-28 23:59 WITA (UTC+8) while still being told an update is
--         available (update_required=true). Older versions stay blocked. After the date this behaves exactly
--         like before, so the change expires by itself.
-- Only plugin_entitlement changes; signature, SECURITY DEFINER, search_path and grants are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.plugin_entitlement(p_device_id text, p_platform text, p_plugin_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare
  v_uid uuid:=auth.uid();
  v public.plugin_profiles;
  v_allowed boolean;
  v_remaining bigint;
  v_latest text;
  v_supported boolean;
  v_grace boolean;
  c_grace_min constant text:='2.3.11.2';
  c_grace_until constant timestamptz:=timestamptz '2026-10-28 23:59:59+08';
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
  v_supported:=coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(v_latest),false);
  v_grace:=(not v_supported) and now()<c_grace_until
    and coalesce(plugin_release_internal.version_parts(p_plugin_version)>=plugin_release_internal.version_parts(c_grace_min),false);
  v_allowed:=(v_supported or v_grace) AND (v.license_status='lifetime' or (v.license_status='trial' and v.trial_expires_at>now()));
  v_remaining:=case when v.license_status='lifetime' then null else greatest(0,floor(extract(epoch from (v.trial_expires_at-now())))::bigint) end;
  return jsonb_build_object('allowed',v_allowed,'license_status',v.license_status,'email',v.email,'device_id',v.device_id,
    'trial_started_at',v.trial_started_at,'trial_expires_at',v.trial_expires_at,'remaining_seconds',v_remaining,
    'update_required',NOT v_supported,
    'minimum_version',case when v_grace then c_grace_min else v_latest end,
    'latest_version',v_latest,
    'grace_until',case when v_grace then c_grace_until else null end,
    'update_url','https://r-multicam.pages.dev/',
    'reason',CASE WHEN v_grace THEN 'UPDATE_AVAILABLE_GRACE' WHEN NOT v_supported THEN 'UPDATE_REQUIRED' ELSE NULL END,
    'server_time',now());
end $function$;
COMMIT;

-- Rollback (restores the previous behaviour immediately): re-run this file with
--   c_grace_until constant timestamptz:=timestamptz '2000-01-01 00:00:00+00';
