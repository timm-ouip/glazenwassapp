-- Sjablonen voor de berichten aan klanten, en de snelle redenen.
--
-- Tot nu toe stond de tekst van de aankondiging hard in de app en typte je
-- hem elke keer opnieuw bij. Nu staan de teksten in de instellingen: per
-- soort meerdere sjablonen, waarvan er één de standaard is.
--
--   aankondiging  "Morgen komen wij uw ramen wassen."
--   wijziging     "We komen niet op … maar op …", met een reden.
--   niet_af       "We zijn deze keer niet aan uw adres toegekomen."
--
-- Plaatshouders: {{naam}} {{adres}} {{datum}} {{nieuwe datum}} {{reden}}
-- {{tijdvak}}. Wat er niet in staat, vult de app onderaan aan (het tijdvak).

create table public.bericht_sjablonen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  soort text not null check (soort in ('aankondiging', 'wijziging', 'niet_af')),
  naam text not null check (length(btrim(naam)) between 1 and 60),
  onderwerp text not null default '' check (char_length(onderwerp) <= 200),
  tekst text not null check (char_length(tekst) between 1 and 20000),
  -- Het WhatsApp-sjabloon dat hierbij hoort (Meta moet dat goedkeuren).
  wa_sjabloon_id uuid references public.wa_sjablonen(id) on delete set null,
  standaard boolean not null default false,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bericht_sjablonen_company_idx
  on public.bericht_sjablonen (company_id, soort, sort_order) where deleted_at is null;
-- Eén standaard per soort.
create unique index bericht_sjablonen_standaard_idx
  on public.bericht_sjablonen (company_id, soort) where standaard and deleted_at is null;

create table public.snelle_redenen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tekst text not null check (length(btrim(tekst)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index snelle_redenen_company_idx on public.snelle_redenen (company_id, sort_order);

alter table public.bericht_sjablonen enable row level security;
alter table public.snelle_redenen enable row level security;

-- Lezen mag wie mail mag lezen of versturen; beheren hoort bij versturen.
create policy "Lezen met recht" on public.bericht_sjablonen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (public.heeft_recht('mail_lezen') or public.heeft_recht('mail_versturen'))
  );
create policy "Beheren met recht" on public.bericht_sjablonen
  for all to authenticated
  using (company_id = (select public.current_company_id()) and public.heeft_recht('mail_versturen'))
  with check (company_id = (select public.current_company_id()) and public.heeft_recht('mail_versturen'));
create policy "Lezen met recht" on public.snelle_redenen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (public.heeft_recht('mail_lezen') or public.heeft_recht('mail_versturen'))
  );
create policy "Beheren met recht" on public.snelle_redenen
  for all to authenticated
  using (company_id = (select public.current_company_id()) and public.heeft_recht('mail_versturen'))
  with check (company_id = (select public.current_company_id()) and public.heeft_recht('mail_versturen'));

create trigger bericht_sjablonen_set_company_id before insert on public.bericht_sjablonen
  for each row execute function public.set_company_id();
create trigger snelle_redenen_set_company_id before insert on public.snelle_redenen
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- De teksten waarmee een bedrijf begint
-- ---------------------------------------------------------------------
create or replace function public.standaard_sjablonen(bedrijf uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  naam text;
begin
  select c.name into naam from public.companies c where c.id = bedrijf;
  naam := coalesce(nullif(btrim(naam), ''), 'Ons bedrijf');

  insert into public.bericht_sjablonen (company_id, soort, naam, onderwerp, tekst, standaard, sort_order)
  values
    (bedrijf, 'aankondiging', 'Gewoon', 'Morgen wassen wij uw ramen',
     'Beste {{naam}},' || E'\n\n' ||
     'Morgen komen wij langs om de ramen van {{adres}} te wassen. {{tijdvak}}' || E'\n\n' ||
     'Komt het niet uit? Antwoord dan gewoon even op deze mail, dan slaan we deze keer over.' || E'\n\n' ||
     'Met vriendelijke groet,' || E'\n' || naam,
     true, 0),
    (bedrijf, 'wijziging', 'Standaard', 'Wijziging in de planning',
     'Beste {{naam}},' || E'\n\n' ||
     '{{reden}} komen we niet op {{datum}}, maar op {{nieuwe datum}} de ramen van {{adres}} wassen. {{tijdvak}}' || E'\n\n' ||
     'Komt dat niet uit? Antwoord dan even op deze mail.' || E'\n\n' ||
     'Met vriendelijke groet,' || E'\n' || naam,
     true, 0),
    (bedrijf, 'niet_af', 'Standaard', 'We komen terug voor uw ramen',
     'Beste {{naam}},' || E'\n\n' ||
     'We zijn vandaag niet meer aan de ramen van {{adres}} toegekomen. {{reden}} We komen op {{nieuwe datum}} terug. {{tijdvak}}' || E'\n\n' ||
     'Met vriendelijke groet,' || E'\n' || naam,
     true, 0)
  on conflict do nothing;

  insert into public.snelle_redenen (company_id, tekst, sort_order)
  values (bedrijf, 'Door de regen', 0), (bedrijf, 'Door ziekte', 1), (bedrijf, 'We kwamen niet af', 2)
  on conflict do nothing;
end
$$;

-- Nieuwe bedrijven krijgen ze meteen.
create or replace function public.sjablonen_bij_bedrijf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.standaard_sjablonen(new.id);
  return null;
end
$$;
create trigger companies_sjablonen after insert on public.companies
  for each row execute function public.sjablonen_bij_bedrijf();

-- En de bedrijven die er al zijn.
do $$
declare
  b uuid;
begin
  for b in select id from public.companies loop
    perform public.standaard_sjablonen(b);
  end loop;
end
$$;

revoke all on function public.standaard_sjablonen(uuid) from public, anon, authenticated;
