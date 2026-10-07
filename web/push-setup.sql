begin;
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

create temporary table push_setup_initial as select not exists(select 1 from club_private.push_config) as first_setup;

-- Eseguire soltanto dopo aver distribuito send-push e salvato i suoi quattro Secrets.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
do $$
begin
 if exists(select 1 from club_private.push_config where public_key<> '__PUBLIC_KEY__') then
  raise exception 'Push già configurato con altre chiavi. Riutilizza il file privato salvato in precedenza.';
 end if;
end $$;
insert into club_private.push_config(singleton,public_key) values(true,'__PUBLIC_KEY__')
on conflict(singleton) do update set public_key=excluded.public_key;
do $$
declare secret_name text; secret_value text; secret_id uuid;
begin
 for secret_name,secret_value in select * from (values
 ('club_project_url','__PROJECT_URL__'),
 ('club_publishable_key','__PUBLISHABLE_KEY__'),
 ('club_cron_secret','__CRON_SECRET__')) as secrets(name,value)
 loop
  select id into secret_id from vault.secrets where name=secret_name;
  if secret_id is null then perform vault.create_secret(secret_value,secret_name);
  else perform vault.update_secret(secret_id,secret_value,secret_name); end if;
 end loop;
end $$;
-- Al primo avvio scarta la vecchia coda: gli avvisi già passati restano nel sito.
-- Non scartare la coda quando si riesegue la configurazione.
update club_private.push_queue set status='sent',claim_token=null where status<>'sent' and (select first_setup from push_setup_initial);
drop table push_setup_initial;
select cron.schedule('chicken-futsal-send-push','*/5 * * * *',
$job$
select club_private.enqueue_reminders();
-- Gli avvisi senza dispositivi restano nel sito senza avviare un invio push.
update club_private.push_queue q set status='sent',claim_token=null
where q.status='pending' and not exists(select 1 from club_private.push_subscriptions s where s.player_id=q.player_id);
select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='club_project_url')||'/functions/v1/send-push',
 headers:=jsonb_build_object('Content-Type','application/json',
 'apikey',(select decrypted_secret from vault.decrypted_secrets where name='club_publishable_key'),
 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='club_cron_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
where exists(select 1 from club_private.push_queue q where q.attempts<3 and
 (q.status='pending' or (q.status in ('processing','failed') and q.claimed_at<now()-interval '10 minutes')));
$job$);

commit;
