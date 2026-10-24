-- Signing key for the plugin's offline grace (edge function plugin-entitlement-signed).
--
-- The Ed25519 private key is stored in Supabase Vault, never in the repo or in a migration. Secret name:
-- 'plugin_entitlement_signing_key', value = JSON {"key_id":"<id>","pkcs8":"<base64 PKCS#8 DER private key>"}.
-- Insert it once by hand (SQL editor), e.g.:
--   select vault.create_secret('<json>', 'plugin_entitlement_signing_key', 'Ed25519 key for plugin-entitlement-signed');
-- Rotate with vault.update_secret(<id>, '<new json>') and ship the new public key + key_id in account-auth.js.
--
-- Only service_role may read it, through this SECURITY DEFINER function. It lives in public so the edge
-- function can call it via PostgREST; EXECUTE is revoked from PUBLIC, anon and authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.plugin_entitlement_signing_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'plugin_entitlement_signing_key' limit 1
$function$;

REVOKE ALL ON FUNCTION public.plugin_entitlement_signing_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plugin_entitlement_signing_key() TO service_role;

COMMIT;

-- Check afterwards (anon/authenticated must be false, service_role true):
--   select r, has_function_privilege(r, 'public.plugin_entitlement_signing_key()', 'execute')
--   from unnest(array['anon','authenticated','service_role']) r;
