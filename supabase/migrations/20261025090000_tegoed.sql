-- Tegoed bij de facturen.
--
-- Afspraak met Timmie (oktober 2026): betaalt een klant te veel, dan is dat
-- geen geld dat in het niets verdwijnt maar tegoed in zijn dossier. Bij de
-- volgende factuur gaat het daar vanaf -- niet als een min-regel tussen het
-- werk (dan klopt de btw op die factuur niet meer, want het is een betaling
-- en geen korting), maar onder het totaal:
--
--   Totaal               € 45,00
--   Reeds betaald        - € 10,00
--   Nog te betalen       € 35,00
--
-- Waar tegoed vandaan komt:
--
--   * te veel betaald: op een factuur is meer binnengekomen dan het totaal
--     (twee keer via de betaallink, of overgemaakt én via de link);
--   * gecrediteerd: wat er al op een factuur betaald was voordat hij werd
--     teruggeboekt. Dat omvat ook tegoed dat erop verrekend was: dat komt
--     dan gewoon terug.
--
-- Waar het heen gaat:
--
--   * verrekend: bij het vastzetten van de volgende factuur (het moment dat
--     hij zijn nummer krijgt). Niet bij het klaarzetten van het concept, want
--     een concept kan nog veranderen of weggegooid worden;
--   * vereffend: met de knop in het dossier, bijvoorbeeld omdat het geld is
--     teruggestort. Dat is de enige plek waar een mens het saldo verzet.
--
-- Het saldo wordt niet bijgehouden maar elke keer uitgerekend uit de
-- facturen zelf. Zo kan het nooit uit de pas lopen met wat er op de facturen
-- staat: een betaling die later binnenkomt (Mollie, met de hand, straks het
-- bankbestand) of een terugboeking bij Mollie verandert het tegoed vanzelf.
--
-- Het verrekende tegoed telt als betaald op de nieuwe factuur
-- (betaald_bedrag). Daardoor rekent alles wat al "totaal min betaald" doet --
-- de herinneringen, het openstaande bedrag, de Mollie-melding -- zonder
-- aanpassing met het restbedrag.

-- ---------------------------------------------------------------------
-- 1. Hoeveel tegoed er op een factuur verrekend is
-- ---------------------------------------------------------------------
alter table public.facturen
  add column tegoed_verrekend numeric(10, 2) not null default 0
    check (tegoed_verrekend >= 0);

comment on column public.facturen.tegoed_verrekend is
  'Tegoed van de klant dat bij het vastzetten op deze factuur is verrekend. Zit ook in betaald_bedrag.';

-- Alleen de database zelf zet dit veld (factuur_vastzetten). Een concept mag
-- een mens via de policy "Concept bijwerken" rechtstreeks bijwerken; zonder
-- dit slot kon iemand daar tegoed op zetten dat nooit bestaan heeft.
create or replace function public.facturen_tegoed_op_slot()
returns trigger
language plpgsql
as $$
begin
  if new.tegoed_verrekend is distinct from old.tegoed_verrekend
     and current_user in ('authenticated', 'anon') then
    raise exception 'Het verrekende tegoed zet de app zelf.';
  end if;
  return new;
end
$$;

create trigger facturen_tegoed_op_slot before update on public.facturen
  for each row execute function public.facturen_tegoed_op_slot();

-- ---------------------------------------------------------------------
-- 2. Wat een mens met het tegoed doet
-- ---------------------------------------------------------------------
-- Alleen de vereffeningen staan hier: al het andere volgt uit de facturen.
create table public.tegoed_boekingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  klant_id uuid not null,
  soort text not null default 'vereffend' check (soort in ('vereffend')),
  -- Negatief haalt tegoed weg, positief zet het erbij (een klant die nog
  -- iets moest, en dat is geregeld).
  bedrag numeric(10, 2) not null check (bedrag <> 0),
  op date not null default (now() at time zone 'Europe/Amsterdam')::date,
  opmerking text not null default '',
  door uuid default auth.uid(),
  door_naam text not null default '',
  created_at timestamptz not null default now(),
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade
);
create index tegoed_boekingen_klant on public.tegoed_boekingen (company_id, klant_id);

