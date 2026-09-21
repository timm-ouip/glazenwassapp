-- Betalingen, fase 3: geldlopen.
--
-- De eigenaar geeft een wijk vrij voor een avond: welke wijk(en), welke dag,
-- en welke geldlopers. Tot de eindtijd (standaard 23:00) zien die lopers de
-- adressen van die wijk met wat er open staat, en tikken ze aan de deur
-- Betaald, Niet thuis of Geen geld. Daarbuiten zien ze niets: geen adressen,
-- geen bedragen. Alles gaat via de functies hieronder; de gewone tabellen
-- (customers, klanten, prijzen) blijven voor hen dicht.

-- ---------------------------------------------------------------------
-- 1. Vrijgaven
-- ---------------------------------------------------------------------
create table public.geldloop_vrijgaven (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  datum date not null,
  begin_op timestamptz not null,
  -- Vastgelegd bij het vrijgeven: een andere eindtijd in Instellingen
  -- verandert een avond die al loopt niet.
  eind_op timestamptz not null,
  vrijgegeven_door uuid default auth.uid(),
  vrijgegeven_naam text not null default '',
  vrijgegeven_op timestamptz not null default now(),
  ingetrokken_op timestamptz,
  ingetrokken_door uuid,
  unique (id, company_id),
  check (eind_op > begin_op)
);
create index geldloop_vrijgaven_datum on public.geldloop_vrijgaven (company_id, datum);

create table public.geldloop_vrijgave_wijken (
  vrijgave_id uuid not null,
  district_id uuid not null references public.districts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (vrijgave_id, district_id),
  foreign key (vrijgave_id, company_id) references public.geldloop_vrijgaven (id, company_id) on delete cascade
);

create table public.geldloop_vrijgave_lopers (
  vrijgave_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (vrijgave_id, employee_id),
  foreign key (vrijgave_id, company_id) references public.geldloop_vrijgaven (id, company_id) on delete cascade
);
create index geldloop_vrijgave_lopers_loper on public.geldloop_vrijgave_lopers (employee_id);

-- Vaste korting van een adres: "Horren € 5". Weghalen is wegleggen.
create table public.vaste_kortingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  naam text not null check (length(btrim(naam)) between 1 and 40),
  bedrag numeric(10, 2) not null check (bedrag > 0 and bedrag <= 1000),
  gemaakt_door uuid default auth.uid(),
  gemaakt_naam text not null default '',
  gemaakt_op timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_door uuid,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create index vaste_kortingen_adres on public.vaste_kortingen (customer_id) where deleted_at is null;

alter table public.betaal_gebeurtenissen
  add constraint betaal_gebeurtenissen_vrijgave_fkey
  foreign key (vrijgave_id) references public.geldloop_vrijgaven (id) on delete set null;
create index betaal_gebeurtenissen_vrijgave on public.betaal_gebeurtenissen (vrijgave_id);

-- ---------------------------------------------------------------------
-- 2. Wie er op dit moment bij een adres mag
-- ---------------------------------------------------------------------
-- De vrijgave die de ingelogde gebruiker op `moment` toegang geeft tot dit
-- adres (in de wijk waar het nu ligt). Leeg = geen toegang.
create or replace function public.geldloop_vrijgave_voor(adres uuid, moment timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id
  from public.customers c
  join public.streets s on s.id = c.street_id
  join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id
  join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
  join public.geldloop_vrijgave_lopers l on l.vrijgave_id = v.id and l.employee_id = auth.uid()
  where c.id = adres
    and v.company_id = public.current_company_id()
    and v.ingetrokken_op is null
    and moment >= v.begin_op and moment < v.eind_op
  order by v.eind_op desc
  limit 1
$$;
revoke execute on function public.geldloop_vrijgave_voor(uuid, timestamptz) from public, anon;
grant execute on function public.geldloop_vrijgave_voor(uuid, timestamptz) to authenticated;

create or replace function public.geldloop_toegang(adres uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.geldloop_vrijgave_voor(adres, now()) is not null
$$;
revoke execute on function public.geldloop_toegang(uuid) from public, anon;
grant execute on function public.geldloop_toegang(uuid) to authenticated;

-- Het logboek: een geldloper ziet ook wat collega's vanavond in zijn wijk
-- intikken (zo werkt "live" samen lopen).
drop policy "Betalingen lezen" on public.betaal_gebeurtenissen;
create policy "Betalingen lezen" on public.betaal_gebeurtenissen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or door = (select auth.uid())
      or public.geldloop_toegang(customer_id)
    )
  );

