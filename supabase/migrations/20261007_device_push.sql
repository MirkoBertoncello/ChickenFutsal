-- Stato e disattivazione delle notifiche del solo dispositivo del membro corrente.
create or replace function public.club_device_push(p_endpoint text,p_disable boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor bigint:=club_private.actor();
begin
 if p_disable then
  delete from club_private.push_subscriptions where player_id=v_actor and endpoint=p_endpoint;
 end if;
 return jsonb_build_object('active',exists(select 1 from club_private.push_subscriptions where player_id=v_actor and endpoint=p_endpoint));
end;
$$;
revoke all on function public.club_device_push(text,boolean) from public,anon;
grant execute on function public.club_device_push(text,boolean) to authenticated;
