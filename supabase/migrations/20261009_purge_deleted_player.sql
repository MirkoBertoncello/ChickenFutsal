-- Rimozione irreversibile del profilo archiviato; partite e premi storici restano conservati.
begin;
create or replace function public.club_player_purge(p_id bigint,p_confirmation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor bigint;v_name text;v_actor_name text;
begin
 v_actor:=club_private.actor();
 if not exists(select 1 from club_private.members where player_id=v_actor and is_admin) then
  raise exception 'Operazione riservata agli admin';
 end if;
 if p_confirmation is distinct from 'ELIMINA DEFINITIVAMENTE' then raise exception 'Conferma la rimozione definitiva';end if;
 perform pg_advisory_xact_lock(712026);
 if exists(select 1 from club_private.players where id=p_id) then raise exception 'Il giocatore deve prima essere eliminato';end if;
 select profile->>'name' into v_name from club_private.deleted_players where player_id=p_id for update;
 if not found then raise exception 'Giocatore non presente tra gli eliminati';end if;
 delete from club_private.rating_events where player_id=p_id;
 delete from club_private.deleted_players where player_id=p_id;
 -- Elimina anche eventuali copie dell'immagine nei dettagli dei vecchi audit del profilo.
 update club_private.audit set details=jsonb_set(details,'{before}',(details->'before')-'image_data'-'image')
 where details->'before'->>'id'=p_id::text and jsonb_typeof(details->'before')='object';
 update club_private.audit set details=jsonb_set(details,'{after}',(details->'after')-'image_data'-'image')
 where details->'after'->>'id'=p_id::text and jsonb_typeof(details->'after')='object';
 select name into v_actor_name from club_private.players where id=v_actor;
 insert into club_private.audit(actor,actor_name,action,subject,details)
 values(v_actor,v_actor_name,'player_purge',v_name,jsonb_build_object('playerId',p_id));
 return jsonb_build_object('id',p_id);
end $$;
revoke all on function public.club_player_purge(bigint,text) from public,anon;
grant execute on function public.club_player_purge(bigint,text) to authenticated;
commit;