alter table public.geldloop_vrijgaven enable row level security;
alter table public.geldloop_vrijgave_wijken enable row level security;
alter table public.geldloop_vrijgave_lopers enable row level security;
alter table public.vaste_kortingen enable row level security;
revoke all on public.geldloop_vrijgaven, public.geldloop_vrijgave_wijken,
  public.geldloop_vrijgave_lopers, public.vaste_kortingen from anon;

create policy "Vrijgaven lezen" on public.geldloop_vrijgaven for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('prijzen_zien'))
         or exists (select 1 from public.geldloop_vrijgave_lopers l
                    where l.vrijgave_id = geldloop_vrijgaven.id and l.employee_id = (select auth.uid()))));
create policy "Vrijgave-wijken lezen" on public.geldloop_vrijgave_wijken for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('prijzen_zien'))
         or exists (select 1 from public.geldloop_vrijgave_lopers l
                    where l.vrijgave_id = geldloop_vrijgave_wijken.vrijgave_id
                      and l.employee_id = (select auth.uid()))));
create policy "Vrijgave-lopers lezen" on public.geldloop_vrijgave_lopers for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('prijzen_zien')) or employee_id = (select auth.uid())));
create policy "Vaste kortingen lezen" on public.vaste_kortingen for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('prijzen_zien')) or public.geldloop_toegang(customer_id)));

-- Live meekijken met collega's.
alter publication supabase_realtime add table public.betaal_gebeurtenissen;

-- ---------------------------------------------------------------------
-- 3. Klachten aan de deur: ook bij een adres zonder bekende klant
-- ---------------------------------------------------------------------
alter table public.klachten alter column klant_id drop not null;
alter table public.klachten add constraint klachten_klant_of_adres
  check (klant_id is not null or customer_id is not null);

create or replace function public.klachten_controleren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'afgehandeld' and new.afgehandeld_op is null then
    new.afgehandeld_op := now();
  elsif new.status = 'open' then
    new.afgehandeld_op := null;
  end if;
  if new.customer_id is not null
     and (tg_op = 'INSERT'
          or new.customer_id is distinct from old.customer_id
          or new.klant_id is distinct from old.klant_id)
     and new.klant_id is not null
     and not exists (
       select 1 from public.customers c
        where c.id = new.customer_id and c.klant_id = new.klant_id
     ) then
    raise exception 'Dat adres hoort niet bij deze klant.' using errcode = '23514';
  end if;
  return new;
end
$$;

-- Wordt een adres echt gewist (vanuit de prullenbak), dan gaan klachten die
-- alleen aan dat adres hingen mee: zonder adres en zonder klant zeggen ze niets.
create or replace function public.klachten_adres_weg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.klachten where customer_id = old.id and klant_id is null;
  return old;
end
$$;
create trigger customers_klachten_adres_weg before delete on public.customers
  for each row execute function public.klachten_adres_weg();

-- ---------------------------------------------------------------------
-- 4. Vrijgeven (de eigenaar)
-- ---------------------------------------------------------------------
-- Dagen tot en met vandaag die in deze wijken nog niet met "Dag klaar" zijn
-- afgemeld, sinds de start van de wijk: daar staat nog niets open.
create or replace function public.geld_niet_afgemeld(bedrijf uuid, wijken uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('datum', x.datum, 'wijk', x.wijk, 'aantal', x.aantal)
                            order by x.datum), '[]'::jsonb)
  from (
    select r.datum, d.name as wijk, count(*)::int as aantal
    from public.wasdag_regels r
    join public.customers c on c.id = r.customer_id
    join public.streets s on s.id = c.street_id
    join public.districts d on d.id = s.district_id
    where r.company_id = bedrijf and d.id = any (wijken)
      and r.gedaan_op is null
      and r.datum <= (now() at time zone 'Europe/Amsterdam')::date
      and r.datum > coalesce(d.geld_peildatum, r.datum)
    group by r.datum, d.name
  ) x
