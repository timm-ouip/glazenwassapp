-- Wie uit het team gehaald wordt, hoort ook uitgelogd te worden.
--
-- Supabase heeft daar geen beheerdersknop voor: auth.admin.signOut() wil het
-- token van die persoon zelf hebben, en dat heeft de eigenaar niet. Dus doen
-- we het hier, met de servicesleutel: de sessies van die gebruiker weg. Zijn
-- app kan zich dan niet meer vernieuwen en komt op het inlogscherm uit.
create or replace function public.sessies_intrekken(gebruiker uuid)
returns void
language sql
volatile
security definer
set search_path = public, auth
as $$
  delete from auth.sessions where user_id = gebruiker;
  -- Losse vernieuwingssleutels die niet aan een sessie hangen (oudere rijen)
  -- blijven anders staan; user_id is daar tekst, vandaar de cast.
  delete from auth.refresh_tokens where user_id = gebruiker::text;
$$;

revoke all on function public.sessies_intrekken(uuid) from public, anon, authenticated;
grant execute on function public.sessies_intrekken(uuid) to service_role;
