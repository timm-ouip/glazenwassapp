-- Contant vooruitbetalen: herstelpunten uit de review.
--
-- * De wissel naar overmaken onthoudt nu waar hij naartoe gaat: naar
--   overmaken, of "volg de wijk" (wissel_naar). Gaat een wijk terug naar
--   contant, dan vervallen de wissels die van die wijk kwamen, in plaats van
--   later alsnog door te gaan.
-- * Een nieuwe bewoner: in plaats van één klant_sinds per adres komt elke
--   klantwissel in een eigen lijst. Zo verschuift een tweede wissel (C na B)
--   niet de grens van de eerste, en maakt B nooit de beurten van A op.
-- * Een gestopt adres wisselt niet van betaalmethode.
-- * Een oude momentopname zonder gewone prijs laat de gewone prijs staan die
--   de database zelf uitrekende, in plaats van hem leeg te maken (dan zou
--   vooruit het extra werk gratis dekken).
-- Er stonden nog geen wissels en geen klant_sinds; er valt niets over te zetten.

-- ---------------------------------------------------------------------
-- 1. Waar de wissel naartoe gaat: 'overmaken', of leeg = volg de wijk.
-- ---------------------------------------------------------------------
alter table public.customers
  add column wissel_naar text check (wissel_naar = 'overmaken');

-- ---------------------------------------------------------------------
-- 2. Klantwissels per adres
-- ---------------------------------------------------------------------
-- Alleen de trigger op customers schrijft hierin; alleen de rekensom leest.
-- Toch de vaste regel per bedrijf, zoals contant_periodes.
create table public.adres_klantwissels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  van_klant uuid not null,
  naar_klant uuid,
  -- Tot wanneer de vorige klant hier woonde: zijn stopmoment, of de wissel zelf.
  tot timestamptz not null,
  gemaakt_op timestamptz not null default now(),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create index adres_klantwissels_adres on public.adres_klantwissels (customer_id, van_klant);
alter table public.adres_klantwissels enable row level security;
revoke all on public.adres_klantwissels from anon, authenticated;
create policy "Eigen bedrijf" on public.adres_klantwissels
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- ---------------------------------------------------------------------
-- 3. De functies
-- ---------------------------------------------------------------------
-- Houdt de kolommen van de vooruitbetaling bij, bij elke wijziging van een
-- adres (was: 20261016090000_vooruit_betalen.sql). Nieuw:
--   * een andere klant komt in adres_klantwissels in plaats van één
--     klant_sinds per adres, zodat een tweede wissel de grens van de eerste
--     niet verschuift;
--   * de wissel onthoudt waar hij naartoe gaat (wissel_naar).
create or replace function public.customers_vooruit_bewaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vlag boolean := coalesce(current_setting('wooshy.wissel', true), '') = '1';
  oud_methode text;
  nieuw_wijk text;
  nieuw_peil date;
  nieuw_methode text;
  beurten int;
