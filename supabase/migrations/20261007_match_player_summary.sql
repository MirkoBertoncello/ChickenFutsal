-- Tabellino partita: admin e autorizzati vedono tutti, gli altri solo il proprio.
begin;
create or replace function public.club_snapshot(p_season integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint; v_admin boolean; v_all boolean; v_players jsonb; v_matches jsonb; v_rounds jsonb; v_awards jsonb;
begin
 v_actor:=club_private.actor();
 if p_season is null then select id into p_season from club_private.seasons where closed_at is null; end if;
 if not exists(select 1 from club_private.seasons where id=p_season) then raise exception 'Stagione non valida'; end if;
 select is_admin,see_all into v_admin,v_all from club_private.members where player_id=v_actor;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,
 'occasional',p.occasional,'admin',coalesce(m.is_admin,false),'seeAll',case when v_admin or p.id=v_actor then coalesce(m.see_all,false) else false end)
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


commit;
