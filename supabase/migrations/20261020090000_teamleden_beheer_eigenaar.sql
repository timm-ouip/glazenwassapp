-- Teamleden beheren doet alleen de eigenaar.
--
-- De regel "Beheer teamleden" hing aan het recht instellingen_team. Maar dat
-- recht heet "Team bekijken": wie het heeft, mag zien wie er in het team zit,
-- niet mensen toevoegen, hernoemen of weghalen. De app laat die knoppen ook
-- alleen de eigenaar zien; via de API kon het met alleen het kijkrecht wel.
--
-- Lezen verandert niet: "Zie teamleden van je bedrijf" laat iedereen van het
-- bedrijf de teamleden zien (de dagpagina toont wie er in jouw team zit).
-- Teams per dag indelen schrijft in dag_ploegen en dag_ploeg_leden, niet
-- hier, en blijft dus aan het recht planning hangen. Het koppelen aan een
-- account (uitnodigen, accepteren, een naam die meeloopt) gaat via de server
-- of via functies met security definer, en merkt hier ook niets van.

drop policy if exists "Beheer teamleden" on public.teamleden;

create policy "Eigenaar voegt teamleden toe" on public.teamleden
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and public.is_eigenaar());
create policy "Eigenaar wijzigt teamleden" on public.teamleden
  for update to authenticated
  using (company_id = (select public.current_company_id()) and public.is_eigenaar())
  with check (company_id = (select public.current_company_id()) and public.is_eigenaar());
create policy "Eigenaar haalt teamleden weg" on public.teamleden
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and public.is_eigenaar());
