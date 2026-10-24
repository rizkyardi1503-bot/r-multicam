-- Applied 2026-10-25 together with 20261018 (migration "entitlement_signing_key"): one-time helper used by the
-- temporary edge function setup-entitlement-key, which generated the Ed25519 key inside Supabase, stored it in Vault
-- as 'plugin_entitlement_signing_key' ({"key_id":"k1-2026-10","pkcs8":...,"public":...}) and returned only the public
-- key (embedded in account-auth.js SIGN_KEYS). The helper only inserts when no key exists yet and only service_role
-- may call it. It can be dropped: DROP FUNCTION IF EXISTS public.plugin_entitlement_signing_key_store(text);
CREATE OR REPLACE FUNCTION public.plugin_entitlement_signing_key_store(p_secret text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
begin
  if exists (select 1 from vault.secrets where name = 'plugin_entitlement_signing_key') then return false; end if;
  perform vault.create_secret(p_secret, 'plugin_entitlement_signing_key', 'Ed25519 key for plugin-entitlement-signed');
  return true;
end $function$;
REVOKE ALL ON FUNCTION public.plugin_entitlement_signing_key_store(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plugin_entitlement_signing_key_store(text) TO service_role;
