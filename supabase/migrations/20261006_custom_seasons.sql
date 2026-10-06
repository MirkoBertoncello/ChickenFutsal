-- Eseguire dopo le migrazioni precedenti. Conserva tutte le partite e i voti.
begin;
create table if not exists club_private.seasons (
 id integer primary key, name text not null check(length(name) between 1 and 60),
 started_on date not null, closed_at timestamptz
);
create unique index if not exists one_active_season on club_private.seasons ((true)) where closed_at is null;
insert into club_private.seasons(id,name,started_on,closed_at)
select y,case when y=2026 then '2025/2026' else y::text end,make_date(y,1,1),case when y=max(y) over() then null else now() end
from (select season y from club_private.matches union select season from club_private.rounds union select 2026) t
where not exists(select 1 from club_private.seasons)
on conflict(id) do nothing;
alter table club_private.seasons enable row level security;

create or replace function public.club_snapshot(p_season integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint; v_admin boolean; v_all boolean; v_players jsonb; v_matches jsonb; v_rounds jsonb;
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
 return jsonb_build_object('user',v_actor,'season',p_season,'players',v_players,'matches',v_matches,'rounds',v_rounds,
 'activeSeason',(select id from club_private.seasons where closed_at is null),
 'seasonInfo',(select to_jsonb(s) from club_private.seasons s where id=p_season),
 'seasons',(select jsonb_agg(id order by id desc) from club_private.seasons),
 'seasonOptions',(select jsonb_agg(to_jsonb(s) order by id desc) from club_private.seasons s),
 'notifications',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'text',n.text,'seen',n.seen,'matchId',n.match_id,'to',jsonb_build_array(v_actor)) order by n.created_at desc),'[]'::jsonb)
 from club_private.notifications n where n.player_id=v_actor));
end $$;
revoke all on function public.club_snapshot(integer) from public,anon;
grant execute on function public.club_snapshot(integer) to authenticated;

create or replace function public.club_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor bigint; v_admin boolean; v_id bigint; v_pid bigint; v_round club_private.rounds%rowtype;
 v_match club_private.matches%rowtype; v_ids jsonb; v_result jsonb; v_entry jsonb;
 v_goals integer; v_own integer; v_present boolean; v_season integer; v_turn integer; v_note bigint;