$$;
revoke execute on function public.geld_niet_afgemeld(uuid, uuid[]) from public, anon, authenticated;

-- Hetzelfde voor het vrijgeefscherm, vóórdat je vrijgeeft.
create or replace function public.geldloop_niet_afgemeld(wijken uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag dit niet zien.';
  end if;
  return public.geld_niet_afgemeld(bedrijf, coalesce(wijken, '{}'));
end
$$;
revoke execute on function public.geldloop_niet_afgemeld(uuid[]) from public, anon;
grant execute on function public.geldloop_niet_afgemeld(uuid[]) to authenticated;

create or replace function public.geldloop_vrijgeven(
  datum date,
  wijken uuid[],
  lopers uuid[],
  eind time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eindtijd time;
  begin_tijd timestamptz;
  eind_tijd timestamptz;
  niet_klaar text;
  fout_loper text;
  nieuw uuid;
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan een wijk vrijgeven.';
  end if;
  if coalesce(cardinality(wijken), 0) = 0 then
    raise exception 'Kies een wijk.';
  end if;
  if coalesce(cardinality(lopers), 0) = 0 then
    raise exception 'Kies wie er gaan lopen.';
  end if;
  if (select count(*) from public.districts d
      where d.id = any (wijken) and d.company_id = bedrijf and d.deleted_at is null)
     <> cardinality(wijken) then
    raise exception 'Die wijk bestaat niet.';
  end if;
  select string_agg(d.name, ', ') into niet_klaar
    from public.districts d where d.id = any (wijken) and d.geld_klaar_op is null;
  if niet_klaar is not null then
    raise exception 'De beginstand van % is nog niet klaar.', niet_klaar;
  end if;
  -- Alleen mensen van dit bedrijf, en alleen wie mag geldlopen.
  select string_agg(coalesce(nullif(e.naam, ''), e.email), ', ') into fout_loper
    from public.employees e
    left join public.rollen r on r.id = e.rol_id and r.company_id = e.company_id
    where e.id = any (lopers)
      and not (e.company_id = bedrijf
               and (e.rol = 'eigenaar' or 'geldlopen' = any (coalesce(r.rechten, '{}'))));
  if fout_loper is not null then
    raise exception '% mag niet geldlopen. Geef in Instellingen → Team een rol met "Geld lopen".', fout_loper;
  end if;
  if (select count(*) from public.employees e where e.id = any (lopers) and e.company_id = bedrijf)
     <> cardinality(lopers) then
    raise exception 'Die medewerker bestaat niet.';
  end if;

  select coalesce(eind, c.geldloop_eindtijd) into eindtijd from public.companies c where c.id = bedrijf;
  begin_tijd := greatest(now(), (datum::timestamp) at time zone 'Europe/Amsterdam');
  eind_tijd := (datum + eindtijd) at time zone 'Europe/Amsterdam';
  if eind_tijd <= now() then
    raise exception 'Die avond is al voorbij (de eindtijd was %).', to_char(eindtijd, 'HH24:MI');
  end if;

  insert into public.geldloop_vrijgaven (company_id, datum, begin_op, eind_op, vrijgegeven_door, vrijgegeven_naam)
    values (bedrijf, datum, begin_tijd, eind_tijd, auth.uid(), public.geld_mijn_naam())
    returning id into nieuw;
  insert into public.geldloop_vrijgave_wijken (vrijgave_id, district_id, company_id)
    select nieuw, w, bedrijf from unnest(wijken) w group by w;
  insert into public.geldloop_vrijgave_lopers (vrijgave_id, employee_id, company_id)
    select nieuw, l, bedrijf from unnest(lopers) l group by l;

  return jsonb_build_object('id', nieuw, 'niet_afgemeld', public.geld_niet_afgemeld(bedrijf, wijken));
end
$$;

create or replace function public.geldloop_intrekken(vrijgave uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.';
  end if;
  update public.geldloop_vrijgaven
    set ingetrokken_op = now(), ingetrokken_door = auth.uid()
    where id = vrijgave and company_id = public.current_company_id() and ingetrokken_op is null;
end
$$;

create or replace function public.geldloop_eind_wijzigen(vrijgave uuid, eind time)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.geldloop_vrijgaven;
  nieuw_eind timestamptz;
begin
  if not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.';
  end if;
  select * into v from public.geldloop_vrijgaven
    where id = vrijgave and company_id = public.current_company_id();
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  nieuw_eind := (v.datum + eind) at time zone 'Europe/Amsterdam';
  if nieuw_eind <= v.begin_op then
    raise exception 'De eindtijd moet na het begin liggen.';
  end if;
  update public.geldloop_vrijgaven set eind_op = nieuw_eind where id = vrijgave;
end
$$;

-- De vrijgaven vanaf een dag, met wijken en lopers, voor het scherm van de
-- eigenaar.
create or replace function public.geldloop_vrijgaven_vanaf(vanaf date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'datum', v.datum, 'begin_op', v.begin_op, 'eind_op', v.eind_op,
      'vrijgegeven_naam', v.vrijgegeven_naam, 'ingetrokken_op', v.ingetrokken_op,
      'wijken', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'naam', d.name) order by d.sort_order), '[]')
                 from public.geldloop_vrijgave_wijken w join public.districts d on d.id = w.district_id
                 where w.vrijgave_id = v.id),
      'lopers', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                 from public.geldloop_vrijgave_lopers l join public.employees e on e.id = l.employee_id
                 where l.vrijgave_id = v.id)
    ) order by v.datum desc, v.vrijgegeven_op desc)
    from public.geldloop_vrijgaven v
    where v.company_id = bedrijf and v.datum >= vanaf
  ), '[]'::jsonb);
