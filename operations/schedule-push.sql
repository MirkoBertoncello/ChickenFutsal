-- Opzionale: invio push programmato nel cloud, senza dipendere dal QNAP.
-- Prima attivare Cron (pg_cron) e pg_net da Integrations/Database Extensions.
-- In Supabase Vault creare, dalla console, questi tre segreti:
-- club_project_url         URL https://PROJECT.supabase.co
-- club_publishable_key     chiave pubblica Supabase
-- club_cron_secret         stesso CRON_SECRET dell'Edge Function send-push
-- Non inserire i valori in questo file né in chat.
do $$
begin
 if (select count(*) from vault.decrypted_secrets where name in ('club_project_url','club_publishable_key','club_cron_secret'))<>3 then
  raise exception 'Configura prima i tre valori in Vault';
 end if;
end $$;
select cron.schedule(
 'chicken-futsal-send-push',
 '*/5 * * * *',
 $job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='club_project_url')||'/functions/v1/send-push',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'apikey',(select decrypted_secret from vault.decrypted_secrets where name='club_publishable_key'),
   'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='club_cron_secret')
  ),
  body:='{}'::jsonb,
  timeout_milliseconds:=120000
 );
 $job$
);
