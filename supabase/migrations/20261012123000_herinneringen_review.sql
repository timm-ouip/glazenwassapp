-- Wat de nakijker ving op de herinneringen.
--
-- Drie dingen, en het eerste is het vervelendste: een trap uitzetten legde
-- álles erna stil.

-- ---------------------------------------------------------------------
-- 1. Niet "de volgende trap", maar "de eerstvolgende die aanstaat"
-- ---------------------------------------------------------------------
-- De oude versie zocht de trap die precies één hoger was dan waar de factuur
-- stond. Zette je de eerste herinnering uit, dan bleef elke factuur op trap 0
-- staan en kwam hij nooit bij de tweede -- terwijl die in het scherm gewoon
-- "Aan" stond. Hetzelfde bij het weghalen van een trap in het midden.
--
-- Meteen twee andere dingen rechtgezet:
--
-- * Het mailadres. De oude versie keek alleen naar het adres dat bij het
--   versturen bevroren is. Een factuur die geprint of geappt was toen de klant
--   nog geen mailadres had, kreeg daardoor nooit een herinnering -- ook niet
--   nadat hij er een gaf. De facturenlijst valt in zo'n geval wél terug op het
--   huidige adres, dus de app rekende op twee plekken anders.
-- * Het openstaande bedrag werd per factuur twee keer uitgerekend (één keer om
--   op te filteren, één keer om terug te geven). Nu één keer, in een
--   tussenstap.

create or replace function public.factuur_herinneringen_klaar(op date, bedrijf uuid default null)
returns table (
  factuur_id uuid,
  company_id uuid,
  nummer text,
  klant text,
  mail text,
  open_bedrag numeric,
  vervaldatum date,
  dagen_open integer,
  trap smallint,
  onderwerp text,
  tekst text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    f.company_id,
    f.nummer,
    coalesce(nullif(btrim(f.klantgegevens->>'bedrijfsnaam'), ''),
             nullif(btrim(f.klantgegevens->>'naam'), ''),
             nullif(btrim(k.bedrijfsnaam), ''), k.naam, ''),
    t.adres,
    t.open_bedrag,
    f.vervaldatum,
    (op - f.vervaldatum)::integer,
    h.volgnummer,
    h.onderwerp,
    h.tekst
  from public.facturen f
  join public.klanten k on k.id = f.klant_id and k.company_id = f.company_id
  cross join lateral (
    select
      round((public.factuur_totalen(f.id) ->> 'incl')::numeric - coalesce(f.betaald_bedrag, 0), 2)
        as open_bedrag,
      coalesce(nullif(btrim(f.klantgegevens->>'email'), ''), public.factuur_mailadres(k))
        as adres
  ) t
  -- De eerstvolgende trap die aanstaat, niet per se de volgende in de rij.
  join lateral (
    select h2.volgnummer, h2.na_dagen, h2.onderwerp, h2.tekst
    from public.factuur_herinneringen h2
    where h2.company_id = f.company_id
      and h2.aan
      and h2.volgnummer > f.herinnering_trap
    order by h2.volgnummer
    limit 1
  ) h on true
  where f.deleted_at is null
    -- Een creditnota herinner je niet: daar krijgt de klant geld van jou.
    and f.soort = 'factuur'
    and f.status = 'verstuurd'
    and f.nummer is not null
    and f.vervaldatum is not null
    and f.vervaldatum + h.na_dagen <= op
    and (f.met_rust_tot is null or f.met_rust_tot < op)
    and t.adres <> ''
    and t.open_bedrag > 0
    and (bedrijf is null or f.company_id = bedrijf)
  order by f.vervaldatum, f.nummer
$$;

revoke execute on function public.factuur_herinneringen_klaar(date, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. De trap kunnen zetten én terugdraaien
-- ---------------------------------------------------------------------
-- De ronde zette de trap pas omhoog ná een geslaagde mail. Dat is goed tegen
-- "een herinnering stilletjes overslaan", maar er zat geen rem de andere kant
-- op: lukte de mail wél en dat ene laatste stapje niet, dan ging dezelfde
-- herinnering de volgende ochtend weer weg, en de ochtend daarna weer.
--
-- Daarom zet de ronde de trap nu vóór het versturen en draait hem terug als
-- de mail mislukt. In het ergste geval mist een klant één herinnering; de trap
-- erna komt gewoon. Dat is de goede kant om op te falen.

drop function if exists public.factuur_herinnering_verstuurd(uuid, smallint);

create or replace function public.factuur_herinnering_trap(factuur uuid, trap smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.facturen
    set herinnering_trap = greatest(trap, 0)
    where id = factuur and status = 'verstuurd';
end
$$;

revoke execute on function public.factuur_herinnering_trap(uuid, smallint)
  from public, anon, authenticated;