end
$$;

-- Wie er kan geldlopen, om aan te vinken.
create or replace function public.geldloop_mogelijke_lopers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email),
                                        'eigenaar', e.rol = 'eigenaar')
                     order by (e.rol = 'eigenaar'), e.naam)
    from public.employees e
    left join public.rollen r on r.id = e.rol_id and r.company_id = e.company_id
    where e.company_id = bedrijf
      and (e.rol = 'eigenaar' or 'geldlopen' = any (coalesce(r.rechten, '{}')))
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------
-- 5. Voor de geldloper
-- ---------------------------------------------------------------------
-- Mijn avonden van vandaag die nog lopen of nog komen (de eigenaar ziet ze
-- allemaal, ook als hij zelf niet is aangevinkt).
create or replace function public.mijn_geldloop()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eigenaar boolean := public.is_eigenaar();
begin
  if bedrijf is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'datum', v.datum, 'begin_op', v.begin_op, 'eind_op', v.eind_op,
      'wijken', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'naam', d.name) order by d.sort_order), '[]')
                 from public.geldloop_vrijgave_wijken w join public.districts d on d.id = w.district_id
                 where w.vrijgave_id = v.id)
    ) order by v.begin_op)
    from public.geldloop_vrijgaven v
    where v.company_id = bedrijf
      and v.ingetrokken_op is null
      and v.eind_op > now()
      and v.datum <= (now() at time zone 'Europe/Amsterdam')::date
      and (eigenaar or exists (
        select 1 from public.geldloop_vrijgave_lopers l
        where l.vrijgave_id = v.id and l.employee_id = auth.uid()))
  ), '[]'::jsonb);
end
$$;

