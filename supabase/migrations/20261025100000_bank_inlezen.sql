-- Bankbestanden inlezen: overmakingen vanzelf bij de goede factuur.
--
-- Afspraak met Timmie (oktober 2026): eerst een bestand dat je bij de bank
-- downloadt (CAMT.053, MT940 of de CSV van ASN), later misschien een echte
-- koppeling. Het lezen van het bestand gebeurt in de browser
-- (src/lib/bankbestand.ts); hier komt alleen wat eruit kwam: de
-- bijschrijvingen. Afschrijvingen bewaren we niet, die gaan de facturen niet
-- aan en het is de privé-administratie van het bedrijf.
--
-- Wat er met een bijschrijving gebeurt:
--
--   1. Komt hij van Mollie, dan is het een uitbetaling. Die betalingen staan
--      al bij de facturen (de Mollie-melding), dus: genegeerd.
--   2. Staat er een factuurnummer in de omschrijving en staat die factuur
--      nog open, dan wordt hij daar geboekt. Meer nummers: in volgorde, en
--      wat over is op de laatste (dan wordt het vanzelf tegoed).
--   3. Komt hij van een rekeningnummer dat al eens bij een klant hoorde, en
--      past het bedrag precies op een openstaande factuur van die klant (of
--      op alle samen), dan wordt hij daar geboekt.
--   4. Al het andere komt op een lijstje "te controleren", met een voorstel
--      als de app er een heeft. Ook een factuurnummer van een factuur die al
--      betaald of gecrediteerd is: dat kan een dubbele betaling zijn, maar
--      ook een afvinkfout. Daar beslist een mens over.
--
-- Een bijschrijving boeken gaat via factuur_betaald, dus alles wat daar geldt
-- (deels betaald, te veel wordt tegoed) geldt hier ook. Elke boeking wordt
-- per factuur bewaard, zodat hij precies terug te draaien is.

-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------
create table public.bank_transacties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Herkenning van dezelfde regel bij een tweede keer inlezen (een bestand
  -- dat overlapt met het vorige). Zie bank_inlezen.
  sleutel text not null,
  datum date not null,
  bedrag numeric(12, 2) not null check (bedrag > 0),
  tegen_iban text not null default '',
  tegen_naam text not null default '',
  omschrijving text not null default '',
  kenmerk text not null default '',
  bron text not null check (bron in ('camt053', 'mt940', 'csv')),
  bestand text not null default '',
  status text not null default 'open' check (status in ('open', 'gekoppeld', 'genegeerd')),
  -- Hoe hij gekoppeld of genegeerd is: door de app of door een mens.
  door_app boolean not null default false,
  -- Waarom hij (nog) niet vanzelf gekoppeld is, in gewone taal.
  reden text not null default '',
  -- Facturen die de app voorstelt, als hij het niet zeker wist.
  voorstel uuid[] not null default '{}',
  ingelezen_door uuid default auth.uid(),
  created_at timestamptz not null default now(),
  afgehandeld_op timestamptz,
  unique (id, company_id),
  unique (company_id, sleutel)
);
create index bank_transacties_status on public.bank_transacties (company_id, status, datum desc);

-- Welk deel van een bijschrijving op welke factuur is geboekt.
create table public.bank_koppelingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transactie_id uuid not null,
  factuur_id uuid not null,
  bedrag numeric(12, 2) not null check (bedrag > 0),
  created_at timestamptz not null default now(),
  foreign key (transactie_id, company_id) references public.bank_transacties (id, company_id) on delete cascade,
  foreign key (factuur_id, company_id) references public.facturen (id, company_id) on delete cascade
);
create index bank_koppelingen_transactie on public.bank_koppelingen (transactie_id);
create index bank_koppelingen_factuur on public.bank_koppelingen (factuur_id);

-- Van welke rekening een klant betaalt. Geleerd bij elke koppeling. Eén
-- rekening kan bij meer klanten horen (een beheerder die voor drie VvE's
-- betaalt).
create table public.klant_ibans (
  company_id uuid not null references public.companies(id) on delete cascade,
  iban text not null check (iban <> ''),
  klant_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, iban, klant_id),
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade
);

create trigger bank_transacties_set_company_id before insert on public.bank_transacties
  for each row execute function public.set_company_id();
create trigger bank_koppelingen_set_company_id before insert on public.bank_koppelingen
  for each row execute function public.set_company_id();
create trigger klant_ibans_set_company_id before insert on public.klant_ibans
  for each row execute function public.set_company_id();

alter table public.bank_transacties enable row level security;
alter table public.bank_koppelingen enable row level security;
alter table public.klant_ibans enable row level security;

