-- Betalingen, fase 1: betaalmethode, beginstand en het betaallogboek.
--
-- Een adres betaalt contant of maakt over. De wijk heeft een standaard; een
-- adres volgt die, tenzij je bij het adres zelf iets anders kiest
-- (customers.betaalmethode leeg = volgt de wijk). Bij de start staan alle
-- wijken op contant.
--
-- Wat er open staat, rekent de database elke keer opnieuw uit:
--   beginstand (de pof van de papieren kaart, per wijk met de hand ingevuld)
--   + afgemelde wasbeurten (wasdag_regels.gedaan_op, zie fase 2 "Dag klaar")
--   + uitgevoerde klussen
--   − betalingen en kortingen.
-- Betalingen dekken de oudste schuld eerst. Niets wordt overschreven: een
-- correctie is een nieuwe regel "ongedaan" in het logboek, zodat altijd te
-- zien blijft wie iets intikte en wie het herstelde.

-- ---------------------------------------------------------------------
-- 0. Reservekopie van wat hieronder (en in dag_klaar en geldlopen) wordt
--    aangeraakt, buiten het bereik van de app.
-- ---------------------------------------------------------------------
create schema if not exists backup_betalingen;
revoke all on schema backup_betalingen from public, anon, authenticated;
create table backup_betalingen.wasdag_regels as select *, now() as bewaard_op from public.wasdag_regels;
create table backup_betalingen.klachten as select *, now() as bewaard_op from public.klachten;
create table backup_betalingen.districts as select *, now() as bewaard_op from public.districts;
create table backup_betalingen.rollen as select *, now() as bewaard_op from public.rollen;

-- ---------------------------------------------------------------------
-- 1. Betaalmethode en de start per wijk
-- ---------------------------------------------------------------------
alter table public.districts
  add column betaalmethode text not null default 'contant'
    check (betaalmethode in ('contant', 'overmaken')),
  -- Tot en met deze dag zit alles in de beginstand; daarna telt Wooshy zelf.
  add column geld_peildatum date,
  -- Beginstand klaar: pas dan kan de wijk vrijgegeven worden voor geldlopen.
  add column geld_klaar_op timestamptz,
  add column geld_klaar_door uuid;

alter table public.customers
  add column betaalmethode text check (betaalmethode in ('contant', 'overmaken'));

-- Tot hoe laat een vrijgegeven wijk open blijft voor de geldlopers.
alter table public.companies
  add column geldloop_eindtijd time not null default '23:00';

-- Het nieuwe recht.
alter table public.rollen drop constraint rollen_rechten_check;
alter table public.rollen add constraint rollen_rechten_check check (
  rechten <@ array[
    'mail_lezen', 'mail_versturen', 'klanten_bekijken', 'klanten_bewerken',
    'prijzen_zien', 'planning', 'instellingen_team', 'geldlopen'
  ]::text[]
);

-- Wasbeurten per adres opzoeken, voor de rekensom hieronder.
create index wasdag_regels_adres_datum_idx on public.wasdag_regels (customer_id, datum);

-- ---------------------------------------------------------------------
-- 2. Gedaan: pas een afgemelde wasbeurt is geld waard
--
-- Fase 2 zet dit met "Dag klaar". Alles van vóór vandaag was al gewassen
-- (zo telde de app het tot nu toe), dus dat krijgt meteen een stempel.
-- ---------------------------------------------------------------------
alter table public.wasdag_regels
  add column gedaan_op timestamptz,
  add column gedaan_door uuid,
  -- Verhuist gedaan werk naar een andere dag, dan onthoudt de regel waar en
  -- wanneer het gedaan was. Komt hij terug (Ongedaan maken), dan ook de stempel.
  add column gedaan_bewaard jsonb;

update public.wasdag_regels
  set gedaan_op = (datum + time '18:00') at time zone 'Europe/Amsterdam'
  where datum < (now() at time zone 'Europe/Amsterdam')::date;

