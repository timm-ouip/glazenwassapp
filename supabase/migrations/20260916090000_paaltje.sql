-- Paaltje: de assistent die alle binnenkomende mail indeelt en antwoorden
-- klaarzet.
--
-- Tot nu toe las de assistent alleen antwoorden op aankondigingen, met zes
-- vaste soorten. Paaltje leest de hele mailbox (tabel `berichten`), deelt in
-- in categorieën die het bedrijf zelf kan aanpassen, en weet per categorie
-- hoe zelfstandig hij mag zijn.
--
-- Alles van Paaltje hangt aan de mail zelf. Verplaatst de mail op de telefoon
-- naar een andere map, dan reist het mee (zie ophalen.ts).
--
-- Verwijzingen tussen tabellen gaan hier via (id, company_id). RLS kijkt alleen
-- naar de company_id van de rij zelf; zonder dat zou een rij van bedrijf A
-- kunnen wijzen naar een klant of categorie van bedrijf B.

-- ---------------------------------------------------------------------
-- 0. Sleutels om samengesteld naar te verwijzen
-- ---------------------------------------------------------------------

alter table public.berichten add constraint berichten_id_bedrijf_uniek unique (id, company_id);
alter table public.klanten add constraint klanten_id_bedrijf_uniek unique (id, company_id);

-- ---------------------------------------------------------------------
-- 1. Categorieën per bedrijf
-- ---------------------------------------------------------------------

create table public.mail_categorieen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Voor de vaste categorieën een vaste sleutel, zodat Paaltje weet welke
  -- actie erbij hoort ook als het bedrijf de naam verandert. Eigen
  -- categorieën hebben er geen.
  sleutel text check (sleutel in ('klachten', 'nieuwe_klanten', 'afzeggingen', 'overslaan', 'prijsopvraging', 'overig')),
  naam text not null check (char_length(naam) between 1 and 60),
  -- Wat Paaltje mag, als hij zeker genoeg is:
  --   niets            = alleen indelen
  --   concept          = een antwoord klaarzetten
  --   concept_voorstel = antwoord klaarzetten én een actie voorstellen
  --   zelf_doorvoeren  = de actie zelf uitvoeren en het antwoord zelf sturen
  zelfstandigheid text not null default 'concept'
    check (zelfstandigheid in ('niets', 'concept', 'concept_voorstel', 'zelf_doorvoeren')),
  -- Een zin uitleg voor Paaltje bij eigen categorieën: waar gaat dit over.
  omschrijving text not null default '' check (char_length(omschrijving) <= 300),
  volgorde integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

-- Eén vaste categorie per sleutel per bedrijf, ook weggelegd: terugzetten mag
-- nooit botsen met een nieuwe met dezelfde sleutel. Weggooien is dus
-- wegleggen, en een vaste categorie komt nooit dubbel.
create unique index mail_categorieen_sleutel_idx
  on public.mail_categorieen (company_id, sleutel)
  where sleutel is not null;

create trigger mail_categorieen_set_company_id before insert on public.mail_categorieen
  for each row execute function public.set_company_id();

