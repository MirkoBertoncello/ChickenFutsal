-- Eseguire nel SQL Editor del progetto esistente, poi attivare l'Auth Hook.
-- Non rieseguire schema.sql: questo file aggiunge solo il controllo registrazioni.
create or replace function public.club_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_email text := lower(trim(event -> 'user' ->> 'email'));
begin
  if invited_email is null or invited_email = '' or not exists (
    select 1 from club_private.members m where m.email = invited_email
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Registrazione riservata ai giocatori invitati. Contatta un admin di ChickenFutsal.'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

-- Solo il servizio Auth può eseguire il controllo; il browser non può interrogare l'elenco.
revoke all on function public.club_before_user_created(jsonb)
from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.club_before_user_created(jsonb) to supabase_auth_admin;
