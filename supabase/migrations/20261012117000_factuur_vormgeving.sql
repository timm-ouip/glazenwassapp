-- Fase 2 van de facturen: eigen briefpapier en vormgeving.
--
-- De factuur wordt serverside getekend (_gedeeld/factuurpdf.ts). Tot nu toe
-- zette die er altijd zelf een kop boven met de bedrijfsnaam en het adres. Wie
-- eigen briefpapier heeft, heeft dat al op het papier staan -- en dan botst de
-- tekst op het logo en staat het adres er twee keer. Daarom horen deze dingen
-- bij elkaar: het briefpapier zelf, hoeveel ruimte de tekst ervoor vrij laat,
-- en of de kop en de voet nog van ons moeten komen.
--
-- De maten staan in millimeters, niet in punten. Dit is wat je in Instellingen
-- verschuift, en een liniaal langs een uitdraai is de enige eerlijke manier om
-- te zien of het klopt.

alter table public.companies
  -- Pad in de opslagbak `facturen`, altijd <company_id>/merk/<bestand>.
  add column factuur_briefpapier_pad text,
  add column factuur_kader_boven integer not null default 20
    check (factuur_kader_boven between 0 and 150),
  add column factuur_kader_onder integer not null default 20
    check (factuur_kader_onder between 0 and 100),
  -- Staan naam en adres al op het briefpapier, dan gaan deze uit.
  add column factuur_eigen_kop boolean not null default true,
  add column factuur_eigen_voet boolean not null default true,
  -- Accentkleur als #rrggbb; leeg is het zwart-grijs van nu.
  add column factuur_kleur text check (factuur_kleur ~ '^#[0-9a-fA-F]{6}$'),
  add column factuur_koptekst text,
  add column factuur_voettekst text;

comment on column public.companies.factuur_kader_boven is
  'Millimeters die bovenaan de factuur vrij blijven voor het briefpapier.';
comment on column public.companies.factuur_kader_onder is
  'Millimeters die onderaan de factuur vrij blijven voor het briefpapier.';

-- Het briefpapier gaat in dezelfde bak als de verstuurde facturen, maar in een
-- eigen map: <bedrijf>/merk/. Schrijven mag alleen daar. De verstuurde
-- facturen staan onder <bedrijf>/<jaar>/ en blijven zo onaanraakbaar vanuit de
-- browser -- die zet alleen de service role neer, en dat moet zo blijven: dat
-- papier ligt bij de klant.

create policy "Merkbestanden van eigen bedrijf opslaan" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.heeft_recht('facturen'))
  );

create policy "Merkbestanden van eigen bedrijf vervangen" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.heeft_recht('facturen'))
  )
  with check (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.heeft_recht('facturen'))
  );

create policy "Merkbestanden van eigen bedrijf weggooien" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'facturen'
    and (storage.foldername(name))[1] = (select public.current_company_id())::text
    and (storage.foldername(name))[2] = 'merk'
    and (select public.heeft_recht('facturen'))
  );
