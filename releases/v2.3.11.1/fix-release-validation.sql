BEGIN;
CREATE OR REPLACE FUNCTION plugin_release_internal.latest_public(request_platform text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE p text:=CASE WHEN lower(coalesce(request_platform,'')) IN ('macos','darwin') THEN 'macos' ELSE 'windows' END;
 cached text; incoming text; payload jsonb; response extensions.http_response;
BEGIN
 SELECT version INTO cached FROM plugin_release_internal.current_release WHERE platform=p;
 BEGIN
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','3000');
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','1500');
  response:=extensions.http_get('https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-manifest?platform='||p);
  IF response.status<>200 THEN RETURN cached; END IF;
  payload:=response.content::jsonb; incoming:=payload->>'version';
  -- [.] avoids the previous incorrectly doubled backslash escaping.
  IF incoming IS NULL OR incoming !~ '^[0-9]{1,9}[.][0-9]{1,9}[.][0-9]{1,9}[.][0-9]{1,9}$'
   OR payload->>'platform' IS DISTINCT FROM p
   OR coalesce(payload->>(p||'_sha256'),'') !~ '^[a-fA-F0-9]{64}$'
   OR coalesce(payload->>(p||'_download'),'') NOT LIKE 'https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download?%'
  THEN RETURN cached; END IF;
  UPDATE plugin_release_internal.current_release SET version=incoming,checked_at=now()
   WHERE platform=p AND plugin_release_internal.version_parts(incoming)>=plugin_release_internal.version_parts(version);
  SELECT version INTO cached FROM plugin_release_internal.current_release WHERE platform=p;
 EXCEPTION WHEN OTHERS THEN RETURN cached;
 END;
 RETURN cached;
END $$;
REVOKE ALL ON FUNCTION plugin_release_internal.latest_public(text) FROM PUBLIC,anon,authenticated;
COMMIT;