-- ---------------------------------------------------------------------
-- 3. Wanneer een adres contant betaalde
--
-- Een wasbeurt telt alleen als hij binnen zo'n periode valt. Wisselt een
-- adres van betaalmethode, dan sluit de periode: wat er al open stond blijft
-- staan, nieuw werk telt niet meer mee. Alleen de functies hieronder
-- schrijven hierin.
-- ---------------------------------------------------------------------
create table public.contant_periodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  vanaf date not null,
  tot date,
  gemaakt_op timestamptz not null default now(),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  check (tot is null or tot >= vanaf)
);
create unique index contant_periodes_lopend on public.contant_periodes (customer_id) where tot is null;
create index contant_periodes_adres on public.contant_periodes (customer_id, vanaf);
create trigger contant_periodes_set_company_id before insert on public.contant_periodes
  for each row execute function public.set_company_id();
-- Alleen via de functies hieronder; niemand leest of schrijft deze tabel
-- direct. Toch de vaste regel per bedrijf: gaat hij ooit open, dan ziet
-- niemand die van een ander bedrijf.
alter table public.contant_periodes enable row level security;
revoke all on public.contant_periodes from anon, authenticated;
create policy "Eigen bedrijf" on public.contant_periodes
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- ---------------------------------------------------------------------
-- 4. Het betaallogboek: er komt alleen iets bij
-- ---------------------------------------------------------------------
create table public.betaal_gebeurtenissen (
  -- De telefoon maakt het id zelf: komt een tik twee keer binnen (geen
  -- bereik, opnieuw verstuurd), dan telt hij maar één keer.
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  -- Het adres zoals het toen heette, voor als het later verandert.
  adres text not null default '',
  soort text not null check (soort in (
    'beginstand', 'betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan'
  )),
  bedrag numeric(10, 2) not null default 0 check (bedrag >= 0 and bedrag <= 100000),
  -- Alleen bij een beginstand: voor hoeveel wasbeurten hij staat en tot welke dag.
  aantal smallint check (aantal is null or aantal between 0 and 99),
  peildatum date,
  -- Bij een beginstand uit de kaartweergave: welke maanden nog open stonden
  -- ("2026-07"), zoals de nullen op de papieren kaart.
  maanden text[],
  reden text not null default '' check (length(reden) <= 200),
  vaste_korting_id uuid,
  herroept_id uuid references public.betaal_gebeurtenissen (id),
  vrijgave_id uuid,
  bron text not null default 'kantoor' check (bron in ('geldloop', 'dag', 'kantoor')),
  door uuid default auth.uid(),
  door_naam text not null default '',
  -- Het moment van tikken; ontvangen_op is wanneer het hier binnenkwam.
  op timestamptz not null default now(),
  ontvangen_op timestamptz not null default now(),
  -- Wat de telefoon op dat moment als open bedrag liet zien.
  getoond_open numeric(10, 2),
  -- Een betaling van iemand anders op hetzelfde adres, kort ervoor: mogelijk dubbel.
  botsing_met uuid,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict,
  check ((soort = 'ongedaan') = (herroept_id is not null)),
  check (soort <> 'beginstand' or peildatum is not null)
);
-- Iets kan maar één keer ongedaan gemaakt worden.
create unique index betaal_gebeurtenissen_herroept on public.betaal_gebeurtenissen (herroept_id)
  where herroept_id is not null;
create index betaal_gebeurtenissen_adres on public.betaal_gebeurtenissen (customer_id, op);
create index betaal_gebeurtenissen_bedrijf on public.betaal_gebeurtenissen (company_id, op);
create trigger betaal_gebeurtenissen_set_company_id before insert on public.betaal_gebeurtenissen
  for each row execute function public.set_company_id();

alter table public.betaal_gebeurtenissen enable row level security;
revoke all on public.betaal_gebeurtenissen from anon;
-- Lezen: wie prijzen ziet, en ieder zijn eigen tikken. Schrijven gaat alleen
-- via de functies hieronder (en in fase 3 die van de geldlopers).
create policy "Betalingen lezen" on public.betaal_gebeurtenissen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and ((select public.heeft_recht('prijzen_zien')) or door = (select auth.uid()))
  );