-- De vaste startlijst, met de standaarden die Timmie koos ("veilige mix").
-- Overslaan staat op voorstellen en niet op zelf doorvoeren: een afzender in
-- een mail is na te maken, en dan zou een vreemde namens een klant adressen
-- van de planning kunnen halen. Het bedrijf kan het zelf aanzetten.
create or replace function public.maak_standaard_categorieen(bedrijf uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mail_categorieen (company_id, sleutel, naam, zelfstandigheid, volgorde)
  values
    (bedrijf, 'klachten',       'Klachten',       'concept',          10),
    (bedrijf, 'nieuwe_klanten', 'Nieuwe klanten', 'concept_voorstel', 20),
    (bedrijf, 'afzeggingen',    'Afzeggingen',    'concept_voorstel', 30),
    (bedrijf, 'overslaan',      'Overslaan',      'concept_voorstel', 40),
    (bedrijf, 'prijsopvraging', 'Prijsopvraging', 'concept',          50),
    (bedrijf, 'overig',         'Overig',         'niets',            90)
  on conflict do nothing
$$;

-- Security definer en een bedrijfs-id als invoer: van buitenaf aanroepbaar
-- zou iemand bij een ander bedrijf weggelegde categorieën terug kunnen zetten.
revoke execute on function public.maak_standaard_categorieen(uuid) from public, anon, authenticated;

select public.maak_standaard_categorieen(id) from public.companies;

create or replace function public.companies_standaard_categorieen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.maak_standaard_categorieen(new.id);
  return new;
end
$$;

revoke execute on function public.companies_standaard_categorieen() from public, anon, authenticated;

create trigger companies_standaard_categorieen after insert on public.companies
  for each row execute function public.companies_standaard_categorieen();

-- ---------------------------------------------------------------------
-- 2. Welke categorie(ën) een mail heeft
-- ---------------------------------------------------------------------

create table public.bericht_categorieen (
  bericht_id uuid not null,
  categorie_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  zekerheid numeric(3, 2),
  -- Wie hem erop zette. Een mens die een categorie weghaalt of toevoegt
  -- overschrijft Paaltje; Paaltje leest die mail daarna niet opnieuw in.
  door text not null default 'paaltje' check (door in ('paaltje', 'mens')),
  created_at timestamptz not null default now(),
  primary key (bericht_id, categorie_id),
  foreign key (bericht_id, company_id) references public.berichten(id, company_id) on delete cascade,
  foreign key (categorie_id, company_id) references public.mail_categorieen(id, company_id) on delete cascade
);

create index bericht_categorieen_categorie_idx on public.bericht_categorieen (categorie_id);

create trigger bericht_categorieen_set_company_id before insert on public.bericht_categorieen
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 3. Wat Paaltje van een mail maakte
-- ---------------------------------------------------------------------

alter table public.berichten
  -- Leeg zolang Paaltje hem niet las. Onwaar = bank, leverancier, nieuwsbrief:
  -- die gaat naar "Overige post" en krijgt geen concept.
  add column if not exists is_klantmail boolean,
  add column if not exists samenvatting text not null default '',
  -- Het antwoord dat klaarstaat. Na versturen staat hier wat er echt wegging.
  add column if not exists concept text not null default '',
  -- Wat Paaltje zelf schreef, ongewijzigd: om te zien hoeveel de eigenaar
  -- aanpaste, en daarvan te leren.
  add column if not exists concept_paaltje text not null default '',
  add column if not exists zekerheid numeric(3, 2),
  -- Het voorgestelde of uitgevoerde: maanden en adressen bij overslaan,
  -- adressen bij stoppen, de gegevens van een nieuwe aanmelding, een
  -- richtprijs.
  add column if not exists voorstel jsonb not null default '{}',
  add column if not exists ai_fout text not null default '',
  -- Wie Paaltje denkt dat het is, als het adres niet bij een klant hoort.
  add column if not exists klant_gok_id uuid,
  add column if not exists gelezen_door_paaltje_op timestamptz,
  add column if not exists doorgevoerd_op timestamptz,
  add column if not exists doorgevoerd_automatisch boolean not null default false,
  add column if not exists beantwoord_op timestamptz,
  -- Klaar met deze mail: beantwoord, of bewust niets mee gedaan.
  add column if not exists afgehandeld_op timestamptz,
  -- De eigenaar bepaalde zelf de categorieën (ook "geen"). Paaltje verandert
  -- ze dan niet meer, en rekent bij zijn acties met die indeling.
  add column if not exists indeling_door_mens boolean not null default false,
  -- Paaltje zette hem zelf op afgehandeld (geen klantmail). Leest hij hem
  -- opnieuw en is het toch klantmail, dan gaat dat stempel er weer af.
  add column if not exists afgehandeld_door_paaltje boolean not null default false;

alter table public.berichten
  add constraint berichten_klant_gok_fkey
  foreign key (klant_gok_id, company_id) references public.klanten(id, company_id)
  on delete set null (klant_gok_id);

-- "Wacht op jou": klantmail met iets klaar, nog niet afgehandeld.
create index berichten_wacht_idx
  on public.berichten (company_id, ontvangen_op desc)
  where is_klantmail and afgehandeld_op is null and deleted_at is null and op_server;

-- Per ontvangen mail het eerdere antwoord vinden (leren uit gesprekken).
create index berichten_in_reply_to_idx
  on public.berichten (mailbox_id, in_reply_to)
  where in_reply_to <> '';

-- ---------------------------------------------------------------------
-- 4. Meerdere mailadressen per klant
-- ---------------------------------------------------------------------

create table public.klant_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  klant_id uuid not null,
  -- Altijd opgeschoond opgeslagen: anders vindt het opzoeken "a@b.nl " niet.
  email text not null check (email <> '' and email = lower(trim(email))),
  --   klant = het adres dat op de klant zelf staat (houdt zich vanzelf bij)
  --   mens  = de eigenaar koppelde het (bijv. na een gok van Paaltje)
  bron text not null default 'mens' check (bron in ('klant', 'mens')),
  created_at timestamptz not null default now(),
  foreign key (klant_id, company_id) references public.klanten(id, company_id) on delete cascade
);