-- De lijst van één avond: per adres in de vrijgegeven wijken wat er open
-- staat, met wat de geldloper aan de deur nodig heeft. Geen telefoon of mail.
create or replace function public.geldloop_lijst(vrijgave uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  ids uuid[];
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not (
    v.ingetrokken_op is null and now() >= v.begin_op and now() < v.eind_op
    and exists (select 1 from public.geldloop_vrijgave_lopers l
                where l.vrijgave_id = v.id and l.employee_id = auth.uid())
  ) then
    raise exception 'Deze wijk is nu niet voor je vrijgegeven.';
  end if;

  -- Actieve adressen, en gestopte waar nog iets open staat (die komen er
  -- hieronder uit als ze op 0 staan).
  select array_agg(c.id) into ids
    from public.customers c
    join public.streets s on s.id = c.street_id
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null;

  return jsonb_build_object(
    'vrijgave', jsonb_build_object('id', v.id, 'datum', v.datum, 'begin_op', v.begin_op, 'eind_op', v.eind_op,
                                   'ingetrokken', v.ingetrokken_op is not null),
    'adressen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'wijk_id', d.id, 'wijk', d.name, 'wijk_sort', d.sort_order,
        'straat_id', s.id, 'straat', s.name, 'straat_sort', s.sort_order,
        'sort_desc', s.sort_desc, 'doorlopend', s.doorlopend,
        'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
        'sort_order', c.sort_order, 'hoek_kant', coalesce(c.hoek_kant, ''),
        'naam', coalesce(k.naam, ''),
        'note', coalesce(c.note, ''),
        'interval_maanden', c.interval_maanden, 'ritme', c.ritme,
        'methode', coalesce(c.betaalmethode, d.betaalmethode),
        'gestopt', c.inactief_op is not null,
        'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
        'klachten', (select coalesce(jsonb_agg(kl.omschrijving order by kl.ontvangen_op desc), '[]')
                     from public.klachten kl
                     where kl.deleted_at is null and kl.status = 'open'
                       and (kl.customer_id = c.id or (kl.customer_id is null and kl.klant_id = c.klant_id))),
        'vaste_kortingen', (select coalesce(jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag)
                                                      order by vk.gemaakt_op), '[]')
                            from public.vaste_kortingen vk where vk.customer_id = c.id and vk.deleted_at is null),
        'vanavond', (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                               'door', g.door, 'door_naam', g.door_naam)
                     from public.betaal_gebeurtenissen g
                     where g.customer_id = c.id and g.vrijgave_id = v.id
                       and g.soort in ('betaald', 'niet_thuis', 'geen_geld')
                       and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                     order by g.op desc limit 1)
      ))
      from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
      join public.customers c on c.id = st.customer_id
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
      where c.inactief_op is null or st.open <> 0
    ), '[]'::jsonb),
    'opgehaald', (select jsonb_build_object(
                    'mij', coalesce(sum(g.bedrag) filter (where g.door = auth.uid()), 0),
                    'mij_aantal', count(*) filter (where g.door = auth.uid()),
                    'totaal', coalesce(sum(g.bedrag), 0))
                  from public.betaal_gebeurtenissen g
                  where g.vrijgave_id = v.id and g.soort = 'betaald'
                    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id))
  );
end
$$;