begin
  -- Een andere klant aan dit adres: vastleggen tot wanneer de vorige hier
  -- woonde (het stoppen, of nu). Van een adres zonder klant naar een klant
  -- is invullen, geen nieuwe bewoner.
  if new.klant_id is distinct from old.klant_id and old.klant_id is not null then
    insert into public.adres_klantwissels (company_id, customer_id, van_klant, naar_klant, tot)
      values (old.company_id, old.id, old.klant_id, new.klant_id, coalesce(old.inactief_op, now()));
  end if;

  if vlag then
    return new;
  end if;
  new.wissel_status := old.wissel_status;
  new.wissel_naar := old.wissel_naar;
  new.wissel_vorige := old.wissel_vorige;
  new.wissel_gepland_op := old.wissel_gepland_op;
  new.wissel_gepland_naam := old.wissel_gepland_naam;
  new.wissel_uitgevoerd_op := old.wissel_uitgevoerd_op;
  new.wissel_periode_tot := old.wissel_periode_tot;

  if new.betaalmethode is not distinct from old.betaalmethode
     and new.street_id is not distinct from old.street_id then
    return new;
  end if;

  -- Zelf een andere methode kiezen na een doorgegane wissel: dan hoort die
  -- wissel er niet meer bij.
  if old.wissel_status = 'uitgevoerd' and new.betaalmethode is distinct from old.betaalmethode then
    new.wissel_status := null;
    new.wissel_naar := null;
    new.wissel_vorige := null;
    new.wissel_gepland_op := null;
    new.wissel_gepland_naam := null;
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;

  oud_methode := coalesce(old.betaalmethode, (
    select d.betaalmethode from public.streets s join public.districts d on d.id = s.district_id
    where s.id = old.street_id), 'contant');
  select d.betaalmethode, d.geld_peildatum into nieuw_wijk, nieuw_peil
    from public.streets s join public.districts d on d.id = s.district_id
    where s.id = new.street_id;
  nieuw_methode := coalesce(new.betaalmethode, nieuw_wijk, 'contant');
  if oud_methode <> 'contant' then
    return new;
  end if;

  -- Zelf weer uitdrukkelijk contant kiezen terwijl er een wissel klaarstaat:
  -- dan gaat die wissel niet meer door.
  if old.wissel_status = 'gepland' and new.betaalmethode is distinct from old.betaalmethode
     and nieuw_methode = 'contant' then
    new.wissel_status := null;
    new.wissel_naar := null;
    new.wissel_vorige := null;
    new.wissel_gepland_op := null;
    new.wissel_gepland_naam := null;
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;

  if new.street_id is distinct from old.street_id then
    if nieuw_methode = 'overmaken' or nieuw_peil is null then
      beurten := public.vooruit_beurten_open(old.id);
      if beurten > 0 then
        raise exception 'Dit adres heeft nog % vooruit betaalde beurt(en). Verhuis het pas naar deze wijk als die op zijn, of geef ze eerst terug.', beurten;
      end if;
    end if;
    return new;
  end if;

  if nieuw_methode <> 'overmaken' then
    return new;
  end if;
  beurten := public.vooruit_beurten_open(old.id);
  if beurten = 0 then
    return new;
  end if;

  if not (auth.role() = 'service_role' or public.current_company_id() is null
          or coalesce(current_setting('wooshy.geldloop', true), '') = '1')
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen, van klant wisselen of de betaalmethode veranderen.';
  end if;

  -- Blijft contant zoals het was; de wissel komt later.
  -- Wat er gevraagd werd (overmaken, of de wijk volgen) is waar de wissel
  -- straks naartoe gaat.
  new.wissel_naar := new.betaalmethode;
  new.betaalmethode := case when coalesce(nieuw_wijk, 'contant') = 'overmaken' then 'contant' else old.betaalmethode end;
  if old.wissel_status is distinct from 'gepland' then
    new.wissel_status := 'gepland';
    new.wissel_vorige := old.betaalmethode;
    new.wissel_gepland_op := now();
    new.wissel_gepland_naam := coalesce(public.geld_mijn_naam(), '');
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;
  return new;
end
$$;


