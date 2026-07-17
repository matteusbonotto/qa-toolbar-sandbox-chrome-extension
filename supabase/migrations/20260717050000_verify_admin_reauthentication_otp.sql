begin;

-- The hosted free tier does not allow customizing the default Magic Link
-- template. Use Supabase's built-in reauthentication email instead: it already
-- sends an 8-digit nonce to the confirmed email and requires an authenticated
-- session before sending. This service-role-only function validates that nonce
-- against GoTrue's stored SHA-224 token, consumes it once, and issues the
-- separate 60-minute founder proof used by RLS.
create or replace function public.verify_admin_reauthentication_otp(
  user_id_input uuid,
  challenge_id_input uuid,
  nonce_input text,
  token_hash_input text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  challenge_user_id uuid;
  challenge_email text;
  challenge_created_at timestamptz;
  challenge_expires_at timestamptz;
  challenge_consumed_at timestamptz;
  user_email text;
  reauthentication_token text;
  reauthentication_sent_at timestamptz;
  expected_token text;
  session_expires_at timestamptz;
begin
  if nonce_input !~ '^[0-9]{8}$' or token_hash_input !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_or_expired_otp';
  end if;

  select c.user_id, c.email, c.created_at, c.expires_at, c.consumed_at,
         u.email, u.reauthentication_token, u.reauthentication_sent_at
  into challenge_user_id, challenge_email, challenge_created_at,
       challenge_expires_at, challenge_consumed_at, user_email,
       reauthentication_token, reauthentication_sent_at
  from public.admin_otp_challenges c
  join auth.users u on u.id = c.user_id
  where c.id = challenge_id_input and c.user_id = user_id_input
  for update of c, u;

  if challenge_user_id is null
    or challenge_consumed_at is not null
    or challenge_expires_at <= now()
    or lower(coalesce(challenge_email, '')) <> 'matteusbonotto+admin@gmail.com'
    or lower(coalesce(user_email, '')) <> lower(challenge_email)
    or coalesce(reauthentication_token, '') = ''
    or reauthentication_sent_at is null
    or reauthentication_sent_at < challenge_created_at
    or reauthentication_sent_at < now() - interval '10 minutes' then
    raise exception 'invalid_or_expired_otp';
  end if;

  -- Matches Supabase Auth crypto.GenerateTokenHash(email, otp).
  expected_token := encode(extensions.digest(user_email || nonce_input, 'sha224'), 'hex');
  if expected_token <> reauthentication_token then
    raise exception 'invalid_or_expired_otp';
  end if;

  update public.admin_otp_challenges
  set consumed_at = now()
  where id = challenge_id_input and consumed_at is null;

  -- Make the email nonce one-time, matching GoTrue ConfirmReauthentication().
  update auth.users
  set reauthentication_token = ''
  where id = user_id_input;

  update public.admin_mfa_sessions
  set revoked_at = now()
  where user_id = user_id_input and revoked_at is null;

  session_expires_at := now() + interval '60 minutes';
  insert into public.admin_mfa_sessions (user_id, token_hash, verified_at, expires_at)
  values (user_id_input, token_hash_input, now(), session_expires_at);

  insert into public.audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  values (user_id_input, 'admin.otp_verified', 'admin_mfa_sessions', challenge_id_input::text,
    'password and reauthentication email OTP verified', jsonb_build_object('expires_at', session_expires_at));

  return session_expires_at;
end;
$$;
revoke all on function public.verify_admin_reauthentication_otp(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_admin_reauthentication_otp(uuid, uuid, text, text) to service_role;

commit;
