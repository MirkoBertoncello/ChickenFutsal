begin;
alter table club_private.players add column if not exists image_version text generated always as (case when image_data is not null then md5(image_data) else null end) stored;
-- Snapshot senza immagini e registro limitato alle dieci voci visualizzate.
create or replace function public.club_admin_history() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint;
begin
 v_actor:=club_private.actor();
 if not exists(select 1 from club_private.members where player_id=v_actor and is_admin) then raise exception 'Operazione riservata agli admin'; end if;
 return jsonb_build_object(
 'changes',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc),'[]'::jsonb) from (select a.id,a.created_at,coalesce(a.actor_name,p.name,'Admin #'||a.actor::text) actor_name,a.action,a.subject,a.details from club_private.audit a left join club_private.players p on p.id=a.actor order by a.id desc limit 10) a),
 'deletedPlayers',(select coalesce(jsonb_agg(jsonb_build_object('id',player_id,'name',profile->>'name','role',profile->>'role','deletedAt',deleted_at,'deletedBy',deleted_by_name) order by deleted_at desc),'[]'::jsonb) from club_private.deleted_players));
end $$;
revoke all on function public.club_admin_history() from public,anon;
grant execute on function public.club_admin_history() to authenticated;create or replace function public.club_snapshot(p_season integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint; v_admin boolean; v_all boolean; v_players jsonb; v_matches jsonb; v_rounds jsonb; v_awards jsonb;
begin
 v_actor:=club_private.actor();
 if p_season is null then select id into p_season from club_private.seasons where closed_at is null; end if;
 if not exists(select 1 from club_private.seasons where id=p_season) then raise exception 'Stagione non valida'; end if;
 select is_admin,see_all into v_admin,v_all from club_private.members where player_id=v_actor;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,
 'imageVersion',p.image_version,'occasional',p.occasional,'active',p.active,'hasPresence',coalesce(s.apps,0)>0,'admin',coalesce(m.is_admin,false),'seeAll',case when v_admin or p.id=v_actor then coalesce(m.see_all,false) else false end)
 || case when v_admin or v_all or p.id=v_actor then jsonb_build_object('ratings',p.ratings,
 'goals',coalesce(s.goals,0),'own',coalesce(s.own,0),'apps',coalesce(s.apps,0),
 'wins',coalesce(s.wins,0),'draws',coalesce(s.draws,0),'losses',coalesce(s.losses,0),
 'winRate',case when s.apps>0 then round(100.0*s.wins/s.apps,2) else 0 end,
 'goalAverage',case when s.apps>0 then round(s.goals::numeric/s.apps,2) else 0 end) else '{}'::jsonb end
 || case when v_admin then jsonb_build_object('email',m.email) else '{}'::jsonb end order by p.id),'[]'::jsonb)
 into v_players from club_private.players p left join club_private.members m on m.player_id=p.id
 left join lateral (
 select sum((r.value->>'goals')::integer) goals,sum((r.value->>'own')::integer) own,
 count(*) filter(where (r.value->>'present')::boolean) apps,
 count(*) filter(where (r.value->>'present')::boolean and
  case when mm.team_a @> jsonb_build_array(p.id) then score.a>score.b else score.b>score.a end) wins,
 count(*) filter(where (r.value->>'present')::boolean and score.a=score.b) draws,
 count(*) filter(where (r.value->>'present')::boolean and
  case when mm.team_a @> jsonb_build_array(p.id) then score.a<score.b else score.b<score.a end) losses
 from club_private.matches mm cross join lateral jsonb_each(mm.result) r
 cross join lateral (
  select coalesce(sum(case when mm.team_a @> jsonb_build_array(e.key::bigint) then (e.value->>'goals')::int else (e.value->>'own')::int end),0) a,
   coalesce(sum(case when mm.team_b @> jsonb_build_array(e.key::bigint) then (e.value->>'goals')::int else (e.value->>'own')::int end),0) b
  from jsonb_each(mm.result) e
 ) score
 where mm.season=p_season and mm.cancelled_at is null and r.key=p.id::text
 ) s on true;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'date',m.match_date,'time',to_char(m.match_time,'HH24:MI'),
 'field',m.field,'cancelled',m.cancelled_at is not null,'cancellationReason',m.cancellation_reason,'a',m.team_a,'b',m.team_b,'done',m.result is not null,
 'score',case when m.result is null then null else jsonb_build_array(
 (select coalesce(sum(case when m.team_a @> jsonb_build_array(r.key::bigint) then (r.value->>'goals')::int else (r.value->>'own')::int end),0) from jsonb_each(m.result) r),
 (select coalesce(sum(case when m.team_b @> jsonb_build_array(r.key::bigint) then (r.value->>'goals')::int else (r.value->>'own')::int end),0) from jsonb_each(m.result) r)) end,
 'result',case when m.result is null then null when v_admin or v_all then m.result else (select coalesce(jsonb_object_agg(r.key,r.value),'{}'::jsonb) from jsonb_each(m.result) r where r.key=v_actor::text) end) order by m.match_date,m.match_time),'[]'::jsonb)
 into v_matches from club_private.matches m where m.season=p_season;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'award',r.award,'turn',r.turn,'status',r.status,'candidates',r.candidates,
 'voted',exists(select 1 from club_private.ballots b where b.round_id=r.id and b.voter_id=v_actor),
 'count',(select count(*) from club_private.ballots b where b.round_id=r.id),
 'results',case when r.status<>'open' then coalesce((select jsonb_agg(jsonb_build_object('id',a.candidate_id,'count',a.n) order by a.n desc,a.candidate_id)
 from (select b.candidate_id,count(*) n from club_private.ballots b where b.round_id=r.id group by b.candidate_id) a),'[]'::jsonb) else '[]'::jsonb end)
 order by r.award,r.turn),'[]'::jsonb) into v_rounds from club_private.rounds r where r.season=p_season;
 v_awards:=coalesce((select awards from club_private.season_awards where season=p_season),'{}'::jsonb);
 return jsonb_build_object('user',v_actor,'season',p_season,'players',v_players,'matches',v_matches,'rounds',v_rounds,
 'reminderSettings',case when v_admin then (select to_jsonb(c)-'singleton' from club_private.reminder_settings c where singleton) else null end,
 'closedAwards',v_awards,
 'hallOfFame',(select coalesce(jsonb_agg(jsonb_build_object('season',s.id,'name',s.name,'closedAt',s.closed_at,'awards',a.awards) order by s.id desc),'[]'::jsonb) from club_private.seasons s join club_private.season_awards a on a.season=s.id where s.closed_at is not null),
 'activeSeason',(select id from club_private.seasons where closed_at is null),
 'seasonInfo',(select to_jsonb(s) from club_private.seasons s where id=p_season),
 'seasons',(select jsonb_agg(id order by id desc) from club_private.seasons),
 'seasonOptions',(select jsonb_agg(to_jsonb(s) order by id desc) from club_private.seasons s),
 'notifications',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'text',n.text,'seen',n.seen,'matchId',n.match_id,'to',jsonb_build_array(v_actor)) order by n.created_at desc),'[]'::jsonb)
 from club_private.notifications n where n.player_id=v_actor));
