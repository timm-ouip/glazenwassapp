-- Een losse factuur met de hand.
--
-- Tot nu toe ontstond een factuurregel alleen uit werk: een afgemelde wasdag
-- of een afgevinkte klus. Maar niet alles wat je in rekening brengt loopt via
-- de planning -- een offerte die doorgaat, een eenmalige klus voor iemand die
-- verder geen vaste klant is, iets wat je achteraf alsnog moet factureren.
--
-- Daarvoor is dit: je kiest een klant, typt een paar regels, en er staat een
-- concept klaar dat verder precies dezelfde weg gaat als alle andere. Zelfde
-- nummering, zelfde PDF met je briefpapier, zelfde betaallink, zelfde
-- herinneringen. Er is niets aparts aan behalve waar hij vandaan komt.

-- ---------------------------------------------------------------------
-- 1. Een derde soort regel
-- ---------------------------------------------------------------------
-- 'los' naast 'wasbeurt' en 'klus'. Dat het een eigen soort is, doet ertoe:
-- het heropenen van een dag ruimt de regels van die dag op, en dat zoekt
-- alleen naar `soort = 'wasbeurt'`. Een regel die je zelf hebt ingetypt hoort
-- daar niet tussenuit te vallen.

alter table public.factuurregels
  drop constraint if exists factuurregels_soort_check;
alter table public.factuurregels
  add constraint factuurregels_soort_check
  check (soort in ('wasbeurt', 'klus', 'los'));

-- ---------------------------------------------------------------------
-- 2. De factuur zelf
-- ---------------------------------------------------------------------

create or replace function public.factuur_los_maken(klant uuid, regels jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  k public.klanten;
  nieuw uuid;
  r jsonb;
  bedrag numeric;
  inclusief boolean;
  procent numeric;
  aantal integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;

  select * into k from public.klanten
    where id = klant and company_id = bedrijf and deleted_at is null;
  if not found then
    raise exception 'Die klant bestaat niet.';
  end if;

  if jsonb_typeof(regels) <> 'array' or jsonb_array_length(regels) = 0 then
    raise exception 'Een factuur zonder regels kan niet.';
  end if;
  if jsonb_array_length(regels) > 200 then
    raise exception 'Maximaal 200 regels per factuur.';
  end if;

  -- Het btw-tarief en of de prijzen inclusief zijn: precies zoals bij een
  -- gewone regel, zodat een losse factuur er niet anders uitrolt.
  inclusief := public.factuur_btw_inclusief(k);
  procent := public.factuur_btw_procent(k);

  insert into public.facturen (company_id, klant_id, soort, status)
  values (bedrijf, klant, 'factuur', 'concept')
  returning id into nieuw;

  for r in select * from jsonb_array_elements(regels) loop
    bedrag := round((r ->> 'bedrag')::numeric, 2);
    if bedrag is null then
      raise exception 'Een regel zonder bedrag kan niet.';
    end if;
    if btrim(coalesce(r ->> 'omschrijving', '')) = '' then
      raise exception 'Een regel zonder omschrijving kan niet.';
    end if;

    insert into public.factuurregels (
      company_id, klant_id, soort, datum, omschrijving, notitie,
      bedrag, btw_inclusief, btw_procent, bedrag_excl, factuur_id
    ) values (
      bedrijf,
      klant,
      'los',
      coalesce((r ->> 'datum')::date, (now() at time zone 'Europe/Amsterdam')::date),
      left(btrim(r ->> 'omschrijving'), 200),
      left(btrim(coalesce(r ->> 'notitie', '')), 200),
      bedrag,
      inclusief,
      procent,
      public.factuur_excl(bedrag, inclusief, procent),
      nieuw
    );
    aantal := aantal + 1;
  end loop;

  if aantal = 0 then
    raise exception 'Een factuur zonder regels kan niet.';
  end if;

  return nieuw;
end
$$;

revoke execute on function public.factuur_los_maken(uuid, jsonb) from public, anon;
grant execute on function public.factuur_los_maken(uuid, jsonb) to authenticated;