-- ---------------------------------------------------------------------
-- 5. Wie wat mag aan wijk en adres
-- ---------------------------------------------------------------------
-- De betaalmethode en de start van een wijk: alleen de eigenaar. Wie plant
-- mag een wijk wel hernoemen.
create or replace function public.wijk_geld_controleren()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_company_id() is null or public.is_eigenaar() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.betaalmethode := 'contant';
    new.geld_peildatum := null;
    new.geld_klaar_op := null;
    new.geld_klaar_door := null;
    return new;
  end if;
  if (new.betaalmethode, new.geld_peildatum, new.geld_klaar_op, new.geld_klaar_door)
     is distinct from
     (old.betaalmethode, old.geld_peildatum, old.geld_klaar_op, old.geld_klaar_door) then
    raise exception 'Alleen de eigenaar kan de betaalmethode en de beginstand van een wijk veranderen.';
  end if;
  return new;
end
$$;
create trigger districts_geld_controleren before insert or update on public.districts
  for each row execute function public.wijk_geld_controleren();

-- De betaalmethode van een adres hoort bij "klanten bewerken", net als
-- weggooien en laten stoppen. Verder gelijk aan de versie uit rechten_rls.
create or replace function public.adres_wijziging_controleren()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_company_id() is null then
    return new;
  end if;
  if (new.deleted_at, new.inactief_op, new.inactief_reden, new.klant_id, new.house_number, new.addition, new.betaalmethode)
     is distinct from
     (old.deleted_at, old.inactief_op, old.inactief_reden, old.klant_id, old.house_number, old.addition, old.betaalmethode)
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen, van klant wisselen of de betaalmethode veranderen.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- 6. De contante periodes bijhouden
-- ---------------------------------------------------------------------
-- Opent of sluit de periode van één adres, naar wat het nu is. `start` geeft
-- de begindatum als een wijk net begint; anders begint een nieuwe periode
-- vandaag (of de dag na de peildatum, als die later is).
create or replace function public.geld_periode_bijwerken(adres uuid, start date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  lopend record;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  select cu.company_id, coalesce(cu.betaalmethode, d.betaalmethode) as methode, d.geld_peildatum as peil
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres;
  if not found then
    return;
  end if;
  select id, vanaf into lopend from public.contant_periodes where customer_id = adres and tot is null;
  if c.methode = 'contant' and c.peil is not null then
    if lopend.id is null then
      insert into public.contant_periodes (company_id, customer_id, vanaf)
        values (c.company_id, adres, coalesce(start, greatest(c.peil + 1, vandaag)));
    end if;
  elsif lopend.id is not null then
    -- Tot en met gisteren was het contant. Begon de periode pas vandaag of
    -- later, dan heeft hij nooit gegolden.
    if lopend.vanaf > vandaag - 1 then
      delete from public.contant_periodes where id = lopend.id;
    else
      update public.contant_periodes set tot = vandaag - 1 where id = lopend.id;
    end if;
  end if;
end
$$;
revoke execute on function public.geld_periode_bijwerken(uuid, date) from public, anon, authenticated;

create or replace function public.geld_periode_adres()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.geld_periode_bijwerken(new.id);
  return null;
end
$$;
create trigger customers_geld_periode_nieuw after insert on public.customers
  for each row execute function public.geld_periode_adres();
create trigger customers_geld_periode after update of street_id, betaalmethode on public.customers
  for each row
  when (old.street_id is distinct from new.street_id or old.betaalmethode is distinct from new.betaalmethode)
  execute function public.geld_periode_adres();

create or replace function public.geld_periode_straat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.geld_periode_bijwerken(c.id) from public.customers c where c.street_id = new.id;
  return null;
end
$$;
create trigger streets_geld_periode after update of district_id on public.streets
  for each row when (old.district_id is distinct from new.district_id)
  execute function public.geld_periode_straat();

create or replace function public.geld_periode_wijk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.geld_periode_bijwerken(c.id)
    from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = new.id and c.betaalmethode is null;
  return null;
end
$$;
create trigger districts_geld_periode after update of betaalmethode on public.districts
  for each row when (old.betaalmethode is distinct from new.betaalmethode)
  execute function public.geld_periode_wijk();

-- ---------------------------------------------------------------------
-- 7. De rekensom
--
-- Alleen voor andere functies: die controleren eerst wie er vraagt.
-- ---------------------------------------------------------------------
-- Alles wat een adres ooit contant moest betalen, oud naar nieuw.
create or replace function public.geld_schuld(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag, greatest(coalesce(g.aantal, 1), 1)::int,
         coalesce(array_to_string(g.maanden, ','), ''), 0, g.id
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort = 'beginstand' and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  -- Wasbeurten: met de dagnotitie en het extra werk van die maand erbij.
  select r.customer_id, 'wassen', r.datum, wp.prijs, 1,
         concat_ws(' · ',
           (select string_agg(btrim(m ->> 'notitie'), ', ')
              from jsonb_array_elements(
                     case when jsonb_typeof(cu.maandwerk) = 'array' then cu.maandwerk else '[]'::jsonb end
                   ) m
              where coalesce(m -> 'maanden', '[]'::jsonb) ? to_char(r.datum, 'MM')
                and coalesce(m ->> 'jaar', '') in ('', to_char(r.datum, 'YYYY'))
                and btrim(coalesce(m ->> 'notitie', '')) <> ''),
           nullif(btrim(r.notitie), '')),
         1, r.id
  from public.wasdag_regels r
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  join public.customers cu on cu.id = r.customer_id
  where r.company_id = bedrijf and r.customer_id = any (adressen)
    and r.gedaan_op is not null and wp.prijs > 0
    and r.datum <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = r.customer_id and r.datum >= p.vanaf and (p.tot is null or r.datum <= p.tot)
    )
  union all
  -- Uitgevoerde klussen, met wat het was.
  select k.customer_id, 'klus', k.gedaan_op, kp.prijs, 1, k.omschrijving, 2, k.id
  from public.klussen k
  join public.klus_prijzen kp on kp.klus_id = k.id
  where k.company_id = bedrijf and k.customer_id = any (adressen)
    and k.gedaan_op is not null and k.deleted_at is null and kp.prijs > 0
    and k.gedaan_op <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = k.customer_id and k.gedaan_op >= p.vanaf and (p.tot is null or k.gedaan_op <= p.tot)
    )
