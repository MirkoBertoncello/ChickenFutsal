-- 1 MiB binario: 1.398.104 caratteri base64 più prefisso data URL.
create or replace function public.club_player_image(p_id bigint,p_image text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor bigint:=club_private.actor();v_name text;v_actor_name text;v_had boolean;
begin
 if not exists(select 1 from club_private.members where player_id=v_actor and is_admin) then raise exception 'Operazione riservata agli admin';end if;
 if p_image is not null and (length(p_image)>1398127 or p_image !~ '^data:image/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$') then raise exception 'Immagine non valida o troppo grande';end if;
 select name,image_data is not null into v_name,v_had from club_private.players where id=p_id for update;
 if not found then raise exception 'Giocatore inesistente';end if;
 update club_private.players set image_data=p_image where id=p_id;
 select name into v_actor_name from club_private.players where id=v_actor;
 insert into club_private.audit(actor,actor_name,action,subject,details) values(v_actor,v_actor_name,'player_image',v_name,jsonb_build_object('before',jsonb_build_object('hasImage',v_had),'after',jsonb_build_object('hasImage',p_image is not null)));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.club_player_image(bigint,text) from public,anon;
grant execute on function public.club_player_image(bigint,text) to authenticated;
