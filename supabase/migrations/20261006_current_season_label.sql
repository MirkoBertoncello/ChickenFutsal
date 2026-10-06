-- Eseguire dopo 20261006_custom_seasons.sql. Cambia solo il nome della stagione attiva.
-- Non apre votazioni e conserva partite, statistiche e schede esistenti.
begin;
update club_private.seasons set name='2025/2026' where closed_at is null;
commit;
