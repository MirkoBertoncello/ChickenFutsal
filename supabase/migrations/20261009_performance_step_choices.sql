-- Eseguire dopo 20261009_match_performance.sql. Gli eventi storici conservano la loro variazione.
begin;
select pg_advisory_xact_lock(712026);
insert into club_private.audit(actor,actor_name,action,subject,details)
select 0,'SQL Editor','performance_settings','Valutazione prestazioni',
  jsonb_build_object('before',jsonb_build_object('step',step),'after',jsonb_build_object('step',0.5))
from club_private.performance_settings where step not in (0,0.5,1);
update club_private.performance_settings set step=0.5 where step not in (0,0.5,1);
alter table club_private.performance_settings drop constraint if exists performance_settings_allowed_step;
alter table club_private.performance_settings add constraint performance_settings_allowed_step check(step in (0,0.5,1));
commit;
