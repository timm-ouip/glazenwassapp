-- Wie de planning doet, ziet open klachten: het rode stipje op de dag is juist
-- voor de glazenwasser die bij dat adres aanbelt.
drop policy if exists "Lezen met recht" on public.klachten;
create policy "Lezen met recht" on public.klachten for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('klanten_bekijken'))
      or (select public.heeft_recht('klanten_bewerken'))
      or (select public.heeft_recht('planning'))));