begin
 v_actor:=club_private.actor();
 -- Serialize writes including permission checks: concurrent admins cannot remove the last admin.
 perform pg_advisory_xact_lock(712026);
 select is_admin into v_admin from club_private.members where player_id=v_actor;
 if p_action in ('match','round_open') then v_season:=(p_data->>'season')::integer;
 elsif p_action in ('result','match_cancel') then select season into v_season from club_private.matches where id=(p_data->>'id')::bigint;
 elsif p_action in ('vote','round_close','round_final') then select season into v_season from club_private.rounds where id=coalesce(p_data->>'round',p_data->>'id')::bigint;
 end if;
 if p_action in ('match','round_open','result','match_cancel','vote','round_close','round_final') and
 not exists(select 1 from club_private.seasons where id=v_season and closed_at is null) then raise exception 'Stagione chiusa: lo storico è consultabile'; end if;
 if p_action='vote' then
  select * into v_round from club_private.rounds where id=(p_data->>'round')::bigint for update;
  if not found or v_round.status<>'open' then raise exception 'Turno non aperto'; end if;
  v_pid:=(p_data->>'candidate')::bigint;
  if v_pid is null or not (v_round.candidates @> jsonb_build_array(v_pid)) then raise exception 'Candidato non ammesso'; end if;
  insert into club_private.ballots(round_id,voter_id,candidate_id) values(v_round.id,v_actor,v_pid);
  -- No audit candidate or ballot timestamp exposed to group admins.
 elsif p_action='seen' then
  update club_private.notifications set seen=true where id=(p_data->>'id')::bigint and player_id=v_actor;
 elsif p_action='push_subscribe' then
  if jsonb_typeof(p_data->'subscription')<>'object' or length((p_data->'subscription')::text)>8192
    or coalesce(p_data->'subscription'->>'endpoint','') !~ '^https://(fcm[.]googleapis[.]com|web[.]push[.]apple[.]com|([a-zA-Z0-9-]+[.])*push[.]services[.]mozilla[.]com|([a-zA-Z0-9-]+[.])+notify[.]windows[.]com)/'
    or not coalesce(p_data->'subscription'->'keys' ?& array['auth','p256dh'],false) then raise exception 'Iscrizione non valida'; end if;
  if (select count(*) from club_private.push_subscriptions where player_id=v_actor)>=5
    and not exists(select 1 from club_private.push_subscriptions where player_id=v_actor and endpoint=p_data->'subscription'->>'endpoint')
    then delete from club_private.push_subscriptions where endpoint=(select endpoint from club_private.push_subscriptions where player_id=v_actor order by created_at limit 1); end if;
  insert into club_private.push_subscriptions(player_id,endpoint,subscription)
   values(v_actor,p_data->'subscription'->>'endpoint',p_data->'subscription')
   on conflict(endpoint) do update set subscription=excluded.subscription where club_private.push_subscriptions.player_id=v_actor;
 else
  if not v_admin then raise exception 'Operazione riservata agli admin'; end if;
  case p_action
  when 'season_start' then
   if nullif(trim(p_data->>'name'),'') is null or length(trim(p_data->>'name'))>60 then raise exception 'Nome stagione obbligatorio (massimo 60 caratteri)'; end if;
   if (p_data->>'previous')::integer is distinct from (select id from club_private.seasons where closed_at is null) then raise exception 'Stagione cambiata: aggiorna la pagina'; end if;
   if exists(select 1 from club_private.matches where season=(p_data->>'previous')::integer and cancelled_at is null and result is null) then raise exception 'Registra o annulla prima le partite ancora in programma della stagione attiva'; end if;
   if (p_data->>'started_on')::date is null or (p_data->>'started_on')::date < (select started_on from club_private.seasons where closed_at is null) then raise exception 'Data inizio non valida'; end if;
   select coalesce(max(id),2025)+1 into v_season from club_private.seasons;
   update club_private.rounds set status='closed' where season=(p_data->>'previous')::integer and status='open';
   update club_private.seasons set closed_at=now() where closed_at is null;
   insert into club_private.seasons(id,name,started_on) values(v_season,trim(p_data->>'name'),(p_data->>'started_on')::date);
   v_id:=v_season;
  when 'player_delete' then
   v_pid:=(p_data->>'id')::bigint;
   if v_pid=v_actor then raise exception 'Non puoi eliminare il tuo profilo admin'; end if;
   if not exists(select 1 from club_private.players where id=v_pid) then raise exception 'Giocatore inesistente'; end if;
   if exists(select 1 from club_private.matches where cancelled_at is null and result is null and (team_a @> jsonb_build_array(v_pid) or team_b @> jsonb_build_array(v_pid))) then
    raise exception 'Giocatore convocato: annulla prima le partite ancora in programma';
   end if;
   delete from club_private.push_queue where player_id=v_pid;
   delete from club_private.notifications where player_id=v_pid;
   delete from club_private.push_subscriptions where player_id=v_pid;
   delete from club_private.ballots where voter_id=v_pid or candidate_id=v_pid;
   update club_private.rounds r set candidates=coalesce((select jsonb_agg(c.value) from jsonb_array_elements(r.candidates) c where c.value<>to_jsonb(v_pid)),'[]'::jsonb)
    where r.candidates @> jsonb_build_array(v_pid);
   delete from club_private.members where player_id=v_pid;
   delete from club_private.players where id=v_pid;
  when 'player' then
   if nullif(trim(p_data->>'name'),'') is null then raise exception 'Nome obbligatorio'; end if;
   if (p_data->>'role') not in ('Attaccante','Regista','Difensore','Portiere') then raise exception 'Ruolo non valido'; end if;
   if coalesce((p_data->>'occasional')::boolean,false) and nullif(trim(p_data->>'email'),'') is not null then raise exception 'Un occasionale non richiede un account'; end if;
   insert into club_private.players(name,role,occasional) values(trim(p_data->>'name'),p_data->>'role',coalesce((p_data->>'occasional')::boolean,false)) returning id into v_id;
   if nullif(trim(p_data->>'email'),'') is not null then
    insert into club_private.members(player_id,email) values(v_id,lower(trim(p_data->>'email')));
   end if;
  when 'invite' then
   v_pid:=(p_data->>'id')::bigint;
   if v_pid=v_actor then raise exception 'Modifica la tua email dalla gestione account, non da questa schermata'; end if;
   if nullif(trim(p_data->>'email'),'') is null then raise exception 'Email obbligatoria'; end if;
   insert into club_private.members(player_id,email) values(v_pid,lower(trim(p_data->>'email')))
    on conflict(player_id) do update set email=excluded.email;
   update club_private.players set occasional=false where id=v_pid;
  when 'ratings' then
   v_ids:=p_data->'ratings';
   if jsonb_typeof(v_ids)<>'array' or jsonb_array_length(v_ids)<>6 then raise exception 'Servono sei valutazioni'; end if;
   for v_entry in select value from jsonb_array_elements(v_ids) loop
    if jsonb_typeof(v_entry)<>'number' then raise exception 'Valutazione non numerica'; end if;
    v_goals:=v_entry::text::integer;
    if v_goals<1 or v_goals>99 then raise exception 'Valutazioni da 1 a 99'; end if;
   end loop;
   update club_private.players set ratings=v_ids where id=(p_data->>'id')::bigint;
  when 'permission' then
   v_pid:=(p_data->>'id')::bigint;
   if p_data->>'key'='admin' then
    if v_pid=v_actor then raise exception 'Non puoi rimuovere il tuo ruolo admin'; end if;
    update club_private.members set is_admin=(p_data->>'value')::boolean where player_id=v_pid;
   elsif p_data->>'key'='seeAll' then
    update club_private.members set see_all=(p_data->>'value')::boolean where player_id=v_pid;
   else raise exception 'Permesso non valido'; end if;
   if not found then raise exception 'Collega prima una email al giocatore'; end if;
  when 'match' then
   if jsonb_typeof(p_data->'a')<>'array' or jsonb_typeof(p_data->'b')<>'array' then raise exception 'Squadre obbligatorie'; end if;
   if jsonb_array_length(p_data->'a')<>5 or jsonb_array_length(p_data->'b')<>5 then raise exception 'Servono due squadre da 5'; end if;
   v_ids:=(p_data->'a')||(p_data->'b');
   if (select count(distinct value::text::bigint) from jsonb_array_elements(v_ids))<>10 then raise exception 'Servono 10 giocatori distinti'; end if;
   if (select count(*) from club_private.players where v_ids @> jsonb_build_array(id))<>10 then raise exception 'Giocatore inesistente'; end if;
   v_season:=(p_data->>'season')::integer;
   if (p_data->>'date')::date < (select started_on from club_private.seasons where id=v_season) then raise exception 'Partita precedente all’inizio stagione'; end if;
   insert into club_private.matches(season,match_date,match_time,field,team_a,team_b)
    values(v_season,(p_data->>'date')::date,(p_data->>'time')::time,trim(p_data->>'field'),p_data->'a',p_data->'b') returning id into v_id;
   for v_pid in select value::text::bigint from jsonb_array_elements(v_ids) loop
    insert into club_private.notifications(player_id,match_id,text)
     values(v_pid,v_id,'Convocazione: '||(p_data->>'date')||' alle '||(p_data->>'time')||' · '||trim(p_data->>'field')) returning id into v_note;
    insert into club_private.push_queue(player_id,notification_id) values(v_pid,v_note);
   end loop;
  when 'match_cancel' then
   select * into v_match from club_private.matches where id=(p_data->>'id')::bigint for update;
   if not found then raise exception 'Partita inesistente'; end if;
   if v_match.cancelled_at is not null then raise exception 'Partita già annullata'; end if;
   if length(coalesce(p_data->>'reason',''))>200 then raise exception 'Motivo troppo lungo'; end if;
   update club_private.matches set cancelled_at=now(),cancellation_reason=nullif(trim(p_data->>'reason'),''),updated_at=now() where id=v_match.id;
   -- Stop queued previous convocations. Already delivered push messages cannot be recalled.
   update club_private.push_queue q set status='sent',claim_token=null
    from club_private.notifications n where q.notification_id=n.id and n.match_id=v_match.id and q.status<>'sent';
   for v_pid in select value::text::bigint from jsonb_array_elements(v_match.team_a||v_match.team_b) loop
    insert into club_private.notifications(player_id,match_id,text)
     values(v_pid,v_match.id,'Partita annullata: '||v_match.match_date::text||' alle '||to_char(v_match.match_time,'HH24:MI')||' · '||v_match.field||
      case when nullif(trim(p_data->>'reason'),'') is not null then ' · '||trim(p_data->>'reason') else '' end) returning id into v_note;
    insert into club_private.push_queue(player_id,notification_id) values(v_pid,v_note);
   end loop;
  when 'result' then
   select * into v_match from club_private.matches where id=(p_data->>'id')::bigint for update;
   if not found then raise exception 'Partita inesistente'; end if;
   if v_match.cancelled_at is not null then raise exception 'Partita annullata: tabellino non modificabile'; end if;
   v_ids:=v_match.team_a||v_match.team_b;v_result:=p_data->'result';
   if jsonb_typeof(v_result)<>'object' or (select count(*) from jsonb_object_keys(v_result))<>10 then raise exception 'Tabellino incompleto'; end if;
   for v_pid in select value::text::bigint from jsonb_array_elements(v_ids) loop
    v_entry:=v_result->v_pid::text;
    if v_entry is null or not(v_entry ?& array['goals','own','present']) then raise exception 'Tabellino incompleto'; end if;
    if jsonb_typeof(v_entry->'goals')<>'number' or jsonb_typeof(v_entry->'own')<>'number' or jsonb_typeof(v_entry->'present')<>'boolean' then raise exception 'Tipi del tabellino non validi'; end if;
    v_goals:=(v_entry->>'goals')::integer;v_own:=(v_entry->>'own')::integer;v_present:=(v_entry->>'present')::boolean;
    if v_goals is null or v_own is null or v_present is null or v_goals not between 0 and 99 or v_own not between 0 and 99 then raise exception 'Valori non validi'; end if;
    if not v_present and (v_goals>0 or v_own>0) then raise exception 'Un assente non può avere gol'; end if;
   end loop;
   update club_private.matches set result=v_result,updated_at=now() where id=v_match.id;
  when 'round_open' then
   v_season:=(p_data->>'season')::integer;
   if v_season is null then raise exception 'Stagione non valida'; end if;
   if (p_data->>'award') not in ('pollone','bidone') then raise exception 'Premio non valido'; end if;
   select * into v_round from club_private.rounds where season=v_season and award=p_data->>'award' order by turn desc limit 1 for update;
   if found then
    if v_round.status='open' then raise exception 'Chiudi il turno precedente'; end if;
    if v_round.status='final' then raise exception 'Premio già assegnato'; end if;
    v_turn:=v_round.turn+1;v_ids:=p_data->'candidates';
    if v_turn>4 then raise exception 'Massimo quattro turni'; end if;
    if jsonb_typeof(v_ids)<>'array' or jsonb_array_length(v_ids)=0 then raise exception 'Seleziona almeno un candidato'; end if;
    if (select count(distinct value::text::bigint) from jsonb_array_elements(v_ids))<>jsonb_array_length(v_ids) then raise exception 'Candidati duplicati'; end if;
    if not(v_round.candidates @> v_ids) then raise exception 'Seleziona solo candidati del turno precedente'; end if;
   else
    v_turn:=1;select jsonb_agg(id order by id) into v_ids from club_private.players;
    if v_ids is null then raise exception 'Aggiungi i giocatori'; end if;
   end if;
   insert into club_private.rounds(season,award,turn,candidates) values(v_season,p_data->>'award',v_turn,v_ids);
  when 'round_close' then
   update club_private.rounds set status='closed' where id=(p_data->>'id')::bigint and status='open';
   if not found then raise exception 'Turno non aperto'; end if;
  when 'round_final' then
   select * into v_round from club_private.rounds where id=(p_data->>'id')::bigint for update;
   if not found or v_round.status<>'closed' then raise exception 'Chiudi prima il turno'; end if;
   if exists(select 1 from club_private.rounds where season=v_round.season and award=v_round.award and turn>v_round.turn) then raise exception 'Esiste un turno successivo'; end if;
   if jsonb_array_length(v_round.candidates)>0 and not exists(select 1 from club_private.ballots where round_id=v_round.id) then raise exception 'Nessun voto ricevuto'; end if;
   update club_private.rounds set status='final' where id=v_round.id;
  else raise exception 'Operazione sconosciuta';
  end case;
  insert into club_private.audit(actor,action) values(v_actor,p_action);
 end if;
 return jsonb_build_object('ok',true,'id',v_id);
exception when unique_violation then
 raise exception 'Voto già inviato oppure email già associata';
end $$;
revoke all on function public.club_action(text,jsonb) from public,anon;
grant execute on function public.club_action(text,jsonb) to authenticated;


revoke all on club_private.seasons from public,anon,authenticated;
commit;