-- (was: 20261016090000_vooruit_betalen.sql) De wissel gaat naar "volg de wijk".
create or replace function public.vooruit_wissel_plannen(adressen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  oud text := coalesce(current_setting('wooshy.wissel', true), '');
begin
  for c in
    select cu.id
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    where cu.id = any (adressen) and cu.betaalmethode is null and d.betaalmethode = 'overmaken'
  loop
    if public.vooruit_beurten_open(c.id) > 0 then
      perform set_config('wooshy.wissel', '1', true);
      update public.customers
        set betaalmethode = 'contant', wissel_status = 'gepland', wissel_naar = null, wissel_vorige = null,
            wissel_gepland_op = now(), wissel_gepland_naam = coalesce(public.geld_mijn_naam(), ''),
            wissel_uitgevoerd_op = null, wissel_periode_tot = null
        where id = c.id;
      perform set_config('wooshy.wissel', oud, true);
    end if;
  end loop;
end
$$;

revoke execute on function public.vooruit_wissel_plannen(uuid[]) from public, anon, authenticated;

-- (was: 20261016090000_vooruit_betalen.sql)
create or replace function public.geld_periode_wijk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  oud text := coalesce(current_setting('wooshy.wissel', true), '');
begin
  -- Terug naar contant: wissels die van de wijk kwamen gaan niet meer door.
  -- Gepland: het adres volgt de wijk weer. Doorgegaan: dat adres volgt de
  -- wijk al en is daarmee vanzelf weer contant.
  if new.betaalmethode = 'contant' then
    perform set_config('wooshy.wissel', '1', true);
    update public.customers c
      set betaalmethode = case when c.wissel_status = 'gepland' then c.wissel_vorige else c.betaalmethode end,
          wissel_status = null, wissel_naar = null, wissel_vorige = null, wissel_gepland_op = null,
          wissel_gepland_naam = null, wissel_uitgevoerd_op = null, wissel_periode_tot = null
      from public.streets s
      where s.id = c.street_id and s.district_id = new.id
        and c.wissel_status is not null and c.wissel_naar is null;
    perform set_config('wooshy.wissel', oud, true);
  end if;
  perform public.vooruit_wissel_plannen(array(
    select c.id from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = new.id and c.betaalmethode is null));
  perform public.geld_periode_bijwerken(c.id)
    from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = new.id and c.betaalmethode is null;
  return null;
end
$$;


-- (was: 20261016090000_vooruit_betalen.sql) Gaat naar wat er gevraagd werd
-- (wissel_naar), slaat gestopte adressen over, en laat een wissel vallen
-- waarvan het doel intussen contant is.
create or replace function public.betaalwissels_bijwerken(bedrijf uuid, adressen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  beurten int;
  laatst date;
  sluit_op date;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  oud_vlag text := coalesce(current_setting('wooshy.wissel', true), '');
  oud_tot text := coalesce(current_setting('wooshy.periode_tot', true), '');
  periode uuid;
begin
  for c in
    select cu.id, cu.betaalmethode, cu.wissel_status, cu.wissel_naar, cu.wissel_vorige, cu.wissel_periode_tot,
           d.betaalmethode as wijk
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.company_id = bedrijf and cu.id = any (adressen) and cu.wissel_status is not null
      -- Een gestopt adres wisselt niet; komt het terug, dan gaat het verder.
      and cu.inactief_op is null and cu.deleted_at is null
  loop
    select greatest(0, st.vooruit_over - st.vooruit_vast) into beurten
      from public.geld_stand(bedrijf, array[c.id]) st;
    beurten := coalesce(beurten, 0);

    if c.wissel_status = 'gepland' and beurten = 0
       and coalesce(c.wissel_naar, c.wijk, 'contant') <> 'overmaken' then
      -- Het doel is intussen zelf contant (de wijk ging terug): niets te doen.
      perform set_config('wooshy.wissel', '1', true);
      update public.customers
        set betaalmethode = c.wissel_vorige,
            wissel_status = null, wissel_naar = null, wissel_vorige = null, wissel_gepland_op = null,
            wissel_gepland_naam = null, wissel_uitgevoerd_op = null, wissel_periode_tot = null
        where id = c.id;
      perform set_config('wooshy.wissel', oud_vlag, true);

    elsif c.wissel_status = 'gepland' and beurten = 0 then
      -- De laatste contante beurt telt nog mee, ook als die vandaag was.
      select max(r.datum) into laatst
        from public.wasdag_regels r
        where r.customer_id = c.id and r.company_id = bedrijf
          and r.gedaan_op is not null and r.niet_gewassen_op is null
          and r.betaalmethode is distinct from 'overmaken' and r.datum <= vandaag;
      sluit_op := greatest(vandaag - 1, laatst);
      perform set_config('wooshy.wissel', '1', true);
      perform set_config('wooshy.periode_tot', sluit_op::text, true);
      update public.customers
        set betaalmethode = c.wissel_naar,
            wissel_status = 'uitgevoerd', wissel_uitgevoerd_op = now(), wissel_periode_tot = sluit_op
        where id = c.id;
      perform set_config('wooshy.periode_tot', oud_tot, true);
      perform set_config('wooshy.wissel', oud_vlag, true);

    elsif c.wissel_status = 'uitgevoerd' and beurten > 0
          and coalesce(c.betaalmethode, c.wijk, 'contant') = 'overmaken' then
      -- De contante periode loopt gewoon door, alsof er niets gebeurd is.
      -- Wat intussen als overmaken is afgemeld blijft overmaken (die regels
      -- tellen nooit als contante schuld).
      if not exists (select 1 from public.contant_periodes p where p.customer_id = c.id and p.tot is null) then
        select p.id into periode from public.contant_periodes p
          where p.customer_id = c.id and p.tot = c.wissel_periode_tot
          order by p.vanaf desc limit 1;
        if periode is not null then
          update public.contant_periodes set tot = null where id = periode;
        end if;
      end if;
      perform set_config('wooshy.wissel', '1', true);
      update public.customers
        set betaalmethode = case when c.wissel_vorige is null and c.wijk = 'overmaken' then 'contant' else c.wissel_vorige end,
            wissel_status = 'gepland', wissel_uitgevoerd_op = null, wissel_periode_tot = null
        where id = c.id;
      perform set_config('wooshy.wissel', oud_vlag, true);
    end if;
  end loop;
end
$$;

revoke execute on function public.betaalwissels_bijwerken(uuid, uuid[]) from public, anon, authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) Ook wissel_naar leeg.
create or replace function public.betaalwissel_ongedaan(adres uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  c record;
  periode uuid;
begin
  if bedrijf is null or not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag de betaalmethode niet veranderen.';
  end if;
  select cu.id, cu.wissel_status, cu.wissel_vorige, cu.wissel_periode_tot, d.betaalmethode as wijk
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres and cu.company_id = bedrijf
    for update of cu;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if c.wissel_status is null then
    return;
  end if;

  if c.wissel_status = 'uitgevoerd'
     and not exists (select 1 from public.contant_periodes p where p.customer_id = c.id and p.tot is null) then
    select p.id into periode from public.contant_periodes p
      where p.customer_id = c.id and p.tot = c.wissel_periode_tot
      order by p.vanaf desc limit 1;
    if periode is not null then
      update public.contant_periodes set tot = null where id = periode;
    end if;
  end if;

  perform set_config('wooshy.wissel', '1', true);
  update public.customers
    set betaalmethode = case
          when c.wissel_status = 'gepland' then betaalmethode
          when c.wissel_vorige is null and c.wijk = 'overmaken' then 'contant'
          else c.wissel_vorige end,
        wissel_status = null, wissel_naar = null, wissel_vorige = null, wissel_gepland_op = null, wissel_gepland_naam = null,
        wissel_uitgevoerd_op = null, wissel_periode_tot = null
    where id = c.id;
  perform set_config('wooshy.wissel', '', true);
end
$$;

revoke execute on function public.betaalwissel_ongedaan(uuid) from public, anon;
grant execute on function public.betaalwissel_ongedaan(uuid) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) De grens bij een nieuwe
-- bewoner komt uit adres_klantwissels.
create or replace function public.geld_vooruit(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  ref uuid,
  vooruit_id uuid,
  datum date,
  bedrag numeric,
  aantal int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  a uuid;
  cu record;
  p record;
  stop_dag date;
  s_id uuid[];
  s_binnen timestamptz[];
  s_rest int[];
  s_p numeric[];
  s_vanaf date[];
  s_klant uuid[];
  s_grens date[];
  t_id uuid[];
  t_op timestamptz[];
  t_binnen timestamptz[];
  t_bedrag numeric[];
  n int;
  m int;
  i int;
  ti int;
  t_dag date;
  dek numeric;
  meer numeric;
begin
  for a in
    select distinct g.customer_id
    from public.betaal_gebeurtenissen g
    where g.company_id = bedrijf and g.customer_id = any (adressen)
      and g.soort in ('vooruit', 'terugbetaald')
      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  loop
    select c.klant_id, c.inactief_op into cu from public.customers c where c.id = a;
    stop_dag := (cu.inactief_op at time zone 'Europe/Amsterdam')::date;

    select array_agg(g.id order by g.op, g.id),
           array_agg(g.ontvangen_op order by g.op, g.id),
           array_agg(g.aantal::int order by g.op, g.id), array_agg(g.prijs_per_beurt order by g.op, g.id),
           array_agg(g.vanaf order by g.op, g.id), array_agg(g.klant_id order by g.op, g.id)
      into s_id, s_binnen, s_rest, s_p, s_vanaf, s_klant
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort = 'vooruit'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id);
    n := coalesce(cardinality(s_id), 0);

    -- Tot en met welke dag een betaling beurten mag opmaken: niet na het
    -- stoppen, en niet meer nadat de betaler hier wegging (de eerste
    -- klantwissel na de betaling). Woont de betaler er nu weer, dan telt
    -- alleen het stoppen. Betaald op een adres zonder klant: dan hoort de
    -- betaling bij de klant die daarna wordt ingevuld (meestal de betaler).
    s_grens := '{}';
    for i in 1 .. n loop
      s_grens := array_append(s_grens, least(
        stop_dag,
        case when s_klant[i] is not null and s_klant[i] is distinct from cu.klant_id then
          coalesce((
            select (min(w.tot) at time zone 'Europe/Amsterdam')::date
            from public.adres_klantwissels w
            where w.customer_id = a and w.van_klant = s_klant[i] and w.gemaakt_op >= s_binnen[i]
          ), '-infinity'::date)
        end
      ));
    end loop;

    select array_agg(g.id order by g.op, g.id), array_agg(g.op order by g.op, g.id),
           array_agg(g.ontvangen_op order by g.op, g.id), array_agg(g.bedrag order by g.op, g.id)
      into t_id, t_op, t_binnen, t_bedrag
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort = 'terugbetaald'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id);
    m := coalesce(cardinality(t_id), 0);
    ti := 1;

    for p in
      select x.ref, x.datum, x.bedrag as w, coalesce(nullif(wp.normaal, 0), x.bedrag) as b
      from public.geld_schuld(bedrijf, array[a]) x
      left join public.wasdag_prijzen wp on wp.regel_id = x.ref
      where x.soort = 'wassen'
      order by x.datum, x.ref
    loop
      -- Eerst wat er vóór deze beurt is teruggegeven: de beurten die toen
      -- over waren komen vrij als tegoed, en het teruggegeven geld gaat eraf.
      -- "Toen over" = al binnen op het moment dat het teruggeven binnenkwam;
      -- een vooruit-tik zonder bereik die later binnenkomt, telt gewoon door.
      while ti <= m and (t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum loop
        t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
        for i in 1 .. n loop
          if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0 then
            customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
            datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
            return next;
            s_rest[i] := 0;
          end if;
        end loop;
        customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
        datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
        return next;
        ti := ti + 1;
      end loop;

      for i in 1 .. n loop
        if s_rest[i] > 0 and s_vanaf[i] <= p.datum and (s_grens[i] is null or p.datum <= s_grens[i]) then
          s_rest[i] := s_rest[i] - 1;
          dek := least(p.w, p.b);
          customer_id := a; soort := 'dekking'; ref := p.ref; vooruit_id := s_id[i];
          datum := p.datum; bedrag := dek; aantal := 1;
          return next;
          meer := greatest(0, s_p[i] - dek);
          if meer > 0 then
            customer_id := a; soort := 'tegoed'; ref := p.ref; vooruit_id := s_id[i];
            datum := p.datum; bedrag := meer; aantal := 0;
            return next;
          end if;
          exit;
        end if;
      end loop;
    end loop;

    -- Wat er na de laatste beurt is teruggegeven.
    while ti <= m loop
      t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
      for i in 1 .. n loop
        if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0 then
          customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
          datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
          return next;
          s_rest[i] := 0;
        end if;
      end loop;
      customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
      datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
      return next;
      ti := ti + 1;
    end loop;

    for i in 1 .. n loop
      if s_rest[i] > 0 then
        customer_id := a;
        soort := case when s_grens[i] is not null then 'over_vast' else 'over' end;
        ref := s_id[i]; vooruit_id := s_id[i];
        datum := s_vanaf[i]; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
        return next;
      end if;
    end loop;
  end loop;
end
$$;

revoke execute on function public.geld_vooruit(uuid, uuid[]) from public, anon, authenticated;

-- (was: 20261016090000_vooruit_betalen.sql)
create or replace function public.wasdag_terugzetten(kenmerk uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  bewaard jsonb;
  nieuw uuid[] := '{}';
  aantal integer := 0;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald
  where id = kenmerk and company_id = bedrijf
  returning regels into bewaard;
  if bewaard is null then
    raise exception 'Dit is al teruggezet of te lang geleden.';
  end if;
  perform set_config('wooshy.gedaan', '1', true);

  -- Eerst terugzetten, mét de indeling van die dag en of het gedaan was. De
  -- prijsregel maakt een trigger aan zodra deze opdracht klaar is; pas daarna
  -- kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels
      (company_id, datum, customer_id, notitie, ploeg_nr, volgorde, rest, vaste_start,
       gedaan_op, gedaan_door, gedaan_bewaard, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time,
           nullif(r ->> 'gedaan_op', '')::timestamptz,
           nullif(r ->> 'gedaan_door', '')::uuid,
           case when jsonb_typeof(r -> 'gedaan_bewaard') = 'object' then r -> 'gedaan_bewaard' end,
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(bewaard) as t(r)
    where r ->> 'customer_id' is not null
      and exists (
        select 1 from public.customers c
        where c.id = (r ->> 'customer_id')::uuid
          and c.company_id = bedrijf
          -- Gedaan werk komt altijd terug; de planning alleen voor wie nog
          -- klant is.
          and (
            (r ->> 'datum')::date <= vandaag
            or (c.deleted_at is null and c.inactief_op is null)
          )
      )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;
  aantal := cardinality(nieuw);

  -- De gewone prijs gaat mee terug. Een oude momentopname zonder die prijs:
  -- dan blijft de gewone prijs die de database bij het terugzetten uitrekende.
  update public.wasdag_prijzen wp
  set prijs = (r ->> 'prijs')::numeric,
      normaal = case when jsonb_typeof(r -> 'normaal') = 'number' then (r ->> 'normaal')::numeric else wp.normaal end
  from public.wasdag_regels w, jsonb_array_elements(bewaard) as t(r)
  where wp.regel_id = w.id
    and w.id = any(nieuw)
    and w.customer_id = (r ->> 'customer_id')::uuid
    and w.datum = (r ->> 'datum')::date
    and jsonb_typeof(r -> 'prijs') = 'number';

  return aantal;
end
$$;

revoke execute on function public.wasdag_terugzetten(uuid) from public, anon;
grant execute on function public.wasdag_terugzetten(uuid) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql)
create or replace function public.stoppen_terugdraaien(uitkomst jsonb, voor_bedrijf uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- Het oude bedrag terugzetten mag wie een dagprijs mag wijzigen: prijzen
  -- zien én planning (zoals de regels op wasdag_prijzen). Anders blijft de
  -- momentopname die de database zelf uitrekent.
  prijzen_zichtbaar boolean := auth.role() = 'service_role'
    or (public.heeft_recht('prijzen_zien') and public.heeft_recht('planning'));
  moment timestamptz := (uitkomst ->> 'inactief_op')::timestamptz;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  terug uuid[] := '{}';
  nieuw uuid[] := '{}';
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if moment is null then
    raise exception 'Onbekende stopzetting.';
  end if;

  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and deleted_at is null
      and inactief_op = moment
      and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'adressen', '[]'::jsonb)))::uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into terug from u;

  update public.klanten
  set deleted_at = null
  where company_id = bedrijf
    and deleted_at = moment
    and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'klanten', '[]'::jsonb)))::uuid);

  -- De planning terug. De prijs rekent de database zelf opnieuw uit (trigger
  -- op wasdag_regels); alleen wie prijzen mag zien, zet het oude bedrag terug.
  -- Alleen de regels die hier echt terugkomen krijgen straks hun oude prijs:
  -- een dag die intussen opnieuw is ingepland houdt zijn eigen bedrag.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where (r ->> 'datum')::date >= vandaag
      and (r ->> 'customer_id')::uuid = any(terug)
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;

  if prijzen_zichtbaar then
    update public.wasdag_prijzen wp
    set prijs = (r ->> 'prijs')::numeric,
        normaal = case when jsonb_typeof(r -> 'normaal') = 'number' then (r ->> 'normaal')::numeric else wp.normaal end
    from public.wasdag_regels w,
      jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where wp.regel_id = w.id
      and w.id = any(nieuw)
      and w.company_id = bedrijf
      and w.customer_id = (r ->> 'customer_id')::uuid
      and w.datum = (r ->> 'datum')::date
      and w.customer_id = any(terug)
      and w.datum >= vandaag
      and jsonb_typeof(r -> 'prijs') = 'number';
  end if;

  return cardinality(terug);
end
$$;

revoke execute on function public.stoppen_terugdraaien(jsonb, uuid) from public, anon;
grant execute on function public.stoppen_terugdraaien(jsonb, uuid) to authenticated;

-- klant_sinds wordt nergens meer gebruikt.
alter table public.customers drop column klant_sinds;
