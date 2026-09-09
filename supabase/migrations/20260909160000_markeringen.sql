-- Eigen kleuren voor de printlijst, met je eigen tekst erbij.
--
-- Tot nu toe stonden er twee vast in de code: geel was "extra opletten" en
-- groen "nieuwe klant". Maar wat een kleur betekent verschilt per bedrijf, en
-- twee is soms te weinig. Vanaf nu bepaal je ze zelf bij Instellingen, en wat
-- je daar maakt staat meteen onder de rechtermuisknop op een adres.
--
-- `tint` is geen vrije kleurcode maar een keuze uit vier: die vier zijn in het
-- ontwerp uitgezocht op leesbaarheid, in de app én op papier, en ze hebben
-- allemaal een lichte en een donkere variant. Een vrij gekozen kleur zou in de
-- donkere modus of op een zwart-witprint onleesbaar kunnen uitpakken.
-- Rood zit er bewust niet bij: dat betekent al "deze maand overgeslagen".

create table public.markeringen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Wat er in customers.markering komt te staan. Voor de twee die er al
  -- waren is dat 'geel' en 'groen', zodat bestaande adressen hun kleur
  -- houden; nieuwe krijgen er een van de app.
  sleutel text not null,
  naam text not null,
  tint text not null check (tint in ('amber', 'groen', 'paars', 'blauw')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index markeringen_sleutel_uniek on public.markeringen (company_id, sleutel);
create index markeringen_bedrijf_idx on public.markeringen (company_id, sort_order);

create trigger markeringen_set_company_id before insert on public.markeringen
  for each row execute function public.set_company_id();

alter table public.markeringen enable row level security;

create policy "Bedrijf beheert eigen markeringen" on public.markeringen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- De twee die er waren, voor elk bedrijf dat er al is. Zo verandert er voor
-- niemand iets tot hij ze zelf aanpast.
insert into public.markeringen (company_id, sleutel, naam, tint, sort_order)
select id, 'geel', 'Extra opletten', 'amber', 1 from public.companies
union all
select id, 'groen', 'Nieuwe klant', 'groen', 2 from public.companies;

-- De kolom mocht alleen '', 'geel' of 'groen' bevatten. Nu er zelfgemaakte
-- markeringen bij komen kan dat niet meer; welke sleutels bestaan staat in de
-- tabel hierboven.
alter table public.customers drop constraint if exists customers_markering_check;
