-- v2.3.11.6 and older must update (2026-10-25): plugin_entitlement answers allowed=false / UPDATE_REQUIRED below
-- 2.3.11.7 (the panel then offers the 2.3.11.9 update). Matches MINIMUM_SUPPORTED in plugin-update-manifest.
-- Applied as migration "minimum_supported_2_3_11_7": only the c_min_supported constant changes.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.plugin_entitlement(text,text,text)'::regprocedure);
  if position('c_min_supported constant text:=''2.3.11.2''' in d) = 0 then raise exception 'unexpected plugin_entitlement definition'; end if;
  d := replace(d, 'c_min_supported constant text:=''2.3.11.2''', 'c_min_supported constant text:=''2.3.11.7''');
  execute d;
end $mig$;