end $$;
revoke all on function public.club_snapshot(integer) from public,anon;
grant execute on function public.club_snapshot(integer) to authenticated;

-- Images are fetched separately in small batches after membership validation.
create or replace function public.club_player_images(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint:=club_private.actor();v_result jsonb;
begin
 if coalesce(cardinality(p_ids),0)>10 then raise exception 'Richiedi al massimo dieci immagini';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.image_version,'image',p.image_data)),'[]'::jsonb)
 into v_result from club_private.players p where p.id=any(p_ids) and p.image_data is not null;
 return v_result;
end $$;
revoke all on function public.club_player_images(bigint[]) from public,anon;
grant execute on function public.club_player_images(bigint[]) to authenticated;

-- Ottimizza il cron già configurato. Nessuna configurazione o segreto inventato.
do $$
begin
 if to_regclass('cron.job') is not null and to_regclass('vault.decrypted_secrets') is not null then
  if (select count(*) from vault.decrypted_secrets where name in ('club_project_url','club_publishable_key','club_cron_secret'))=3 then
   perform cron.schedule('chicken-futsal-send-push','*/5 * * * *',$job$
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
   perform cron.schedule('chicken-futsal-technical-cleanup','17 3 * * *',$cleanup$
    delete from club_private.push_queue where created_at<now()-interval '30 days' and (status='sent' or (status='failed' and attempts>=3));
    delete from cron.job_run_details where end_time<now()-interval '7 days' and jobid in (select jobid from cron.job where jobname in ('chicken-futsal-send-push','chicken-futsal-technical-cleanup'));
   $cleanup$);
  else raise notice 'Cron non aggiornato: prima completare la configurazione delle notifiche';end if;
 end if;
end $$;

commit;
