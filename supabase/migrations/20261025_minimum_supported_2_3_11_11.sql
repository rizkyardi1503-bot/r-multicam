-- Required update (2026-10-25): every version before 2.3.11.11 must update (plugin_entitlement UPDATE_REQUIRED).
-- Matches MINIMUM_SUPPORTED in plugin-update-manifest. Applied as migration "minimum_supported_2_3_11_11".
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.plugin_entitlement(text,text,text)'::regprocedure);
  if position('c_min_supported constant text:=''2.3.11.10''' in d) = 0 then raise exception 'unexpected plugin_entitlement definition'; end if;
  d := replace(d, 'c_min_supported constant text:=''2.3.11.10''', 'c_min_supported constant text:=''2.3.11.11''');
  execute d;
end $mig$;