$$;

-- Betalingen en kortingen die niet zijn teruggedraaid.
create or replace function public.geld_krediet(bedrijf uuid, adressen uuid[])
returns table (id uuid, customer_id uuid, soort text, bedrag numeric, op timestamptz, door_naam text)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.customer_id, g.soort, g.bedrag, g.op, g.door_naam
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort in ('betaald', 'korting') and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
$$;

-- Elke schuldpost met hoeveel ervan betaald is. Het geld dekt de oudste
-- posten eerst: een post is gedekt voor zover het totaal aan betalingen
-- verder reikt dan alle schuld die ervóór kwam.
create or replace function public.geld_posten(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid,
  gedekt numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select x.*, sum(x.bedrag) over (
      partition by x.customer_id order by x.datum, x.volg, x.ref
      rows between unbounded preceding and current row
    ) - x.bedrag as ervoor
    from public.geld_schuld(bedrijf, adressen) x
  ),
  k as (
    select y.customer_id, sum(y.bedrag) as totaal
    from public.geld_krediet(bedrijf, adressen) y
    group by y.customer_id
  )
  select s.customer_id, s.soort, s.datum, s.bedrag, s.aantal, s.omschrijving, s.volg, s.ref,
    greatest(0, least(s.bedrag, coalesce(k.totaal, 0) - s.ervoor))
  from s
  left join k on k.customer_id = s.customer_id
$$;

