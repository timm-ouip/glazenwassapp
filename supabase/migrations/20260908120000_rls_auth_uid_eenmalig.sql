-- auth.uid() één keer per query in plaats van één keer per rij.
--
-- In een policy is `auth.uid()` voor Postgres een gewone functieaanroep, en
-- die wordt bij het filteren voor élke rij opnieuw uitgevoerd. Zet je hem in
-- een subquery, dan ziet de planner dat er niets in staat wat per rij
-- verandert, rekent hij hem één keer uit en gebruikt hij die uitkomst voor de
-- hele tabel. Dat is precies wat de performance-advisor van Supabase
-- aanraadt (lint 0003_auth_rls_initplan).
--
-- Wie wat mag verandert hier niet: alleen de haakjes eromheen zijn nieuw.
-- Vandaar `alter policy` en geen drop-en-opnieuw-aanmaken — dan is er geen
-- moment waarop de tabel even zonder policy staat.
--
-- Op de huidige hoeveelheid rijen scheelt dit niets merkbaars. Het gaat om
-- later: dit is het soort kosten dat pas opvalt als een tabel groot is, en
-- dan is het lastiger te vinden.

alter policy "Eigenaar wijzigt bedrijf" on public.companies
  using (
    id = public.current_company_id()
    and exists (
      select 1 from public.employees e
      where e.id = (select auth.uid()) and e.rol = 'eigenaar'
    )
  );

alter policy "Eigenaar verwijdert medewerkers" on public.employees
  using (
    company_id = public.current_company_id()
    and exists (
      select 1 from public.employees e
      where e.id = (select auth.uid()) and e.rol = 'eigenaar'
    )
  );