-- Eén tik aan de deur (of op kantoor). Komt hetzelfde id twee keer binnen
-- (geen bereik, opnieuw verstuurd), dan telt het één keer. De toegang wordt
-- gecontroleerd op het moment van tikken, zodat wat vóór de eindtijd is
-- ingetikt ook meetelt als het pas later binnenkomt (tot 48 uur).
create or replace function public.geld_boeken(
  id uuid,
  adres_id uuid,
  soort text,
  bedrag numeric default 0,
  reden text default '',
  vaste_korting uuid default null,
  herroept uuid default null,
  op timestamptz default null,
  getoond_open numeric default null,
  bron text default 'geldloop'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eigenaar boolean := public.is_eigenaar();
  moment timestamptz := coalesce(op, now());
  vrij uuid;
  vrij_eind timestamptz;
  bestaand public.betaal_gebeurtenissen;
  oud public.betaal_gebeurtenissen;
  schoon numeric := round(coalesce(bedrag, 0), 2);
  tekst text := btrim(coalesce(reden, ''));
  botsing uuid;
  vk public.vaste_kortingen;
begin
  if bedrijf is null then
    raise exception 'Je bent niet ingelogd.';
  end if;

  select * into bestaand from public.betaal_gebeurtenissen g where g.id = geld_boeken.id;
  if found then
    if bestaand.company_id = bedrijf and bestaand.customer_id = adres_id and bestaand.soort = soort then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', bestaand.botsing_met is not null);
    end if;
    raise exception 'Deze tik bestaat al voor iets anders.';
  end if;

  if soort not in ('betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan') then
    raise exception 'Onbekende soort.';
  end if;
  if bron not in ('geldloop', 'kantoor') then
    raise exception 'Onbekende bron.';
  end if;
  if moment > now() + interval '2 minutes' then
    raise exception 'De klok van je telefoon loopt voor. Zet hem goed en probeer het opnieuw.';
  end if;
  moment := least(moment, now());

  if not exists (select 1 from public.customers c where c.id = adres_id and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;

  -- Wie mag dit?
  if bron = 'kantoor' then
    if not eigenaar then
      raise exception 'Alleen de eigenaar kan op kantoor betalingen boeken.';
    end if;
  else
    vrij := public.geldloop_vrijgave_voor(adres_id, moment);
    if vrij is null and not eigenaar then
      raise exception 'Deze wijk is niet (meer) voor je vrijgegeven.';
    end if;
    if vrij is null and eigenaar then
      -- De eigenaar loopt zelf mee: hang de tik aan de avond van die wijk.
      select v.id into vrij
        from public.customers c
        join public.streets s on s.id = c.street_id
        join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id
        join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
        where c.id = adres_id and v.ingetrokken_op is null
          and moment >= v.begin_op and moment < v.eind_op
        order by v.eind_op desc limit 1;
    end if;
    if vrij is not null then
      select eind_op into vrij_eind from public.geldloop_vrijgaven where geldloop_vrijgaven.id = vrij;
      if now() > vrij_eind + interval '48 hours' then
        raise exception 'Deze tik komt te laat binnen (meer dan twee dagen na de avond).';
      end if;
    end if;
  end if;

  -- Wat er bij deze soort hoort.
  if soort in ('betaald', 'korting') then
    if schoon <= 0 or schoon > 10000 then
      raise exception 'Vul een bedrag in.';
    end if;
  else
    schoon := 0;
  end if;
  if length(tekst) > 200 then
    raise exception 'De reden is te lang.';
  end if;
  if soort = 'korting' and vaste_korting is not null then
    select * into vk from public.vaste_kortingen k
      where k.id = vaste_korting and k.customer_id = adres_id and k.deleted_at is null;
    if not found then
      raise exception 'Die vaste korting bestaat niet meer.';
    end if;
    if tekst = '' then
      tekst := vk.naam;
    end if;
  elsif soort = 'korting' and tekst = '' then
    raise exception 'Zet erbij waarom je korting geeft.';
  end if;

  if soort = 'ongedaan' then
    select * into oud from public.betaal_gebeurtenissen g
      where g.id = herroept and g.customer_id = adres_id and g.company_id = bedrijf;
    if not found or oud.soort in ('ongedaan', 'beginstand') then
      raise exception 'Dat kan niet ongedaan gemaakt worden.';
    end if;
    if exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = oud.id) then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', false);
    end if;
    if not eigenaar and not (
      oud.door = auth.uid()
      and oud.vrijgave_id is not null
      and now() < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id)
    ) then
      raise exception 'Na de eindtijd kan alleen de eigenaar dit nog herstellen.';
    end if;
    vrij := coalesce(vrij, oud.vrijgave_id);
  end if;

  -- Een betaling door iemand anders op hetzelfde adres, vlak ervoor.
  if soort = 'betaald' then
    select g.id into botsing from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.soort = 'betaald' and g.door is distinct from auth.uid()
        and g.op > moment - interval '30 minutes' and g.op <= moment + interval '1 minute'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc limit 1;
  end if;

  insert into public.betaal_gebeurtenissen
    (id, company_id, customer_id, adres, soort, bedrag, reden, vaste_korting_id, herroept_id,
     vrijgave_id, bron, door, door_naam, op, getoond_open, botsing_met)
  values
    (geld_boeken.id, bedrijf, adres_id, public.geld_adres_tekst(adres_id), soort, schoon, tekst,
     case when soort = 'korting' then vaste_korting end,
     case when soort = 'ongedaan' then herroept end,
     vrij, bron, auth.uid(), public.geld_mijn_naam(), moment,
     round(getoond_open, 2), botsing)
  on conflict do nothing;

  return jsonb_build_object('status', 'nieuw', 'botsing', botsing is not null);
