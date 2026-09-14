-- Een rem op proefmails die niet te omzeilen is.
--
-- Een proef mag naar een zelfgekozen adres, via het Brevo-account van heel
-- Wooshy. Daarom hooguit 10 per uur per bedrijf. Twee gaten dicht:
--
-- 1. De telling kijkt naar de rijen in `mailingen`. Die mocht de browser zelf
--    wijzigen en weggooien, en dan telde de rem weer vanaf nul. Alleen de
--    server schrijft er (met de service-role-sleutel); de app leest ze alleen.
-- 2. Tellen en vastleggen gebeurt in één stap, met een slot per bedrijf. Anders
--    zien tien verzoeken tegelijk allemaal "nog 0 verstuurd".

drop policy if exists "Bedrijf beheert eigen mailingen" on public.mailingen;
create policy "Bedrijf ziet eigen mailingen" on public.mailingen
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists "Bedrijf beheert eigen ontvangers" on public.mail_ontvangers;
create policy "Bedrijf ziet eigen ontvangers" on public.mail_ontvangers
  for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Geeft het id van de nieuwe proef-mailing, of null als het uur vol is.
create or replace function public.proefmail_vastleggen(
  bedrijf uuid,
  dag date,
  onderwerp text,
  tekst text,
  door uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  aantal integer;
  nieuw uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('proefmail:' || bedrijf::text, 0));

  select count(*) into aantal
  from public.mailingen
  where company_id = bedrijf
    and test
    and created_at > now() - interval '1 hour';
  if aantal >= 10 then
    return null;
  end if;

  insert into public.mailingen (company_id, datum, onderwerp, tekst, test, verzonden_door)
  values (bedrijf, dag, proefmail_vastleggen.onderwerp, proefmail_vastleggen.tekst, true, door)
  returning id into nieuw;
  return nieuw;
end
$$;

revoke all on function public.proefmail_vastleggen(uuid, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.proefmail_vastleggen(uuid, date, text, text, uuid) to service_role;
