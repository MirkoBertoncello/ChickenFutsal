-- Eseguire nel SQL Editor dopo la migrazione 20261009_match_performance.sql.
-- Riattiva soltanto la partita indicata; conserva tabellino e formazioni.
begin;
do $$
declare
  v_match club_private.matches%rowtype;
  v_count integer;
  v_audit_start bigint;
  v_before jsonb;
begin
  perform pg_advisory_xact_lock(712026);
  select count(*) into v_count
  from club_private.matches m join club_private.seasons s on s.id=m.season
  where s.name='2025/2026' and s.closed_at is null
    and m.match_date=date '2026-10-09' and m.match_time=time '21:00'
    and m.field='Oratorio Don Bosco Arena';
  if v_count<>1 then
    raise exception 'Attesa una sola partita nella stagione attiva 2025/2026; trovate %',v_count;
  end if;
  select m.* into v_match
  from club_private.matches m join club_private.seasons s on s.id=m.season
  where s.name='2025/2026' and s.closed_at is null
    and m.match_date=date '2026-10-09' and m.match_time=time '21:00'
    and m.field='Oratorio Don Bosco Arena' for update of m;
  if v_match.cancelled_at is null then return; end if;
  v_before:=to_jsonb(v_match);
  select coalesce(max(id),0) into v_audit_start from club_private.audit;
  update club_private.matches set cancelled_at=null,cancellation_reason=null,updated_at=now()
  where id=v_match.id;
  perform club_private.sync_match_ratings(v_match.id,0);
  update club_private.audit set actor_name='SQL Editor'
  where id>v_audit_start and actor=0 and actor_name is null;
  insert into club_private.audit(actor,actor_name,action,subject,details)
  select 0,'SQL Editor','match_restore','9 ottobre 2026 · Oratorio Don Bosco Arena',
    jsonb_build_object('before',v_before,'after',to_jsonb(m))
  from club_private.matches m where m.id=v_match.id;
end $$;
commit;
