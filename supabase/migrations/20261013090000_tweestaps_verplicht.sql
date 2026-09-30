-- Tweestapsverificatie verplicht voor iedereen.
--
-- Een wachtwoord alleen is niet meer genoeg om iets te zien of te doen. Na het
-- wachtwoord staat je sessie op "aal1"; pas als je ook de 6 cijfers uit je
-- authenticator-app hebt ingevuld wordt dat "aal2". Supabase zet dat in het
-- token (claim `aal`), en dat token kun je niet zelf vervalsen.
--
-- Twee sloten, zodat er geen achterdeur overblijft:
--
-- 1. Elk verzoek aan de database-API (tabellen én rpc's) van een ingelogde
--    gebruiker zonder aal2 wordt geweigerd, nog vóór er een query draait. Dat
--    dekt in één keer ook de security-definer-functies die RLS overslaan.
--    Niet-ingelogd (anon, de openbare aanmeldpagina) en de servercode met de
--    service-rol merken er niets van.
--
-- 2. current_company_id() geeft zonder aal2 niets terug. Bijna elk RLS-slot
--    loopt daarlangs, en Realtime en de bestandsopslag gaan níét langs slot 1,
--    wel langs dit.
--
-- De Edge Functions zoeken de medewerker op met het token van de gebruiker,
-- dus ook die weigeren vanzelf zonder aal2. De servercode van de app zelf
-- (team.functions.ts) gebruikt de admin-client en controleert het apart.

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.employees
  where id = auth.uid()
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function public.tweestaps_verplicht()
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if coalesce(claims ->> 'role', '') = 'authenticated'
     and coalesce(claims ->> 'aal', '') <> 'aal2' then
    raise sqlstate 'PT403' using
      message = 'Tweestapsverificatie nodig',
      hint = 'Vul eerst de code uit je authenticator-app in.';
  end if;
end;
$$;

grant execute on function public.tweestaps_verplicht() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.tweestaps_verplicht';
notify pgrst, 'reload config';
