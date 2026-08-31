-- Wat er op een dag gewassen wordt — en achteraf: wat er werkelijk gedaan is.
--
-- Die twee lopen uiteen: de planning wordt niet altijd afgekregen, soms wordt
-- er juist meer gedaan, en zieke collega's gooien het om. Toch is één
-- selectie genoeg. 's Ochtends vink je aan wat je van plan bent; onderweg
-- haal je eruit wat je oversloeg en vink je aan wat je extra deed. Wat er aan
-- het eind van de dag aanstaat, ís wat je gedaan hebt. Vandaar geen aparte
-- kolommen voor "gepland" en "gedaan".
--
-- Eén tabel, geen kop-tabel erboven: een wasdag bestáát zodra er regels voor
-- die datum zijn. Een `wasdagen`-tabel zou een lege huls zijn.

create table public.wasdag_regels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  datum date not null,
  -- on delete set null: wordt een adres ooit definitief uit de prullenbak
  -- gewist, dan hoort de omzet van vorige week niet stilletjes te krimpen.
  -- De regel blijft, met het bedrag dat hieronder is vastgelegd.
  customer_id uuid references public.customers(id) on delete set null,
  -- Momentopname. Een prijsverhoging van volgend jaar mag een dag van vorige
  -- week niet met terugwerkende kracht duurder maken.
  prijs numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Geen `deleted_at`, anders dan de rest van de app: een vinkje is niets om
-- terug te kunnen halen. Uitvinken haalt de regel weg, opnieuw aanvinken kost
-- één klik. De prullenbak blijft hier dus buiten beeld.

create unique index wasdag_regels_uniek
  on public.wasdag_regels (company_id, datum, customer_id);
create index wasdag_regels_dag_idx on public.wasdag_regels (company_id, datum);

create trigger wasdag_regels_set_company_id before insert on public.wasdag_regels
  for each row execute function public.set_company_id();

alter table public.wasdag_regels enable row level security;

create policy "Bedrijf beheert eigen wasdagen" on public.wasdag_regels
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