create trigger tegoed_boekingen_set_company_id before insert on public.tegoed_boekingen
  for each row execute function public.set_company_id();

alter table public.tegoed_boekingen enable row level security;

-- Lezen met het recht facturen; schrijven alleen via tegoed_vereffenen.
create policy "Tegoed lezen" on public.tegoed_boekingen for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));

-- ---------------------------------------------------------------------
-- 3. Wat één factuur aan tegoed oplevert
-- ---------------------------------------------------------------------
-- Een concept (ook een vastgezet concept dat nog niet weg is) levert niets
-- op: dat heeft de klant nog niet gezien. Een creditnota ook niet: die boekt
-- een factuur tegen die zelf al op 'gecrediteerd' staat, en daar zit het geld.
create or replace function public.factuur_tegoed_uit(f public.facturen, totaal numeric)
returns numeric
language sql
immutable
as $$
  select case
    when f.soort <> 'factuur' or f.nummer is null or f.deleted_at is not null then 0
    when f.status = 'gecrediteerd' then coalesce(f.betaald_bedrag, 0)
    when f.status in ('verstuurd', 'betaald')
      then greatest(round(coalesce(f.betaald_bedrag, 0) - coalesce(totaal, 0), 2), 0)
    else 0
  end
$$;

-- Het saldo van één klant. Positief = tegoed, negatief = er is meer
-- verrekend of vereffend dan er nu nog binnen is (een terugboeking bij
-- Mollie na het verrekenen). Dat laatste wordt nooit verrekend, alleen
-- getoond.
create or replace function public.klant_tegoed_saldo(bedrijf uuid, klant uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(
    coalesce((
      select sum(public.factuur_tegoed_uit(f, (public.factuur_totalen(f.id) ->> 'incl')::numeric)
                 - f.tegoed_verrekend)
      from public.facturen f
      where f.company_id = bedrijf and f.klant_id = klant and f.deleted_at is null
    ), 0)
    + coalesce((
      select sum(b.bedrag) from public.tegoed_boekingen b
      where b.company_id = bedrijf and b.klant_id = klant
    ), 0),
  2)
$$;
revoke execute on function public.klant_tegoed_saldo(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Vastzetten verrekent het tegoed
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit 20261012130000_losse_factuur_uitgebreid, met het
-- verrekenen erbij. Het gebeurt hier en nergens anders, omdat dit precies
-- één keer per factuur gebeurt: een tweede poging (de mail mislukte) komt
-- bij "opnieuw" uit en verrekent niets meer.
create or replace function public.factuur_vastzetten(factuur uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  k public.klanten;
  laatste date;
  aantal integer;
  volg integer;
  jr smallint;
  termijn integer;
  totaal numeric;
  saldo numeric;
  verrekend numeric := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen versturen.';
  end if;

  select * into f from public.facturen
    where id = factuur and company_id = bedrijf
    for update;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is not null then
    return jsonb_build_object('id', f.id, 'nummer', f.nummer, 'factuurdatum', f.factuurdatum,
                              'vervaldatum', f.vervaldatum, 'opnieuw', true,
                              'tegoed', f.tegoed_verrekend);
  end if;

  select count(*), max(fr.datum) into aantal, laatste
    from public.factuurregels fr
    where fr.factuur_id = factuur and fr.deleted_at is null;
  if coalesce(aantal, 0) = 0 then
    raise exception 'Een factuur zonder regels kun je niet versturen.';
  end if;

  -- De klant op slot: twee facturen van dezelfde klant die tegelijk worden
  -- vastgezet (een bulk van vier tegelijk) zouden anders allebei hetzelfde
  -- tegoed zien en het twee keer verrekenen.
  select * into k from public.klanten where id = f.klant_id for update;
  termijn := coalesce(f.termijn_dagen, public.factuur_termijn(k));
  jr := extract(year from laatste)::smallint;
  volg := public.factuur_nummer_trekken(bedrijf, jr);

  if f.soort = 'factuur' then
    totaal := (public.factuur_totalen(factuur) ->> 'incl')::numeric;
    saldo := public.klant_tegoed_saldo(bedrijf, f.klant_id);
    -- Wat er op een concept al stond (hoort niet, maar een mens kan het
    -- hebben gezet) eerst eraf, dan opnieuw rekenen.
    saldo := saldo + f.tegoed_verrekend;
    verrekend := round(greatest(least(saldo, totaal - (coalesce(f.betaald_bedrag, 0) - f.tegoed_verrekend)), 0), 2);
  end if;

  update public.facturen
    set nummer = jr::text || '-' || lpad(volg::text, 4, '0'),
        jaar = jr,
        volgnummer = volg,
        factuurdatum = laatste,
        vervaldatum = laatste + termijn,
        betaald_bedrag = greatest(coalesce(betaald_bedrag, 0) - tegoed_verrekend, 0) + verrekend,
        tegoed_verrekend = verrekend,
        klantgegevens = jsonb_build_object(
          'naam', k.naam,
          'klanttype', k.klanttype,
          'bedrijfsnaam', k.bedrijfsnaam,
          'kvk', k.kvk,
          'btw_nummer', k.btw_nummer,
          'straat', coalesce(nullif(btrim(k.factuur_straat), ''), k.straat),
          'huisnummer', coalesce(nullif(btrim(k.factuur_huisnummer), ''), k.huisnummer),
          'postcode', coalesce(nullif(btrim(k.factuur_postcode), ''), k.postcode),
          'plaats', coalesce(nullif(btrim(k.factuur_plaats), ''), k.plaats),
          'email', public.factuur_mailadres(k),
          'termijn', termijn
        )
    where id = factuur;

  return jsonb_build_object('id', factuur,
                            'nummer', jr::text || '-' || lpad(volg::text, 4, '0'),
                            'factuurdatum', laatste,
                            'vervaldatum', laatste + termijn,
                            'opnieuw', false,
                            'tegoed', verrekend);
end
$$;

-- ---------------------------------------------------------------------
-- 5. Versturen: helemaal met tegoed betaald is meteen betaald
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit 20261012102000_verstuurd_herstel, met één geval
-- erbij: dekt het tegoed de hele factuur, dan valt er niets te innen en gaat
-- hij meteen op 'betaald'. Anders zou hij na de vervaldatum in "Te laat"
-- komen met nul euro open.
create or replace function public.factuur_verstuurd(factuur uuid, via text, naar text, pdf text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  f public.facturen;
  voldaan boolean;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen versturen.';
  end if;

  select * into f from public.facturen
    where id = factuur and company_id = bedrijf;
  voldaan := found and f.soort = 'factuur' and f.betaald_bedrag > 0
             and f.betaald_bedrag >= (public.factuur_totalen(factuur) ->> 'incl')::numeric;

  update public.facturen
    set status = case when f.soort = 'credit' or voldaan then 'betaald' else 'verstuurd' end,
        -- Een creditnota staat bij het versturen meteen verwerkt: hij netto
        -- tegen een factuur die al op 'gecrediteerd' staat.
        betaald_op = case when f.soort = 'credit' or voldaan then coalesce(betaald_op, vandaag) else betaald_op end,
        verstuurd_op = now(),
        verstuurd_via = via, verstuurd_naar = coalesce(naar, ''), pdf_pad = coalesce(pdf, pdf_pad)
    where id = factuur and company_id = bedrijf and nummer is not null and status = 'concept';
  if not found then
    raise exception 'Deze factuur staat niet klaar om verstuurd te worden.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 6. Een betaling boeken, ook als het meer is dan er openstaat
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit 20261012092000_facturen_maken, met twee dingen
-- anders:
--   * een factuur die al betaald was houdt zijn betaaldatum als er nog iets
--     bij komt (een tweede overboeking wordt tegoed, niet een nieuwe datum);
--   * het antwoord zegt hoeveel er als tegoed bij de klant terechtkwam;
--   * zonder bedrag boekt hij precies wat er nu openstaat. Dat is wat de knop
--     "Betaald" doet. Stuurt het scherm zelf een bedrag mee, dan is dat het
--     bedrag van toen het scherm werd opgehaald: is er intussen via de
--     betaallink betaald, of klikt iemand twee keer, dan zou dat ongemerkt
--     tegoed worden en van de volgende factuur afgaan.
create or replace function public.factuur_betaald(factuur uuid, bedrag numeric default null, op date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  totaal numeric;
  nieuw numeric;
  tegoed_voor numeric;
  tegoed_na numeric;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen betalingen afvinken.';
  end if;
  select * into f from public.facturen where id = factuur and company_id = bedrijf for update;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is null then
    raise exception 'Een concept kan nog niet betaald zijn.';
  end if;
  if f.soort <> 'factuur' then
    raise exception 'Op een creditnota boek je geen betaling.';
  end if;

  totaal := (public.factuur_totalen(factuur) ->> 'incl')::numeric;
  tegoed_voor := public.factuur_tegoed_uit(f, totaal);
  -- Afboeken kan, maar nooit onder wat er met tegoed op betaald is: dat geld
  -- heeft de klant niet overgemaakt, dat kwam uit zijn dossier.
  nieuw := greatest(
    round(coalesce(f.betaald_bedrag, 0)
          + coalesce(bedrag, greatest(totaal - coalesce(f.betaald_bedrag, 0), 0)), 2),
    f.tegoed_verrekend, 0);

  update public.facturen
    set betaald_bedrag = nieuw,
        betaald_op = case
                       when nieuw >= totaal
                       then coalesce(case when f.status = 'betaald' then f.betaald_op end,
                                     op, (now() at time zone 'Europe/Amsterdam')::date)
                       else null
                     end,
        status = case
                   when f.status = 'gecrediteerd' then 'gecrediteerd'
                   when nieuw >= totaal then 'betaald'
                   else 'verstuurd'
                 end
    where id = factuur
    returning * into f;

  tegoed_na := public.factuur_tegoed_uit(f, totaal);
  return jsonb_build_object('betaald', nieuw, 'totaal', totaal,
                            'open', greatest(round(totaal - nieuw, 2), 0),
                            'tegoed', round(tegoed_na - tegoed_voor, 2));
end
$$;
revoke execute on function public.factuur_betaald(uuid, numeric, date) from public, anon;
grant execute on function public.factuur_betaald(uuid, numeric, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. De lijst weet van het tegoed
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit 20261016103000, met 'tegoed_verrekend' (wat er op
-- deze factuur van het tegoed af ging) en 'tegoed_uit' (wat deze factuur
-- aan tegoed opleverde) erbij.
create or replace function public.facturen_lijst(vanaf date default null, tot date default null, klant uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag de facturen niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(x.regel order by x.sorteer desc nulls first)
    from (
      select jsonb_build_object(
        'id', f.id,
        'nummer', f.nummer,
        'soort', f.soort,
        'status', f.status,
        'klant_id', f.klant_id,
        'klant', coalesce(nullif(btrim(f.klantgegevens->>'bedrijfsnaam'), ''),
                          nullif(btrim(f.klantgegevens->>'naam'), ''),
                          nullif(btrim(k.bedrijfsnaam), ''), k.naam),
        'klanttype', coalesce(nullif(btrim(f.klantgegevens->>'klanttype'), ''), k.klanttype),
        'mail', coalesce(nullif(btrim(f.klantgegevens->>'email'), ''), public.factuur_mailadres(k)),
        'factuurdatum', f.factuurdatum,
        'datum', coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date),
        'vervaldatum', f.vervaldatum,
        'te_laat', f.soort <> 'credit'
                   and f.nummer is not null and f.status = 'verstuurd'
                   and f.vervaldatum < vandaag
                   and (f.met_rust_tot is null or f.met_rust_tot < vandaag),
        'met_rust_tot', f.met_rust_tot,
        'herinnering_trap', f.herinnering_trap,
        'betaald_bedrag', f.betaald_bedrag,
        'tegoed_verrekend', f.tegoed_verrekend,
        'tegoed_uit', public.factuur_tegoed_uit(f, (t.totalen ->> 'incl')::numeric),
        'verstuurd_op', f.verstuurd_op,
        'verstuurd_via', f.verstuurd_via,
        'mollie_link', f.mollie_link,
        'totalen', t.totalen
      ) as regel,
      coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) as sorteer
      from public.facturen f
      join public.klanten k on k.id = f.klant_id
      -- offset 0: zonder dat vouwt Postgres dit uit en rekent hij de totalen
      -- per factuur twee keer (voor 'totalen' en voor 'tegoed_uit').
      cross join lateral (select public.factuur_totalen(f.id) as totalen offset 0) t
      where f.company_id = bedrijf and f.deleted_at is null
        and (klant is null or f.klant_id = klant)
        and (vanaf is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) >= vanaf)
        and (tot is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) <= tot)
    ) x
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.facturen_lijst(date, date, uuid) from public, anon;
grant execute on function public.facturen_lijst(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Het tegoed van één klant, voor het dossier
-- ---------------------------------------------------------------------
-- Het saldo en waar het vandaan komt, nieuwste eerst.
create or replace function public.klant_tegoed(klant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag de facturen niet zien.';
  end if;

  return jsonb_build_object(
    'saldo', public.klant_tegoed_saldo(bedrijf, klant),
    'regels', coalesce((
      select jsonb_agg(r.regel order by r.datum desc, r.volgorde desc)
      from (
        -- Wat een factuur opleverde.
        select coalesce(f.betaald_op, f.factuurdatum) as datum, 1 as volgorde,
               jsonb_build_object(
                 'soort', case when f.status = 'gecrediteerd' then 'gecrediteerd' else 'te_veel' end,
                 'datum', coalesce(f.betaald_op, f.factuurdatum),
                 'bedrag', u.uit,
                 'factuur_id', f.id,
                 'nummer', f.nummer,
                 'opmerking', ''
               ) as regel
        from public.facturen f
        cross join lateral (
          select public.factuur_tegoed_uit(f, (public.factuur_totalen(f.id) ->> 'incl')::numeric) as uit
        ) u
        where f.company_id = bedrijf and f.klant_id = klant and f.deleted_at is null
          and u.uit > 0
        union all
        -- Wat er op een factuur van af ging.
        select f.factuurdatum, 2,
               jsonb_build_object(
                 'soort', 'verrekend',
                 'datum', f.factuurdatum,
                 'bedrag', -f.tegoed_verrekend,
                 'factuur_id', f.id,
                 'nummer', f.nummer,
                 'opmerking', ''
               )
        from public.facturen f
        where f.company_id = bedrijf and f.klant_id = klant and f.deleted_at is null
          and f.tegoed_verrekend > 0
        union all
        -- Wat een mens vereffende.
        select b.op, 3,
               jsonb_build_object(
                 'soort', b.soort,
                 'datum', b.op,
                 'bedrag', b.bedrag,
                 'factuur_id', null,
                 'nummer', null,
                 'opmerking', b.opmerking,
                 'door', b.door_naam
               )
        from public.tegoed_boekingen b
        where b.company_id = bedrijf and b.klant_id = klant
      ) r
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.klant_tegoed(uuid) from public, anon;
grant execute on function public.klant_tegoed(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Tegoed vereffend
-- ---------------------------------------------------------------------
-- Zet het saldo op nul, met een opmerking waarom (teruggestort, contant
-- terugbetaald). Geeft terug hoeveel er vereffend is.
create or replace function public.tegoed_vereffenen(klant uuid, opmerking text default '')
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  saldo numeric;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag het tegoed niet aanpassen.';
  end if;
  -- Zelfde slot als bij het vastzetten: niet tegelijk verrekenen en vereffenen.
  perform 1 from public.klanten where id = klant and company_id = bedrijf for update;
  if not found then
    raise exception 'Die klant bestaat niet.';
  end if;

  saldo := public.klant_tegoed_saldo(bedrijf, klant);
  if abs(saldo) < 0.005 then
    raise exception 'Er staat geen tegoed open.';
  end if;

  insert into public.tegoed_boekingen (company_id, klant_id, soort, bedrag, opmerking, door_naam)
  values (bedrijf, klant, 'vereffend', -saldo, left(btrim(coalesce(opmerking, '')), 300),
          coalesce(public.geld_mijn_naam(), ''));
  return saldo;
end
$$;
revoke execute on function public.tegoed_vereffenen(uuid, text) from public, anon;
grant execute on function public.tegoed_vereffenen(uuid, text) to authenticated;
