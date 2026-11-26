-- Trial abuse guard (owner approved 2026-11-22).
-- A new account used to get a fresh 7-day trial on any computer, so a new email address meant a new trial on the same
-- machine. From now on a trial is refused, and the account is expired, when:
--   DEVICE_ALREADY_TRIALED  the computer already ran a trial for another account. This is checked when the trial starts
--                           and again whenever an account in its trial signs in on another computer, so a trial started
--                           elsewhere cannot be carried onto a computer that already had one. The plugin's device ID comes
--                           from the hardware (MachineGuid on Windows, IOPlatformUUID on macOS), so reinstalling does not
--                           change it;
--   DISPOSABLE_EMAIL        the email domain is a throwaway inbox service (public.plugin_disposable_domains);
--   EMAIL_ALREADY_TRIALED   the same mailbox already had a trial under another account (Gmail ignores dots and +tags).
-- Computers the owner account signs in on are exempt, so the owner can still test with new accounts.
-- Every refusal is logged in public.plugin_trial_denials. To give a refused account its trial by hand:
--   update public.plugin_profiles set license_status = 'trial', trial_started_at = now(),
--     trial_expires_at = now() + interval '7 days', updated_at = now() where user_id = '<user id>';

-- 1. Computers that have run a free trial, keyed by the canonical device ID (upper case, trimmed). No foreign key: the
-- mark must outlive a deleted account.
create table if not exists public.plugin_trial_devices (
  device_id text primary key,
  first_user_id uuid,
  owner_exempt boolean not null default false,
  first_seen_at timestamptz not null default now()
);
alter table public.plugin_trial_devices enable row level security;
revoke all on table public.plugin_trial_devices from anon, authenticated;

-- 2. Refused trials. The email is not copied here; the profile already has it.
create table if not exists public.plugin_trial_denials (
  id bigserial primary key,
  user_id uuid not null,
  device_id text,
  reason text not null check (reason in ('DEVICE_ALREADY_TRIALED', 'DISPOSABLE_EMAIL', 'EMAIL_ALREADY_TRIALED')),
  created_at timestamptz not null default now()
);
create index if not exists plugin_trial_denials_created_idx on public.plugin_trial_denials (created_at desc);
alter table public.plugin_trial_denials enable row level security;
revoke all on table public.plugin_trial_denials from anon, authenticated;
revoke all on sequence public.plugin_trial_denials_id_seq from anon, authenticated;

-- 3. Throwaway inbox domains. Add more with: insert into public.plugin_disposable_domains values ('example.com');
create table if not exists public.plugin_disposable_domains (domain text primary key check (domain = lower(domain)));
alter table public.plugin_disposable_domains enable row level security;
revoke all on table public.plugin_disposable_domains from anon, authenticated;
insert into public.plugin_disposable_domains (domain) values
  ('mailinator.com'), ('mailinator.net'), ('mailinator2.com'), ('guerrillamail.com'), ('guerrillamail.net'),
  ('guerrillamail.org'), ('guerrillamail.biz'), ('guerrillamailblock.com'), ('sharklasers.com'), ('grr.la'),
  ('pokemail.net'), ('spam4.me'), ('10minutemail.com'), ('10minutemail.net'), ('10minutemail.co.uk'),
  ('20minutemail.com'), ('temp-mail.org'), ('temp-mail.io'), ('temp-mail.ru'), ('tempmail.com'), ('tempmail.net'),
  ('tempmail.dev'), ('tempmail.plus'), ('tempmailo.com'), ('tempail.com'), ('tempr.email'), ('tempinbox.com'),
  ('temporary-mail.net'), ('yopmail.com'), ('yopmail.net'), ('yopmail.fr'), ('throwawaymail.com'), ('trashmail.com'),
  ('trashmail.net'), ('trashmail.de'), ('getnada.com'), ('nada.email'), ('dispostable.com'), ('maildrop.cc'),
  ('mailnesia.com'), ('mintemail.com'), ('mohmal.com'), ('emailondeck.com'), ('fakeinbox.com'), ('mytemp.email'),
  ('moakt.com'), ('tmail.ws'), ('tmpmail.org'), ('tmpmail.net'), ('burnermail.io'), ('inboxkitten.com'),
  ('mailpoof.com'), ('emailfake.com'), ('generator.email'), ('dropmail.me'), ('1secmail.com'), ('1secmail.net'),
  ('1secmail.org'), ('mail.tm'), ('mail.gw'), ('minuteinbox.com'), ('discard.email'), ('harakirimail.com'),
  ('mailcatch.com'), ('mailsac.com'), ('spambox.us'), ('getairmail.com'), ('spamgourmet.com'), ('mailexpire.com'),
  ('jetable.org'), ('incognitomail.org'), ('fexpost.com'), ('fexbox.org'), ('linshiyouxiang.net')