-- Twee klanten met hetzelfde adres (een stel) mag; hetzelfde adres twee keer
-- bij één klant niet.
create unique index klant_emails_uniek_idx on public.klant_emails (company_id, klant_id, email);
create index klant_emails_zoek_idx on public.klant_emails (company_id, email);

create trigger klant_emails_set_company_id before insert on public.klant_emails
  for each row execute function public.set_company_id();

-- Het adres op de klant zelf houdt zich bij: nieuw, gewijzigd of leeggemaakt
-- in de app of via de aanmeldpagina, dan volgt de koppeling. Een klant in de
-- prullenbak houdt zijn koppelingen (terugzetten brengt ze terug); het
-- opzoeken filtert op klanten.deleted_at.
create or replace function public.klant_emails_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.klant_emails where klant_id = new.id and bron = 'klant';
  if trim(coalesce(new.email, '')) <> '' then
    insert into public.klant_emails (company_id, klant_id, email, bron)
    values (new.company_id, new.id, lower(trim(new.email)), 'klant')
    -- Stond hetzelfde adres er al met de hand, dan wordt het nu het adres van
    -- de klant zelf: haalt iemand de handmatige koppeling weg, dan blijft dit.
    on conflict (company_id, klant_id, email) do update set bron = 'klant';
  end if;
  return new;
end
$$;

revoke execute on function public.klant_emails_bijhouden() from public, anon, authenticated;

create trigger klanten_emails_bijhouden
  after insert or update of email on public.klanten
  for each row execute function public.klant_emails_bijhouden();

insert into public.klant_emails (company_id, klant_id, email, bron)
select company_id, id, lower(trim(email)), 'klant'
from public.klanten
where trim(email) <> ''
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Vaste afspraken: wat Paaltje van de eigenaar leert
-- ---------------------------------------------------------------------

create table public.paaltje_afspraken (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Leeg = geldt voor alle mail.
  categorie_id uuid,
  tekst text not null check (char_length(tekst) between 1 and 500),
  --   voorgesteld = Paaltje zag dat je zijn concept flink aanpaste
  --   goedgekeurd = geldt vanaf nu
  --   afgewezen   = niet meer voorstellen
  status text not null default 'voorgesteld' check (status in ('voorgesteld', 'goedgekeurd', 'afgewezen')),
  bron_bericht_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (categorie_id, company_id) references public.mail_categorieen(id, company_id)
    on delete set null (categorie_id),
  foreign key (bron_bericht_id, company_id) references public.berichten(id, company_id)
    on delete set null (bron_bericht_id)
);

create index paaltje_afspraken_idx
  on public.paaltje_afspraken (company_id, status)
  where deleted_at is null;

create trigger paaltje_afspraken_set_company_id before insert on public.paaltje_afspraken
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 6. Het rapport kent nu ook berichten en meer soorten
-- ---------------------------------------------------------------------

alter table public.mail_wijzigingen
  add column if not exists bericht_id uuid,
  -- Wat er vóór en na stond bij de nieuwe soorten (stoppen: welke adressen
  -- weggelegd; aanmelding: welke rij; klant_email: welke koppeling), zodat
  -- ook die precies terug te draaien zijn. Overslaan houdt zijn eigen kolommen.
  add column if not exists details jsonb not null default '{}';

alter table public.mail_wijzigingen
  add constraint mail_wijzigingen_bericht_fkey
  foreign key (bericht_id, company_id) references public.berichten(id, company_id)
  on delete set null (bericht_id);

alter table public.mail_wijzigingen drop constraint if exists mail_wijzigingen_soort_check;
alter table public.mail_wijzigingen
  add constraint mail_wijzigingen_soort_check
  check (soort in ('overslaan', 'stoppen', 'aanmelding', 'klant_email'));

create index if not exists mail_wijzigingen_bericht_idx
  on public.mail_wijzigingen (bericht_id)
  where bericht_id is not null;

-- Wat Paaltje na een mail deed hoort bij de mail, en die is alleen voor de
-- eigenaar. Dus het rapport ook.
drop policy if exists "Bedrijf beheert eigen mailwijzigingen" on public.mail_wijzigingen;
create policy "Eigenaar beheert eigen mailwijzigingen" on public.mail_wijzigingen
  for all to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()))
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- ---------------------------------------------------------------------
-- 7. Richtprijs: wat vergelijkbare adressen betalen
-- ---------------------------------------------------------------------

