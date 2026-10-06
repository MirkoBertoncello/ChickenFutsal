-- PRIMA modifica questi due valori e poi esegui nel SQL Editor.
-- L'account si crea sul sito con la stessa email, confermandola.
do $$
declare v_email text := 'SOSTITUISCI-CON-LA-TUA-EMAIL';
        v_name text := 'SOSTITUISCI-CON-IL-TUO-NOME';
        v_id bigint;
begin
 if v_email not like '%@%' or v_name like 'SOSTITUISCI%' then
  raise exception 'Inserisci la tua email e il tuo nome prima di eseguire';
 end if;
 if exists(select 1 from club_private.members where is_admin) then
  raise exception 'Esiste già un admin. Aggiungi gli altri dal sito.';
 end if;
 insert into club_private.players(name,role) values(v_name,'Regista') returning id into v_id;
 insert into club_private.members(player_id,email,is_admin,see_all) values(v_id,lower(trim(v_email)),true,true);
end $$;
