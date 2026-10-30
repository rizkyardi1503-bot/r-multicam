-- Least privilege for the browser roles (2026-10-30). Written for the release; apply with the release step.
-- information_schema.role_table_grants (2026-10-30) showed:
--   anon + authenticated: TRUNCATE on plugin_events, plugin_profiles, website_analytics_events;
--   authenticated:        TRUNCATE on plugin_payment_orders;
--   anon + authenticated: INSERT, UPDATE, DELETE on website_analytics_events.
-- Row level security does not apply to TRUNCATE. Nothing in the website or plugin writes these tables with the anon or
-- user key: every write goes through Edge Functions with the service role. SELECT stays (RLS: own rows only).

BEGIN;

revoke truncate on table public.plugin_events, public.plugin_payment_orders, public.plugin_profiles,
  public.website_analytics_events from anon, authenticated;
revoke insert, update, delete on table public.website_analytics_events from anon, authenticated;

COMMIT;