-- Lezen met het recht facturen. Schrijven alleen via de functies hieronder.
create policy "Banktransacties lezen" on public.bank_transacties for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));
create policy "Bankkoppelingen lezen" on public.bank_koppelingen for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));
create policy "Rekeningen van klanten lezen" on public.klant_ibans for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));

-- ---------------------------------------------------------------------
-- 2. Hulpjes
-- ---------------------------------------------------------------------
-- "NL12 ABCD 0123 4567 89" en "nl12abcd0123456789" zijn dezelfde rekening.
create or replace function public.bank_iban(t text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- De factuurnummers in een omschrijving, als "2026-0042". Ook "2026 0042",
-- "2026/0042" en "20260042" -- maar dat laatste niet als het ook een datum
-- kan zijn (20261003), want dan zou een betaaldatum in de omschrijving een
-- willekeurige factuur aanwijzen.
create or replace function public.bank_factuurnummers(t text)
returns text[]
language plpgsql
immutable
as $$
declare
  m text[];
  uit text[] := '{}';
  nummer text;
begin
  for m in
    select regexp_matches(coalesce(t, ''), '(?:^|[^0-9])(20[0-9]{2})([-/. ]?)([0-9]{4})(?![0-9])', 'g')
  loop
    if m[2] = '' then
      -- Aan elkaar: alleen als het geen datum (jjjjmmdd) kan zijn.
      begin
        perform to_date(m[1] || m[3], 'YYYYMMDD');
        if substr(m[3], 1, 2)::int between 1 and 12 and substr(m[3], 3, 2)::int between 1 and 31 then
          continue;
        end if;
      exception when others then
        null;
      end;
    end if;
    nummer := m[1] || '-' || m[3];
    if not nummer = any(uit) then
      uit := uit || nummer;
    end if;
  end loop;
  return uit;
end
$$;

-- Wat er op een factuur nog openstaat. Nooit onder nul.
create or replace function public.factuur_open(f public.facturen)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(round((public.factuur_totalen(f.id) ->> 'incl')::numeric - coalesce(f.betaald_bedrag, 0), 2), 0)
$$;
revoke execute on function public.factuur_open(public.facturen) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Boeken en terugdraaien
-- ---------------------------------------------------------------------
-- Verdeelt een bijschrijving over de facturen, in de gegeven volgorde: elke
-- factuur krijgt wat er openstaat, de laatste krijgt de rest. Zo wordt te
-- veel betaald vanzelf tegoed bij de klant van die laatste factuur.
--
-- Intern: de aanroepers hebben het recht al gecontroleerd en het bedrijf
-- vastgesteld. factuur_betaald controleert het zelf nog een keer.
create or replace function public.bank_boeken(t public.bank_transacties, ids uuid[], door_app_ boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rest numeric := t.bedrag;
  deel numeric;
  f public.facturen;
  i integer := 0;
  n integer := coalesce(cardinality(ids), 0);
begin
  if n = 0 then
    raise exception 'Kies een factuur.';
  end if;
  for f in
    select fa.* from unnest(ids) with ordinality as u(id, volgorde)
    join public.facturen fa on fa.id = u.id
    where fa.company_id = t.company_id and fa.deleted_at is null
    order by u.volgorde
  loop
    i := i + 1;
    if f.soort <> 'factuur' or f.nummer is null or f.status = 'concept' then
      raise exception 'Factuur % kan geen betaling krijgen: hij is nog niet verstuurd of het is een creditnota.',
        coalesce(f.nummer, 'zonder nummer');
    end if;
    deel := case when i = n then rest else least(rest, public.factuur_open(f)) end;
    if deel > 0 then
      perform public.factuur_betaald(f.id, deel, t.datum);
      insert into public.bank_koppelingen (company_id, transactie_id, factuur_id, bedrag)
      values (t.company_id, t.id, f.id, deel);
      rest := rest - deel;
    end if;
  end loop;
  if i <> n then
    raise exception 'Die factuur bestaat niet.';
  end if;

  update public.bank_transacties
    set status = 'gekoppeld', door_app = door_app_, reden = '', voorstel = '{}', afgehandeld_op = now()
    where id = t.id;

  -- Onthouden van welke rekening deze klant(en) betalen.
  if public.bank_iban(t.tegen_iban) <> '' then
    insert into public.klant_ibans (company_id, iban, klant_id)
    select distinct t.company_id, public.bank_iban(t.tegen_iban), fa.klant_id
    from public.facturen fa
    where fa.id = any(ids) and fa.company_id = t.company_id
    on conflict do nothing;
  end if;
end
$$;
revoke execute on function public.bank_boeken(public.bank_transacties, uuid[], boolean) from public, anon, authenticated;

-- Wat de app zelf doet met één nieuwe bijschrijving. Zie het verhaal bovenaan.
create or replace function public.bank_automatisch(transactie uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.bank_transacties;
  nummers text[];
  gevonden public.facturen[];
  f public.facturen;
  dicht text[] := '{}';
  klanten uuid[];
  open_ids uuid[];
  open_bedragen numeric[];
  passend uuid[];
begin
  select * into t from public.bank_transacties where id = transactie;

  -- 1. Een uitbetaling van Mollie. Op de volledige naam, niet op "mollie"
  --    alleen: een klant die Mollie de Vries heet, betaalt gewoon een factuur.
  if t.tegen_naam ~* 'mollie\s*payments' then
    update public.bank_transacties
      set status = 'genegeerd', door_app = true, afgehandeld_op = now(),
          reden = 'Uitbetaling van Mollie: die betalingen staan al bij de facturen.'
      where id = t.id;
    return 'genegeerd';
  end if;

  -- 1b. Dezelfde overmaking uit een ander soort bestand (eerst MT940, later
  --     CAMT over dezelfde dagen). De herkenning bij het inlezen werkt per
  --     soort, dus die ziet dit niet; vanzelf boeken zou dubbel boeken.
  if exists (
    select 1 from public.bank_transacties x
    where x.company_id = t.company_id and x.id <> t.id and x.bron <> t.bron
      and x.datum = t.datum and x.bedrag = t.bedrag and x.tegen_iban = t.tegen_iban
  ) then
    update public.bank_transacties
      set reden = 'Lijkt dezelfde overmaking als een bijschrijving uit een eerder ingelezen bestand van een ander soort. '
                  || 'Boek hem alleen als hij echt twee keer binnenkwam.'
      where id = t.id;
    return 'open';
  end if;

  -- 2. Factuurnummers in de omschrijving of het gestructureerde
  --    betalingskenmerk. Niet in de eigen verwijzing van de betaler
  --    (end-to-end-id): die laat de browser al weg.
  nummers := public.bank_factuurnummers(t.omschrijving || ' ' || t.kenmerk);
  if cardinality(nummers) > 0 then
    select coalesce(array_agg(fa order by array_position(nummers, fa.nummer)), '{}') into gevonden
    from public.facturen fa
    where fa.company_id = t.company_id and fa.nummer = any(nummers)
      and fa.soort = 'factuur' and fa.deleted_at is null and fa.status <> 'concept';
  end if;
  if cardinality(gevonden) > 0 then
    foreach f in array gevonden loop
      if f.status <> 'verstuurd' then
        dicht := dicht || (f.nummer || case when f.status = 'gecrediteerd' then ' is gecrediteerd' else ' is al betaald' end);
      end if;
    end loop;
    if cardinality(dicht) = 0 then
      perform public.bank_boeken(t, (select array_agg(g.id) from unnest(gevonden) g), true);
      return 'gekoppeld';
    end if;
    update public.bank_transacties
      set reden = 'Factuur ' || array_to_string(dicht, ', ')
                  || '. Boek je hem toch, dan wordt het tegoed voor de klant.',
          voorstel = (select array_agg(g.id) from unnest(gevonden) g)
      where id = t.id;
    return 'open';
  end if;

  -- 3. Een rekening die we kennen, met een bedrag dat precies past.
  if public.bank_iban(t.tegen_iban) <> '' then
    select coalesce(array_agg(ki.klant_id), '{}') into klanten
    from public.klant_ibans ki
    where ki.company_id = t.company_id and ki.iban = public.bank_iban(t.tegen_iban);
  end if;
  if cardinality(klanten) > 0 then
    select coalesce(array_agg(fa.id order by fa.vervaldatum, fa.nummer), '{}'),
           coalesce(array_agg(public.factuur_open(fa) order by fa.vervaldatum, fa.nummer), '{}')
      into open_ids, open_bedragen
    from public.facturen fa
    where fa.company_id = t.company_id and fa.klant_id = any(klanten)
      and fa.soort = 'factuur' and fa.status = 'verstuurd' and fa.deleted_at is null
      and public.factuur_open(fa) > 0;

    -- Precies één factuur met dit bedrag.
    select coalesce(array_agg(x.id), '{}') into passend
    from unnest(open_ids, open_bedragen) as x(id, open)
    where x.open = t.bedrag;
    if cardinality(passend) = 1 then
      perform public.bank_boeken(t, passend, true);
      return 'gekoppeld';
    end if;
    -- Of alles wat openstaat in één keer.
    if cardinality(passend) = 0 and cardinality(open_ids) > 1
       and (select sum(o) from unnest(open_bedragen) o) = t.bedrag then
      perform public.bank_boeken(t, open_ids, true);
      return 'gekoppeld';
    end if;

    update public.bank_transacties
      set reden = case
                    when cardinality(open_ids) = 0 then 'Van een bekende klant, maar er staat geen factuur open.'
                    when cardinality(passend) > 1 then 'Van een bekende klant, met meer facturen van dit bedrag.'
                    else 'Van een bekende klant, maar het bedrag past niet op een openstaande factuur.'
                  end,
          voorstel = case when cardinality(passend) > 1 then passend else open_ids end
      where id = t.id;
    return 'open';
  end if;

  update public.bank_transacties
    set reden = 'Geen factuurnummer in de omschrijving, en de rekening is nog niet bekend.'
    where id = t.id;
  return 'open';
end
$$;
revoke execute on function public.bank_automatisch(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Inlezen
-- ---------------------------------------------------------------------
-- `regels` is wat src/lib/bankbestand.ts uit het bestand haalde:
--   [{ datum, bedrag, tegen_iban, tegen_naam, omschrijving, kenmerk, ref, volg }]
-- met `ref` de eigen referentie van de bank als die er is, en `volg` de
-- hoeveelste keer precies deze regel in het hele bestand staat. De browser
-- stuurt een groot bestand in stukken; zonder `volg` zou een tweelingregel
-- die in het volgende stuk valt voor "al bekend" worden aangezien.
--
-- Dezelfde regel twee keer inlezen (overlappende bestanden) maakt hem niet
-- twee keer aan. Twee echt gelijke regels in één bestand -- de klant maakte
-- hetzelfde bedrag met dezelfde omschrijving twee keer over, precies het
-- geval waar tegoed om draait -- blijven er twee: ze krijgen een volgnummer.
create or replace function public.bank_inlezen(bron text, bestand text, regels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  aantal_regels integer := jsonb_array_length(coalesce(regels, '[]'::jsonb));
  nieuw uuid[];
  id_ uuid;
  uitkomst text;
  gekoppeld integer := 0;
  genegeerd integer := 0;
  te_controleren integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen bankbestanden inlezen.';
  end if;
  if bron not in ('camt053', 'mt940', 'csv') then
    raise exception 'Onbekend soort bankbestand.';
  end if;
  if aantal_regels > 1000 then
    raise exception 'Maximaal 1000 bijschrijvingen per keer.';
  end if;

  -- Eén inlezing tegelijk per bedrijf: twee tabbladen die hetzelfde bestand
  -- inlezen zouden anders allebei boeken.
  perform pg_advisory_xact_lock(hashtext('bank_inlezen:' || bedrijf::text));

  with r as (
    select
      g.datum, round(g.bedrag, 2) as bedrag,
      left(public.bank_iban(g.tegen_iban), 34) as tegen_iban,
      left(btrim(coalesce(g.tegen_naam, '')), 140) as tegen_naam,
      left(btrim(coalesce(g.omschrijving, '')), 500) as omschrijving,
      left(btrim(coalesce(g.kenmerk, '')), 140) as kenmerk,
      md5(concat_ws('|', g.datum, round(g.bedrag, 2), public.bank_iban(g.tegen_iban),
                    btrim(coalesce(g.omschrijving, '')), btrim(coalesce(g.kenmerk, '')),
                    btrim(coalesce(g.ref, '')))) as basis,
      g.volg,
      g.volgorde
    from rows from (
      jsonb_to_recordset(coalesce(regels, '[]'::jsonb))
        as (datum date, bedrag numeric, tegen_iban text, tegen_naam text, omschrijving text, kenmerk text, ref text, volg integer)
    ) with ordinality as g(datum, bedrag, tegen_iban, tegen_naam, omschrijving, kenmerk, ref, volg, volgorde)
    where g.datum is not null and g.bedrag > 0
  ),
  genummerd as (
    select r.*, r.basis || '#' || coalesce(r.volg, row_number() over (partition by r.basis order by r.volgorde)) as sleutel
    from r
  ),
  ingevoegd as (
    insert into public.bank_transacties
      (company_id, sleutel, datum, bedrag, tegen_iban, tegen_naam, omschrijving, kenmerk, bron, bestand)
    select bedrijf, n.sleutel, n.datum, n.bedrag, n.tegen_iban, n.tegen_naam, n.omschrijving, n.kenmerk,
           bron, left(coalesce(bestand, ''), 200)
    from genummerd n
    order by n.volgorde
    on conflict (company_id, sleutel) do nothing
    returning id, datum
  )
  select coalesce(array_agg(id order by datum), '{}') into nieuw from ingevoegd;

  foreach id_ in array nieuw loop
    uitkomst := public.bank_automatisch(id_);
    if uitkomst = 'gekoppeld' then
      gekoppeld := gekoppeld + 1;
    elsif uitkomst = 'genegeerd' then
      genegeerd := genegeerd + 1;
    else
      te_controleren := te_controleren + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'nieuw', cardinality(nieuw),
    'al_bekend', (select count(*) from jsonb_to_recordset(coalesce(regels, '[]'::jsonb)) as g(datum date, bedrag numeric)
                  where g.datum is not null and g.bedrag > 0) - cardinality(nieuw),
    'gekoppeld', gekoppeld,
    'genegeerd', genegeerd,
    'te_controleren', te_controleren
  );
end
$$;
revoke execute on function public.bank_inlezen(text, text, jsonb) from public, anon;
grant execute on function public.bank_inlezen(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Wat een mens doet
-- ---------------------------------------------------------------------
-- Met de hand koppelen aan één of meer facturen.
create or replace function public.bank_koppelen(transactie uuid, facturen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  t public.bank_transacties;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen betalingen boeken.';
  end if;
  select * into t from public.bank_transacties
    where id = transactie and company_id = bedrijf
    for update;
  if not found then
    raise exception 'Die bijschrijving bestaat niet.';
  end if;
  if t.status = 'gekoppeld' then
    raise exception 'Deze bijschrijving is al geboekt.';
  end if;
  perform public.bank_boeken(t, facturen, false);
end
$$;
revoke execute on function public.bank_koppelen(uuid, uuid[]) from public, anon;
grant execute on function public.bank_koppelen(uuid, uuid[]) to authenticated;

-- Geen betaling voor een factuur (een contante storting, iets anders).
create or replace function public.bank_negeren(transactie uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen betalingen boeken.';
  end if;
  update public.bank_transacties
    set status = 'genegeerd', door_app = false, afgehandeld_op = now(), reden = ''
    where id = transactie and company_id = bedrijf and status = 'open';
  if not found then
    raise exception 'Deze bijschrijving staat niet meer open.';
  end if;
end
$$;
revoke execute on function public.bank_negeren(uuid) from public, anon;
grant execute on function public.bank_negeren(uuid) to authenticated;

-- Terug naar "te controleren": een koppeling ongedaan maken (de boekingen op
-- de facturen gaan er weer af) of iets wat genegeerd was toch bekijken.
create or replace function public.bank_terugzetten(transactie uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  t public.bank_transacties;
  k public.bank_koppelingen;
  klanten uuid[];
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen betalingen boeken.';
  end if;
  select * into t from public.bank_transacties
    where id = transactie and company_id = bedrijf
    for update;
  if not found then
    raise exception 'Die bijschrijving bestaat niet.';
  end if;
  if t.status = 'open' then
    return;
  end if;

  select coalesce(array_agg(distinct fa.klant_id), '{}') into klanten
  from public.bank_koppelingen bk
  join public.facturen fa on fa.id = bk.factuur_id
  where bk.transactie_id = t.id;

  for k in select * from public.bank_koppelingen where transactie_id = t.id loop
    perform public.factuur_betaald(k.factuur_id, -k.bedrag);
  end loop;
  delete from public.bank_koppelingen where transactie_id = t.id;

  -- Ook vergeten dat deze rekening bij die klant hoort, tenzij een andere
  -- boeking van dezelfde rekening het nog bevestigt. Anders boekt de app een
  -- volgende overmaking van die rekening stil op de verkeerde klant.
  delete from public.klant_ibans ki
  where ki.company_id = bedrijf
    and ki.iban = public.bank_iban(t.tegen_iban)
    and ki.klant_id = any(klanten)
    and not exists (
      select 1
      from public.bank_transacties x
      join public.bank_koppelingen bk on bk.transactie_id = x.id
      join public.facturen fa on fa.id = bk.factuur_id
      where x.company_id = bedrijf and x.id <> t.id
        and public.bank_iban(x.tegen_iban) = ki.iban
        and fa.klant_id = ki.klant_id
    );

  update public.bank_transacties
    set status = 'open', door_app = false, afgehandeld_op = null,
        reden = case when t.status = 'gekoppeld' then 'Koppeling ongedaan gemaakt.' else '' end
    where id = t.id;
end
$$;
revoke execute on function public.bank_terugzetten(uuid) from public, anon;
grant execute on function public.bank_terugzetten(uuid) to authenticated;
