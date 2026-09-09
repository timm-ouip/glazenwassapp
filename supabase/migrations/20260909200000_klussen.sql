-- Extra opdrachten: werk bij een adres dat niet aan een maand vastzit.
--
-- Een klant vraagt of de dakrand ook meegenomen kan worden. Daar zeg je ja
-- op, je maakt er een prijs voor, en je doet het als je toch in die wijk bent
-- en er tijd is. Er hoort geen ronde bij en geen maand: het blijft liggen tot
-- het uitkomt.
--
-- Dat is iets anders dan customers.maandwerk. Dat is werk dat in bepaalde
-- kalendermaanden meekomt en zich elk jaar herhaalt — een serre die in de
-- even maanden meegaat. Een eenmalige klus past daar niet in.

create table public.klussen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  omschrijving text not null,
  prijs numeric not null default 0,
  -- De dag waarop hij meerijdt. Leeg = staat open, nog niet ingedeeld.
  gepland_op date,
  -- Zelf afgevinkt, en op welke dag. Leeg = nog te doen, ook als hij op een
  -- dag stond die inmiddels geweest is: dan is hij niet gedaan, en dan telt
  -- hij ook nergens als omzet. Zie telDagVan() in src/lib/klussen.ts.
  gedaan_op date,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Voor de strook onder de kalender en voor de dagpagina.
create index klussen_dag_idx
  on public.klussen (company_id, gepland_op) where deleted_at is null;
-- Voor het dossier: wat staat er nog open bij dít adres.
create index klussen_adres_idx
  on public.klussen (company_id, customer_id) where deleted_at is null;

create trigger klussen_set_company_id before insert on public.klussen
  for each row execute function public.set_company_id();

alter table public.klussen enable row level security;

create policy "Bedrijf beheert eigen klussen" on public.klussen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
