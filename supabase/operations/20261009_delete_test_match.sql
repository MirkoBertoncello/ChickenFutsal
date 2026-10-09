-- Eliminazione definitiva della sola partita di test indicata.
-- Eseguire nel SQL Editor dopo la migrazione delle valutazioni partita.
begin;
do $$
declare
 v_match club_private.matches%rowtype;
 v_count integer;
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
 -- Rimuove e ricalcola gli effetti delle prestazioni prima di cancellare gli eventi.
 update club_private.matches set cancelled_at=coalesce(cancelled_at,now()) where id=v_match.id;
 perform club_private.sync_match_ratings(v_match.id,0);
 delete from club_private.push_queue q using club_private.notifications n
 where q.notification_id=n.id and n.match_id=v_match.id;
 delete from club_private.notifications where match_id=v_match.id;
 delete from club_private.rating_events where match_id=v_match.id;
 -- Rimuove anche le copie del tabellino nei dettagli delle operazioni storiche.
 delete from club_private.audit
 where (action in ('match','match_edit','match_cancel','match_restore','result')
   and (details->'before'->>'id'=v_match.id::text or details->'after'->>'id'=v_match.id::text))
  or (action='performance_ratings' and details->>'matchId'=v_match.id::text);
 delete from club_private.matches where id=v_match.id;
 insert into club_private.audit(actor,actor_name,action,subject,details)
 values(0,'SQL Editor','match_purge','9 ottobre 2026 · Oratorio Don Bosco Arena',
  jsonb_build_object('matchId',v_match.id));
end $$;
commit;
