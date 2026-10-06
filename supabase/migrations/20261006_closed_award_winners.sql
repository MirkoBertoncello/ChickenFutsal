-- Eseguire dopo la migrazione delle stagioni. Pubblica solo i nomi dei vincitori delle stagioni chiuse.
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
 'goals',coalesce(s.goals,0),'own',coalesce(s.own,0),'apps',coalesce(s.apps,0)) else '{}'::jsonb end
 || case when v_admin then jsonb_build_object('email',m.email) else '{}'::jsonb end order by p.id),'[]'::jsonb)
 into v_players from club_private.players p left join club_private.members m on m.player_id=p.id
 left join lateral (
 select sum((r.value->>'goals')::integer) goals,sum((r.value->>'own')::integer) own,
 count(*) filter(where (r.value->>'present')::boolean) apps
 from club_private.matches mm cross join lateral jsonb_each(mm.result) r
 where mm.season=p_season and mm.cancelled_at is null and r.key=p.id::text
 ) s on true;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'date',m.match_date,'time',to_char(m.match_time,'HH24:MI'),
 'field',m.field,'cancelled',m.cancelled_at is not null,'cancellationReason',m.cancellation_reason,'a',m.team_a,'b',m.team_b,'done',m.result is not null,
 'score',case when m.result is null then null else jsonb_build_array(
 (select coalesce(sum(case when m.team_a @> jsonb_build_array(r.key::bigint) then (r.value->>'goals')::int else (r.value->>'own')::int end),0) from jsonb_each(m.result) r),
 (select coalesce(sum(case when m.team_b @> jsonb_build_array(r.key::bigint) then (r.value->>'goals')::int else (r.value->>'own')::int end),0) from jsonb_each(m.result) r)) end,
 'result',case when v_admin then m.result else null end) order by m.match_date,m.match_time),'[]'::jsonb)
 into v_matches from club_private.matches m where m.season=p_season;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'award',r.award,'turn',r.turn,'status',r.status,'candidates',r.candidates,
 'voted',exists(select 1 from club_private.ballots b where b.round_id=r.id and b.voter_id=v_actor),
 'count',(select count(*) from club_private.ballots b where b.round_id=r.id),
 'results',case when r.status<>'open' then coalesce((select jsonb_agg(jsonb_build_object('id',a.candidate_id,'count',a.n) order by a.n desc,a.candidate_id)
 from (select b.candidate_id,count(*) n from club_private.ballots b where b.round_id=r.id group by b.candidate_id) a),'[]'::jsonb) else '[]'::jsonb end)
 order by r.award,r.turn),'[]'::jsonb) into v_rounds from club_private.rounds r where r.season=p_season;
 -- Expose only winner identities for closed seasons, never other players' totals.
 v_awards:='{}'::jsonb;
 if exists(select 1 from club_private.seasons where id=p_season and closed_at is not null) then
  with totals as (
   select p.id,p.name,coalesce(sum((r.value->>'goals')::int),0) goals,
    coalesce(sum((r.value->>'own')::int),0) own,
    count(*) filter(where (r.value->>'present')::boolean) apps
   from club_private.players p left join club_private.matches m on m.season=p_season and m.cancelled_at is null and m.result ? p.id::text
   left join lateral jsonb_each(m.result) r on r.key=p.id::text group by p.id,p.name
  ), scores as (
   select t.id,t.name,v.metric,v.total from totals t cross join lateral (values ('goals',t.goals),('own',t.own),('apps',t.apps)) v(metric,total)
  ), ranked as (
   select *,max(total) over(partition by metric) maximum from scores
  ), winners as (
   select metric,jsonb_agg(jsonb_build_object('id',id,'name',name) order by id) identities from ranked where total=maximum and maximum>0 group by metric
  ) select coalesce(jsonb_object_agg(metric,identities),'{}'::jsonb) into v_awards from winners;
 end if;
 return jsonb_build_object('user',v_actor,'season',p_season,'players',v_players,'matches',v_matches,'rounds',v_rounds,
 'closedAwards',v_awards,
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
