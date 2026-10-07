-- Le coppie visibili ai membri senza permesso globale comprendono sempre il membro stesso.
create or replace function public.club_pair_statistics(p_season integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor bigint:=club_private.actor();v_all boolean;v_data jsonb;
begin
 select is_admin or see_all into v_all from club_private.members where player_id=v_actor;
 if p_season is null then select id into p_season from club_private.seasons where closed_at is null;end if;
 if not exists(select 1 from club_private.seasons where id=p_season) then raise exception 'Stagione non valida';end if;
 with games as (
  select m.*,s.a score_a,s.b score_b from club_private.matches m
  cross join lateral(select
   coalesce(sum(case when m.team_a @> jsonb_build_array(e.key::bigint) then (e.value->>'goals')::int else (e.value->>'own')::int end),0) a,
   coalesce(sum(case when m.team_b @> jsonb_build_array(e.key::bigint) then (e.value->>'goals')::int else (e.value->>'own')::int end),0) b
   from jsonb_each(m.result) e) s
  where m.season=p_season and m.cancelled_at is null and m.result is not null
 ), appearances as (
  select g.id,g.score_a,g.score_b,e.key::bigint pid,g.team_a @> jsonb_build_array(e.key::bigint) side_a
  from games g cross join lateral jsonb_each(g.result) e
  join club_private.players p on p.id=e.key::bigint
  where coalesce((e.value->>'present')::boolean,false)
   and (g.team_a @> jsonb_build_array(e.key::bigint) or g.team_b @> jsonb_build_array(e.key::bigint))
 ), pairs as (
  select a.pid first_id,b.pid second_id,a.side_a=b.side_a together,
   case when a.score_a=a.score_b then 0 when (a.side_a and a.score_a>a.score_b) or (not a.side_a and a.score_b>a.score_a) then 1 else -1 end outcome
  from appearances a join appearances b on a.id=b.id and a.pid<b.pid
  where v_all or a.pid=v_actor or b.pid=v_actor
 ), totals as (
  select first_id,second_id,together,count(*) games,count(*) filter(where outcome=1) wins,
   count(*) filter(where outcome=0) draws,count(*) filter(where outcome=-1) losses
  from pairs group by first_id,second_id,together
 ) select coalesce(jsonb_agg(jsonb_build_object('first',first_id,'second',second_id,'together',together,'games',games,'wins',wins,'draws',draws,'losses',losses) order by together desc,first_id,second_id),'[]'::jsonb) into v_data from totals;
 return jsonb_build_object('pairs',v_data,'ownOnly',not v_all);
end $$;
revoke all on function public.club_pair_statistics(integer) from public,anon;
grant execute on function public.club_pair_statistics(integer) to authenticated;
