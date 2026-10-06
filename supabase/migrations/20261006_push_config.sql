-- Configurazione pubblica push; le chiavi private restano nei Secrets delle Edge Functions.
create table if not exists club_private.push_config (
 singleton boolean primary key default true check(singleton),
 public_key text not null check(public_key ~ '^[A-Za-z0-9_-]{87}$')
);
alter table club_private.push_config enable row level security;
revoke all on club_private.push_config from public,anon,authenticated;
create or replace function public.club_push_config() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform club_private.actor();
 return jsonb_build_object('publicKey',(select public_key from club_private.push_config where singleton));
end $$;
revoke all on function public.club_push_config() from public,anon;
grant execute on function public.club_push_config() to authenticated;
