-- Eseguire solo questa migrazione per aggiungere eliminazione giocatori.
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
   if v_season is null or v_season<>extract(year from (p_data->>'date')::date)::integer then raise exception 'Data e stagione non coerenti'; end if;
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
   if v_season not between 2020 and 2100 or v_season is null then raise exception 'Stagione non valida'; end if;
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

