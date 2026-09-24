-- Een herstelpunt vóór het omzetten naar testgegevens.
--
-- Timmie wil dat de app echte testgegevens bevat: willekeurige prijzen en
-- frequenties, en verzonnen namen, mailadressen en telefoonnummers. Dat is
-- niet terug te draaien, dus eerst een kopie van alles wat overschreven gaat
-- worden. De kopie blijft in de database staan; hij verlaat de server niet.
--
-- Terugzetten kan later met een `update ... from` per tabel; de kolommen
-- hieronder zijn precies de kolommen die het husselen aanraakt.
--
-- Deze tabellen mogen weg zodra het zeker is dat de echte gegevens niet meer
-- nodig zijn: `drop table public.herstel_klanten, public.herstel_customers,
-- public.herstel_adres_prijzen, public.herstel_klus_prijzen,
-- public.herstel_wasdag_prijzen;`

create table if not exists public.herstel_klanten as
  select id, company_id, naam, bedrijfsnaam, email, email2, factuur_email,
         telefoon, telefoon2, straat, huisnummer, postcode, plaats
    from public.klanten;

create table if not exists public.herstel_customers as
  select id, company_id, frequency, interval_maanden, ritme, start_maand, postcode
    from public.customers;

create table if not exists public.herstel_adres_prijzen as
  select customer_id, company_id, prijs, maandwerk_extra from public.adres_prijzen;

create table if not exists public.herstel_klus_prijzen as
  select klus_id, company_id, prijs from public.klus_prijzen;

create table if not exists public.herstel_wasdag_prijzen as
  select regel_id, company_id, prijs from public.wasdag_prijzen;

comment on table public.herstel_klanten is
  'Kopie van de echte klantgegevens van vóór het omzetten naar testgegevens (24-09-2026). Mag weg zodra de echte gegevens niet meer nodig zijn.';

-- Niemand mag hier via de app bij: dit zijn precies de gegevens die we juist
-- uit beeld halen. Alleen de beheerder van de database komt erbij.
alter table public.herstel_klanten enable row level security;
alter table public.herstel_customers enable row level security;
alter table public.herstel_adres_prijzen enable row level security;
alter table public.herstel_klus_prijzen enable row level security;
alter table public.herstel_wasdag_prijzen enable row level security;

revoke all on public.herstel_klanten from anon, authenticated;
revoke all on public.herstel_customers from anon, authenticated;
revoke all on public.herstel_adres_prijzen from anon, authenticated;
revoke all on public.herstel_klus_prijzen from anon, authenticated;
revoke all on public.herstel_wasdag_prijzen from anon, authenticated;