-- Per adres: wat er open staat (negatief = tegoed), hoeveel wasbeurten dat
-- zijn (een deels betaalde beginstand telt naar verhouding), en de posten
-- die nog niet (helemaal) betaald zijn.
create or replace function public.geld_stand(bedrijf uuid, adressen uuid[])
returns table (customer_id uuid, open numeric, open_wassen int, delen jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select * from public.geld_posten(bedrijf, adressen)
  ),
  schuld as (
    select p.customer_id, sum(p.bedrag) as totaal from p group by p.customer_id
  ),
  krediet as (
    select k.customer_id, sum(k.bedrag) as totaal
    from public.geld_krediet(bedrijf, adressen) k group by k.customer_id
  ),
  onbetaald as (
    select p.customer_id,
      sum(case
            when p.soort = 'beginstand' then ceil(p.aantal * (p.bedrag - p.gedekt) / p.bedrag - 0.0001)
            when p.soort = 'wassen' then 1
            else 0
          end)::int as open_wassen,
      jsonb_agg(jsonb_build_object(
        'soort', p.soort,
        'datum', p.datum,
        'bedrag', p.bedrag,
        'rest', round(p.bedrag - p.gedekt, 2),
        'aantal', p.aantal,
        'omschrijving', coalesce(p.omschrijving, '')
      ) order by p.datum, p.volg, p.ref) as delen
    from p
    where p.bedrag - p.gedekt > 0.005
    group by p.customer_id
  )
  select a.id,
    round(coalesce(s.totaal, 0) - coalesce(k.totaal, 0), 2),
    coalesce(o.open_wassen, 0),
    coalesce(o.delen, '[]'::jsonb)
  from unnest(adressen) as a(id)
  left join schuld s on s.customer_id = a.id
  left join krediet k on k.customer_id = a.id
  left join onbetaald o on o.customer_id = a.id
$$;

