-- Corregge le segnalazioni evitabili senza aprire le tabelle o disattivare RLS.
begin;
-- Un ping anonimo non deve avere privilegi elevati né leggere membri del gruppo.
create or replace function public.club_health() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('ok',true)
$$;
revoke all on function public.club_health() from public,anon,authenticated;
grant execute on function public.club_health() to anon,authenticated;

-- Funzione tecnica creata dall'opzione Supabase "Enable automatic RLS".
-- Il trigger continua a funzionare con il proprio proprietario; il browser non deve invocarlo.
do $$
begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke execute on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end $$;
commit;