end
$$;

-- Een vaste korting bij een adres zetten of weghalen.
create or replace function public.geld_vaste_korting(adres uuid, naam text, bedrag numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  nieuw uuid;
begin
  if bedrijf is null or not (public.is_eigenaar() or public.geldloop_toegang(adres)) then
    raise exception 'Je mag hier nu geen korting instellen.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  insert into public.vaste_kortingen (company_id, customer_id, naam, bedrag, gemaakt_door, gemaakt_naam)
    values (bedrijf, adres, btrim(naam), round(bedrag, 2), auth.uid(), public.geld_mijn_naam())
    returning id into nieuw;
  return nieuw;
end
$$;

create or replace function public.geld_vaste_korting_weg(korting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.vaste_kortingen;
begin
  select * into k from public.vaste_kortingen
    where id = korting and company_id = public.current_company_id() and deleted_at is null;
  if not found then
    return;
  end if;
  if not (public.is_eigenaar() or public.geldloop_toegang(k.customer_id)) then
    raise exception 'Je mag deze korting nu niet weghalen.';
  end if;
  update public.vaste_kortingen set deleted_at = now(), deleted_door = auth.uid() where id = korting;
end
$$;

-- Een klacht aan de deur. Bij de klant van het adres, of alleen bij het
-- adres als er (nog) geen klant bekend is.
create or replace function public.geldloop_klacht(adres uuid, omschrijving text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  klant uuid;
  nieuw uuid;
begin
  if bedrijf is null or not (public.is_eigenaar() or public.geldloop_toegang(adres)) then
    raise exception 'Je mag hier nu geen klacht invoeren.';
  end if;
  if length(btrim(coalesce(omschrijving, ''))) = 0 then
    raise exception 'Schrijf op wat de klacht is.';
  end if;
  select c.klant_id into klant from public.customers c where c.id = adres and c.company_id = bedrijf;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  insert into public.klachten (company_id, klant_id, customer_id, omschrijving, bron, gemaakt_door)
    values (bedrijf, klant, adres, left(btrim(omschrijving), 500), 'deur', auth.uid())
    returning id into nieuw;
  return nieuw;
end
$$;

revoke execute on function public.geldloop_vrijgeven(date, uuid[], uuid[], time) from public, anon;
grant execute on function public.geldloop_vrijgeven(date, uuid[], uuid[], time) to authenticated;
revoke execute on function public.geldloop_intrekken(uuid) from public, anon;
grant execute on function public.geldloop_intrekken(uuid) to authenticated;
revoke execute on function public.geldloop_eind_wijzigen(uuid, time) from public, anon;
grant execute on function public.geldloop_eind_wijzigen(uuid, time) to authenticated;
revoke execute on function public.geldloop_vrijgaven_vanaf(date) from public, anon;
grant execute on function public.geldloop_vrijgaven_vanaf(date) to authenticated;
revoke execute on function public.geldloop_mogelijke_lopers() from public, anon;
grant execute on function public.geldloop_mogelijke_lopers() to authenticated;
revoke execute on function public.mijn_geldloop() from public, anon;
grant execute on function public.mijn_geldloop() to authenticated;
revoke execute on function public.geldloop_lijst(uuid) from public, anon;
grant execute on function public.geldloop_lijst(uuid) to authenticated;
revoke execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text) from public, anon;
grant execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text) to authenticated;
revoke execute on function public.geld_vaste_korting(uuid, text, numeric) from public, anon;
grant execute on function public.geld_vaste_korting(uuid, text, numeric) to authenticated;
revoke execute on function public.geld_vaste_korting_weg(uuid) from public, anon;
grant execute on function public.geld_vaste_korting_weg(uuid) to authenticated;
revoke execute on function public.geldloop_klacht(uuid, text) from public, anon;
grant execute on function public.geldloop_klacht(uuid, text) to authenticated;
