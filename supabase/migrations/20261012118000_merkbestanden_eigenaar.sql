-- De merkbestanden bij de eigenaar leggen.
--
-- In de vorige migratie mocht iedereen met het recht `facturen` briefpapier
-- uploaden. Dat loopt scheef: waar het pad naartoe geschreven wordt -- de
-- kolom `factuur_briefpapier_pad` op `companies` -- mag alleen de eigenaar
-- bij ("Eigenaar wijzigt bedrijf"). Iemand anders kon dus wel een bestand
-- neerzetten, maar de factuur er nooit naar laten kijken: een upload die
-- lukt en toch niets doet, met een los bestand in de bak als aandenken.
--
-- Lezen blijft wel bij het recht `facturen`: in dezelfde bak staan de
-- verstuurde facturen, en die mag iedereen zien die ze mag versturen.

drop policy if exists "Merkbestanden van eigen bedrijf opslaan" on storage.objects;
drop policy if exists "Merkbestanden van eigen bedrijf vervangen" on storage.objects;
drop policy if exists "Merkbestanden van eigen bedrijf weggooien" on storage.objects;

create policy "Merkbestanden van eigen bedrijf opslaan" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.is_eigenaar())
  );

create policy "Merkbestanden van eigen bedrijf vervangen" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.is_eigenaar())
  )
  with check (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.is_eigenaar())
  );

create policy "Merkbestanden van eigen bedrijf weggooien" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.is_eigenaar())
  );