revoke execute on function public.geld_schuld(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.geld_krediet(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.geld_posten(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.geld_stand(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Wat de app aanroept
-- ---------------------------------------------------------------------
-- Naam van wie er nu ingelogd is, voor in het logboek.
create or replace function public.geld_mijn_naam()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(e.naam), ''), e.email, '')
  from public.employees e where e.id = auth.uid()
$$;
revoke execute on function public.geld_mijn_naam() from public, anon, authenticated;

-- "Graafschap Hollandlaan 25A", zoals het op dat moment heet.
create or replace function public.geld_adres_tekst(adres uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(' ', coalesce(nullif(btrim(s.name), ''), '?'), cu.house_number::text || coalesce(cu.addition, ''))
  from public.customers cu left join public.streets s on s.id = cu.street_id
  where cu.id = adres
$$;
revoke execute on function public.geld_adres_tekst(uuid) from public, anon, authenticated;

-- Een wijk laten beginnen: tot en met `peildatum` zit alles in de
-- beginstand, vanaf de dag erna telt Wooshy zelf. Mag opnieuw zolang de wijk
-- nog niet klaar is (dan schuift de start mee).
create or replace function public.geld_wijk_starten(wijk uuid, peildatum date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  d record;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan de beginstand invullen.';
  end if;
  if peildatum is null or peildatum > vandaag then
    raise exception 'Kies vandaag of een dag eerder als stand van de kaarten.';
  end if;
  select * into d from public.districts
    where id = wijk and company_id = bedrijf and deleted_at is null
    for update;
  if not found then
    raise exception 'Die wijk bestaat niet.';
  end if;
  if d.geld_klaar_op is not null then
    raise exception 'De beginstand van deze wijk is al klaar. Zet hem eerst terug op "nog niet klaar".';
  end if;
  if d.geld_peildatum is not distinct from peildatum then
    return;
  end if;
  update public.districts set geld_peildatum = peildatum where id = wijk;
  -- De periodes die bij de vorige start hoorden, schuiven mee.
  if d.geld_peildatum is not null then
    delete from public.contant_periodes p
      using public.customers c, public.streets s
      where p.customer_id = c.id and s.id = c.street_id and s.district_id = wijk
        and p.vanaf = d.geld_peildatum + 1;
  end if;
  perform public.geld_periode_bijwerken(c.id, peildatum + 1)
    from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = wijk and c.company_id = bedrijf;
end
$$;
revoke execute on function public.geld_wijk_starten(uuid, date) from public, anon;
grant execute on function public.geld_wijk_starten(uuid, date) to authenticated;

-- De beginstand van één adres zetten. De vorige wordt ongedaan gemaakt, niet
-- overschreven. 0 = geen pof.
create or replace function public.geld_beginstand_zetten(
  adres_id uuid,
  bedrag numeric,
  aantal int default 1,
  maanden text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  peil date;
  oud uuid;
  naam text := public.geld_mijn_naam();
  tekst text := public.geld_adres_tekst(adres_id);
  schoon numeric := round(coalesce(bedrag, 0), 2);
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan de beginstand invullen.';
  end if;
  if schoon < 0 or schoon > 10000 then
    raise exception 'Vul een bedrag tussen 0 en 10.000 in.';
  end if;
  if aantal is not null and (aantal < 0 or aantal > 99) then
    raise exception 'Het aantal wasbeurten moet tussen 0 en 99 liggen.';
  end if;
  if maanden is not null and exists (
    select 1 from unnest(maanden) m where m !~ '^\d{4}-(0[1-9]|1[0-2])$'
  ) then
    raise exception 'Onbekende maand.';
  end if;
  select d.geld_peildatum into peil
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    where cu.id = adres_id and cu.company_id = bedrijf;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if peil is null then
    raise exception 'Kies eerst de datum van de beginstand voor deze wijk.';
  end if;
  for oud in
    select g.id from public.betaal_gebeurtenissen g
    where g.customer_id = adres_id and g.soort = 'beginstand'
      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  loop
    insert into public.betaal_gebeurtenissen
      (company_id, customer_id, adres, soort, herroept_id, bron, door, door_naam)
      values (bedrijf, adres_id, tekst, 'ongedaan', oud, 'kantoor', auth.uid(), naam);
  end loop;
  if schoon > 0 then
    insert into public.betaal_gebeurtenissen
      (company_id, customer_id, adres, soort, bedrag, aantal, peildatum, maanden, bron, door, door_naam)
      values (bedrijf, adres_id, tekst, 'beginstand', schoon, greatest(coalesce(aantal, 1), 1), peil,
              (select array_agg(distinct m order by m) from unnest(maanden) m),
              'kantoor', auth.uid(), naam);
  end if;
end
$$;
revoke execute on function public.geld_beginstand_zetten(uuid, numeric, int, text[]) from public, anon;
grant execute on function public.geld_beginstand_zetten(uuid, numeric, int, text[]) to authenticated;

-- Beginstand klaar (of toch nog niet).
create or replace function public.geld_wijk_klaar(wijk uuid, klaar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  peil date;
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan de beginstand klaarzetten.';
  end if;
  select geld_peildatum into peil from public.districts
    where id = wijk and company_id = bedrijf and deleted_at is null;
  if not found then
    raise exception 'Die wijk bestaat niet.';
  end if;
  if klaar and peil is null then
    raise exception 'Kies eerst de datum van de beginstand.';
  end if;
  update public.districts
    set geld_klaar_op = case when klaar then now() end,
        geld_klaar_door = case when klaar then auth.uid() end
    where id = wijk;
end
$$;
revoke execute on function public.geld_wijk_klaar(uuid, boolean) from public, anon;
grant execute on function public.geld_wijk_klaar(uuid, boolean) to authenticated;

-- De stand van alle adressen van een wijk (ook de gestopte), voor wie
-- prijzen mag zien.
create or replace function public.geld_stand_wijk(wijk uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  ids uuid[];
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  select array_agg(c.id) into ids
    from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = wijk and c.company_id = bedrijf and c.deleted_at is null;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', st.customer_id,
      'open', st.open,
      'open_wassen', st.open_wassen,
      'delen', st.delen,
      'beginstand', (
        select jsonb_build_object('bedrag', g.bedrag, 'aantal', g.aantal, 'door', g.door_naam, 'op', g.op,
                                  'maanden', coalesce(to_jsonb(g.maanden), '[]'::jsonb))
        from public.betaal_gebeurtenissen g
        where g.customer_id = st.customer_id and g.soort = 'beginstand'
          and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
        order by g.op desc limit 1
      )
    ))
    from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
  ), '[]'::jsonb);
end
$$;
revoke execute on function public.geld_stand_wijk(uuid) from public, anon;
grant execute on function public.geld_stand_wijk(uuid) to authenticated;