-- De mediaan van de prijs in dezelfde straat; zijn daar te weinig adressen,
-- dan in de hele wijk. Alleen wat niet in de prullenbak ligt (adres, straat
-- of wijk). Security invoker: RLS op customers geldt, dus alleen de eigen
-- adressen tellen mee.
create or replace function public.richtprijs(straat uuid)
returns table (prijs numeric, aantal integer, bereik text)
language sql
stable
security invoker
set search_path = public
as $$
  with deze as (
    select s.id, s.district_id
    from public.streets s
    join public.districts d on d.id = s.district_id
    where s.id = richtprijs.straat and s.deleted_at is null and d.deleted_at is null
  ),
  in_straat as (
    select c.price
    from public.customers c
    join deze on deze.id = c.street_id
    where c.deleted_at is null and c.price > 0
  ),
  in_wijk as (
    select c.price
    from public.customers c
    join public.streets s on s.id = c.street_id
    join deze on deze.district_id = s.district_id
    where c.deleted_at is null and s.deleted_at is null and c.price > 0
  )
  select
    percentile_cont(0.5) within group (order by price)::numeric(10, 2),
    count(*)::integer,
    'straat'
  from in_straat
  having count(*) >= 3
  union all
  select
    percentile_cont(0.5) within group (order by price)::numeric(10, 2),
    count(*)::integer,
    'wijk'
  from in_wijk
  having count(*) >= 3 and (select count(*) from in_straat) < 3
$$;

revoke all on function public.richtprijs(uuid) from public, anon;
grant execute on function public.richtprijs(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Slot op de deur
-- ---------------------------------------------------------------------

-- Categorieën en afspraken: alleen de eigenaar, en niet echt verwijderen.
-- Weggooien is wegleggen (deleted_at); echt wissen zou alle indelingen van
-- mail in die categorie meenemen.
alter table public.mail_categorieen enable row level security;
create policy "Eigenaar ziet eigen categorieen" on public.mail_categorieen
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));
create policy "Eigenaar maakt categorieen" on public.mail_categorieen
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()) and sleutel is null);
create policy "Eigenaar wijzigt categorieen" on public.mail_categorieen
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()))
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

alter table public.paaltje_afspraken enable row level security;
create policy "Eigenaar ziet afspraken van Paaltje" on public.paaltje_afspraken
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));
create policy "Eigenaar maakt afspraken" on public.paaltje_afspraken
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));
create policy "Eigenaar wijzigt afspraken" on public.paaltje_afspraken
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()))
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- Een categorie van een mail weghalen is gewoon werk, dus hier mag alles.
alter table public.bericht_categorieen enable row level security;
create policy "Eigenaar beheert categorieen van berichten" on public.bericht_categorieen
  for all to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()))
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- De categorieën van één mail vervangen, in één stap: zonder dat is een mail
-- al zijn categorieën kwijt als het invoegen na het weghalen mislukt. Security
-- definer omdat de app de mail zelf niet mag bijwerken; daarom kijkt de
-- functie zelf naar bedrijf en eigenaar, en neemt hij alleen categorieën van
-- het eigen bedrijf.
create or replace function public.zet_bericht_categorieen(bericht uuid, categorieen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan de indeling aanpassen.';
  end if;
  if not exists (select 1 from public.berichten where id = bericht and company_id = bedrijf) then
    raise exception 'Die mail bestaat niet.';
  end if;
  -- Leest Paaltje hem net, dan zou hij zijn eigen indeling erbij zetten.
  if exists (select 1 from public.berichten where id = bericht and paaltje_status = 'bezig') then
    raise exception 'Paaltje leest deze mail net. Probeer het zo nog eens.';
  end if;
  delete from public.bericht_categorieen where bericht_id = bericht;
  insert into public.bericht_categorieen (bericht_id, categorie_id, company_id, door)
    select bericht, c.id, bedrijf, 'mens'
    from public.mail_categorieen c
    where c.id = any(categorieen) and c.company_id = bedrijf and c.deleted_at is null;
  update public.berichten set indeling_door_mens = true where id = bericht;
end
$$;

revoke all on function public.zet_bericht_categorieen(uuid, uuid[]) from public, anon;
grant execute on function public.zet_bericht_categorieen(uuid, uuid[]) to authenticated;

-- Mailadressen van klanten zijn klantgegevens, net als klanten zelf: iedereen
-- in het bedrijf. De samengestelde verwijzing houdt het binnen het bedrijf.
alter table public.klant_emails enable row level security;
create policy "Bedrijf beheert eigen klantmailadressen" on public.klant_emails
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