on conflict (domain) do nothing;

-- 4. One spelling per mailbox: lowercase, no +tag; Gmail also ignores dots and googlemail.com is gmail.com.
create or replace function public.plugin_normalize_email(p_email text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_email is null or position('@' in p_email) = 0 then lower(p_email)
    when lower(split_part(p_email, '@', 2)) in ('gmail.com', 'googlemail.com')
      then replace(split_part(lower(split_part(p_email, '@', 1)), '+', 1), '.', '') || '@gmail.com'
    else split_part(lower(split_part(p_email, '@', 1)), '+', 1) || '@' || lower(split_part(p_email, '@', 2))
  end
$function$;
revoke all on function public.plugin_normalize_email(text) from public, anon, authenticated;

-- 5. Backfill: computers used while an account was in its trial, the earliest account first; computers the owner
-- account has used are exempt. Computers customers moved to only after buying are not marked.
insert into public.plugin_trial_devices (device_id, first_user_id, first_seen_at)
select distinct on (upper(btrim(e.device_id))) upper(btrim(e.device_id)), e.user_id, e.created_at
from public.plugin_events e
join public.plugin_profiles p on p.user_id = e.user_id
where e.device_id is not null and p.trial_started_at is not null and e.created_at <= p.trial_expires_at
order by upper(btrim(e.device_id)), e.created_at
on conflict (device_id) do nothing;

insert into public.plugin_trial_devices (device_id, first_user_id, first_seen_at)
select upper(btrim(p.device_id)), p.user_id, coalesce(p.trial_started_at, now())
from public.plugin_profiles p
where p.device_id is not null and p.trial_started_at is not null and p.license_status not in ('lifetime', 'subscription')
on conflict (device_id) do nothing;

insert into public.plugin_trial_devices (device_id, first_user_id, owner_exempt, first_seen_at)
select x.device_id, x.user_id, true, now()
from (
  select upper(btrim(e.device_id)) as device_id, e.user_id from public.plugin_events e
  join public.plugin_profiles o on o.user_id = e.user_id and o.account_role = 'owner'
  where e.device_id is not null
  union
  select upper(btrim(o.device_id)), o.user_id from public.plugin_profiles o
  where o.account_role = 'owner' and o.device_id is not null
) x
on conflict (device_id) do update set owner_exempt = true;

-- 6. Sign-in on a computer (same contract and return value as before). The trial starts on the first sign-in, as before,
-- unless one of the reasons above applies; then the account is expired and the refusal is logged.
create or replace function public.register_plugin_device(p_device_id text, p_platform text, p_plugin_version text)
returns public.plugin_profiles
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_device_key text := upper(btrim(p_device_id));
  v_profile public.plugin_profiles;
  v_starts_trial boolean;
  v_in_trial boolean;
  v_norm text;
  v_reason text;
  v_device public.plugin_trial_devices;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Every plugin build sends RP-XXXX-XXXX-XXXX-XXXX (hex); anything else is not a real computer.
  if v_device_key is null or v_device_key !~ '^RP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' then
    raise exception 'INVALID_DEVICE_ID';
  end if;

  -- Create the account row first (a concurrent first sign-in or a website checkout may do the same), then lock it.
  insert into public.plugin_profiles (user_id, email, license_status) values (v_uid, v_email, 'trial')
  on conflict (user_id) do nothing;
  select * into v_profile from public.plugin_profiles where user_id = v_uid for update;

  -- A trial starts once per account; an account already in its trial is checked again on every computer it moves to.
  v_starts_trial := v_profile.license_status = 'trial' and v_profile.trial_started_at is null and v_profile.trial_expires_at is null;
  v_in_trial := v_profile.license_status = 'trial' and v_profile.trial_started_at is not null and v_profile.trial_expires_at > now();

  if (v_starts_trial or v_in_trial) and v_profile.account_role is distinct from 'owner' then
    -- One decision at a time per computer and per mailbox, so two new accounts cannot both win (always device first).
    perform pg_advisory_xact_lock(hashtext('plugin_trial_device:' || v_device_key));
    select * into v_device from public.plugin_trial_devices where device_id = v_device_key;
    -- The owner's computers are trusted: test accounts there always get their trial.
    if not coalesce(v_device.owner_exempt, false) then
      if v_starts_trial then
        v_norm := public.plugin_normalize_email(coalesce(v_email, v_profile.email));
        perform pg_advisory_xact_lock(hashtext('plugin_trial_email:' || coalesce(v_norm, '')));
        if exists (select 1 from public.plugin_disposable_domains d where d.domain = split_part(v_norm, '@', 2)) then
          v_reason := 'DISPOSABLE_EMAIL';
        elsif exists (select 1 from public.plugin_profiles o
                       where o.user_id <> v_uid and o.trial_started_at is not null
                         and public.plugin_normalize_email(o.email) = v_norm) then
          v_reason := 'EMAIL_ALREADY_TRIALED';
        end if;
      end if;
      if v_reason is null and v_device.device_id is not null and v_device.first_user_id is distinct from v_uid then
        v_reason := 'DEVICE_ALREADY_TRIALED';
      end if;
    end if;
  end if;

  update public.plugin_profiles set
    email = coalesce(v_email, email),
    device_id = p_device_id,
    device_platform = p_platform,
    plugin_version = p_plugin_version,
    last_active_at = now(),
    updated_at = now(),
    first_activated_at = coalesce(first_activated_at, now()),
    trial_started_at = case when v_starts_trial then now() else trial_started_at end,
    trial_expires_at = case
      when v_reason is not null then now()
      when v_starts_trial then now() + interval '7 days'
      else trial_expires_at end,
    license_status = case
      when v_reason is not null then 'expired'
      when license_status = 'trial' and trial_expires_at <= now() then 'expired'
      else license_status end
  where user_id = v_uid
  returning * into v_profile;

  if v_reason is not null then
    insert into public.plugin_trial_denials (user_id, device_id, reason) values (v_uid, v_device_key, v_reason);
  elsif v_profile.account_role = 'owner' then
    insert into public.plugin_trial_devices (device_id, first_user_id, owner_exempt) values (v_device_key, v_uid, true)
    on conflict (device_id) do update set owner_exempt = true;
  elsif v_profile.license_status = 'trial' and v_profile.trial_started_at is not null then
    -- A computer an account in its trial signs in on counts as used; the first account keeps the mark.
    insert into public.plugin_trial_devices (device_id, first_user_id) values (v_device_key, v_uid)
    on conflict (device_id) do nothing;
  end if;

  insert into public.plugin_events (user_id, event_type, device_id, plugin_version, platform)
  values (v_uid, 'plugin_open', p_device_id, p_plugin_version, p_platform);
  return v_profile;
end $function$;

revoke all on function public.register_plugin_device(text, text, text) from public, anon;
grant execute on function public.register_plugin_device(text, text, text) to authenticated, service_role;
