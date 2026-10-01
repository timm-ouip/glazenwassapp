-- Contant vooruitbetalen: omrekenen naar een nieuwe prijs.
--
-- Gaat de prijs omhoog terwijl een klant nog beurten vooruit heeft, dan
-- vraagt de app: gratis houden (zoals het werkte: de beurten blijven, de
-- gewone prijs stijgt mee) of omrekenen. Omrekenen = hetzelfde geld, minder
-- beurten: floor(waarde / nieuwe prijs) beurten tegen de nieuwe prijs, en wat
-- overblijft wordt tegoed. Dat is één regel "omgerekend" in het logboek, die
-- met het gewone Ongedaan weer weg kan (dan zijn het weer de oude beurten).
-- Het is geen opgehaald geld en telt in geen enkel totaal mee.

alter table public.betaal_gebeurtenissen drop constraint betaal_gebeurtenissen_soort_check;
alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_soort_check check (soort in (
  'beginstand', 'betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan', 'vooruit', 'terugbetaald',
  'omgerekend'
));
-- bedrag = de waarde van de omgerekende beurten; aantal × prijs_per_beurt is
-- wat daarvan naar de nieuwe beurten gaat (0 beurten kan: alles wordt tegoed).
alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_omgerekend_check check (
  soort <> 'omgerekend' or (
    aantal between 0 and 99
    and prijs_per_beurt > 0 and prijs_per_beurt <= 1000
    and vanaf is not null
    and bedrag >= aantal * prijs_per_beurt
  )
);

drop index public.betaal_gebeurtenissen_vooruit;
create index betaal_gebeurtenissen_vooruit on public.betaal_gebeurtenissen (customer_id)
  where soort in ('vooruit', 'terugbetaald', 'omgerekend');

-- (was: 20261016094000_vooruit_eindreview.sql) Met "omgerekend": die rij is
-- tegelijk een nieuwe vooruitbetaling (aantal × nieuwe prijs) en sluit de
-- beurten van dezelfde klant af die toen over waren. Netto blijft er
-- tegoed over: de oude waarde min de nieuwe beurten.
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
  t_klant uuid[];
  t_alles boolean[];
  t_bedrag numeric[];
  t_soort text[];
  t_aantal int[];
  t_p numeric[];
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
      and g.soort in ('vooruit', 'terugbetaald', 'omgerekend')
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
      where g.customer_id = a and g.company_id = bedrijf and g.soort in ('vooruit', 'omgerekend')
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
           array_agg(g.ontvangen_op order by g.op, g.id), array_agg(g.bedrag order by g.op, g.id),
           array_agg(g.klant_id order by g.op, g.id), array_agg(g.alle_beurten order by g.op, g.id),
           array_agg(g.soort order by g.op, g.id), array_agg(coalesce(g.aantal, 0)::int order by g.op, g.id),
           array_agg(coalesce(g.prijs_per_beurt, 0) order by g.op, g.id)
      into t_id, t_op, t_binnen, t_bedrag, t_klant, t_alles, t_soort, t_aantal, t_p
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort in ('terugbetaald', 'omgerekend')
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
      -- Eerst wat er vóór deze beurt gebeurde: teruggegeven of omgerekend.
      -- "Toen over" = al binnen op het moment dat dat binnenkwam; een
      -- vooruit-tik zonder bereik die later binnenkomt, telt gewoon door.
      while ti <= m and (t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum loop
        t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
        if t_soort[ti] = 'terugbetaald' then
          -- Teruggegeven: de beurten die toen over waren komen vrij als tegoed,
          -- en het teruggegeven geld gaat eraf. Bij een adres dat nog loopt
          -- alleen die van een vorige bewoner; bij een gestopt adres alle.
          for i in 1 .. n loop
            if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
               and (t_alles[ti] or (s_klant[i] is not null and s_klant[i] is distinct from t_klant[ti])) then
              customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
              datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
              return next;
              s_rest[i] := 0;
            end if;
          end loop;
          customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
          datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
          return next;
        else
          -- Omgerekend naar een nieuwe prijs: de beurten van deze klant die toen
          -- over waren, komen vrij als tegoed; daarvan worden de nieuwe beurten
          -- betaald (die staan als eigen vooruitbetaling in de rij hierboven).
          for i in 1 .. n loop
            if s_id[i] <> t_id[ti] and s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
               and (s_klant[i] is null or s_klant[i] is not distinct from t_klant[ti]) then
              customer_id := a; soort := 'omgerekend'; ref := t_id[ti]; vooruit_id := s_id[i];
              datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
              return next;
              s_rest[i] := 0;
            end if;
          end loop;
          customer_id := a; soort := 'omgerekend_af'; ref := t_id[ti]; vooruit_id := null;
          datum := t_dag; bedrag := -(t_aantal[ti] * t_p[ti]); aantal := 0;
          return next;
        end if;
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

    -- Wat er na de laatste beurt gebeurde.
    while ti <= m loop
      t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
      if t_soort[ti] = 'terugbetaald' then
        -- Teruggegeven: de beurten die toen over waren komen vrij als tegoed,
        -- en het teruggegeven geld gaat eraf. Bij een adres dat nog loopt
        -- alleen die van een vorige bewoner; bij een gestopt adres alle.
        for i in 1 .. n loop
          if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
             and (t_alles[ti] or (s_klant[i] is not null and s_klant[i] is distinct from t_klant[ti])) then
            customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
            datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
            return next;
            s_rest[i] := 0;
          end if;
        end loop;
        customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
        datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
        return next;
      else
        -- Omgerekend naar een nieuwe prijs: de beurten van deze klant die toen
        -- over waren, komen vrij als tegoed; daarvan worden de nieuwe beurten
        -- betaald (die staan als eigen vooruitbetaling in de rij hierboven).
        for i in 1 .. n loop
          if s_id[i] <> t_id[ti] and s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
             and (s_klant[i] is null or s_klant[i] is not distinct from t_klant[ti]) then
            customer_id := a; soort := 'omgerekend'; ref := t_id[ti]; vooruit_id := s_id[i];
            datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
            return next;
            s_rest[i] := 0;
          end if;
        end loop;
        customer_id := a; soort := 'omgerekend_af'; ref := t_id[ti]; vooruit_id := null;
        datum := t_dag; bedrag := -(t_aantal[ti] * t_p[ti]); aantal := 0;
        return next;
      end if;
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

-- (was: 20261016090000_vooruit_betalen.sql) Ook het omrekenen: de oude
-- beurten als tegoed erbij, de nieuwe eraf.
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
  union all
  select case when v.soort in ('terug', 'omgerekend') then v.vooruit_id else v.ref end,
         v.customer_id,
         case v.soort when 'tegoed' then 'vooruit_tegoed' when 'terug' then 'vooruit_terug'
                      when 'omgerekend' then 'omgerekend' when 'omgerekend_af' then 'omgerekend_af'
                      else 'terugbetaald' end,
         v.bedrag, g.op, g.door_naam
  from public.geld_vooruit(bedrijf, adressen) v
  join public.betaal_gebeurtenissen g on g.id = case when v.soort = 'tegoed' then v.vooruit_id else v.ref end
  where v.soort in ('tegoed', 'terug', 'terugbetaald', 'omgerekend', 'omgerekend_af') and v.bedrag <> 0
$$;

revoke execute on function public.geld_krediet(uuid, uuid[]) from public, anon, authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) Ook bij omgerekend.
create or replace function public.geld_gebeurtenis_json(g public.betaal_gebeurtenissen)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', g.id, 'customer_id', g.customer_id, 'adres', g.adres, 'soort', g.soort,
    'bedrag', g.bedrag, 'reden', g.reden, 'aantal', g.aantal,
    'maanden', coalesce(to_jsonb(g.maanden), '[]'::jsonb),
    'bron', g.bron, 'door', g.door, 'door_naam', g.door_naam, 'op', g.op, 'vrijgave_id', g.vrijgave_id,
    'botsing_met', g.botsing_met,
    -- Kwam hij pas veel later binnen dan hij getikt werd (geen bereik)?
    'later_binnen', g.ontvangen_op > g.op + interval '10 minutes',
    'ongedaan', (select jsonb_build_object('id', o.id, 'door_naam', o.door_naam, 'op', o.op)
                 from public.betaal_gebeurtenissen o where o.herroept_id = g.id),
    'prijs_per_beurt', g.prijs_per_beurt,
    'vanaf', g.vanaf,
    'prijs_verwacht', g.prijs_verwacht
  ) || case when g.soort in ('vooruit', 'omgerekend') then (
    select jsonb_build_object(
      'gebruikt', count(*) filter (where v.soort = 'dekking' and v.vooruit_id = g.id),
      'teruggegeven', coalesce(sum(v.aantal) filter (where v.soort = 'terug' and v.vooruit_id = g.id), 0),
      -- Bij omgerekend: hoeveel beurten er werden omgerekend.
      'omgerekend_van', coalesce(sum(v.aantal) filter (where v.soort = 'omgerekend' and v.ref = g.id), 0)
    )
    from public.geld_vooruit(g.company_id, array[g.customer_id]) v
    where v.vooruit_id = g.id or v.ref = g.id
  ) else '{}'::jsonb end
$$;

revoke execute on function public.geld_gebeurtenis_json(public.betaal_gebeurtenissen) from public, anon, authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) Ook een omgerekende vooruitbetaling telt.
create or replace function public.vooruit_beurten_open(adres uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  beurten int;
begin
  if not exists (select 1 from public.contant_periodes p where p.customer_id = adres and p.tot is null)
     or not exists (select 1 from public.betaal_gebeurtenissen g
                    where g.customer_id = adres and g.soort in ('vooruit', 'omgerekend')
                      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)) then
    return 0;
  end if;
  select greatest(0, st.vooruit_over - st.vooruit_vast) into beurten
    from public.customers c, public.geld_stand(c.company_id, array[c.id]) st
    where c.id = adres;
  return coalesce(beurten, 0);
end
$$;

revoke execute on function public.vooruit_beurten_open(uuid) from public, anon, authenticated;

-- (was: 20261016095000_vooruit_terug_per_klant.sql) Met de soort
-- "omgerekend". Bewust per adres: een latere knop om meerdere adressen
-- tegelijk te verhogen kan dit per adres aanroepen.
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
  bron text default 'geldloop',
  aantal int default null,
  prijs_per_beurt numeric default null
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
  stuks int := aantal;
  per_beurt numeric := prijs_per_beurt;
  verwacht numeric;
  begint date;
  klant uuid;
  adres_rij record;
  st record;
  terug numeric;
  vorige_waarde numeric;
  vorige_aantal int;
  eigen_waarde numeric;
  stuks_nieuw int;
  gestopt boolean;
  nieuw int;
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

  if soort not in ('betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan', 'vooruit', 'terugbetaald', 'omgerekend') then
    raise exception 'Onbekende soort.';
  end if;
  if bron not in ('geldloop', 'kantoor', 'dag') then
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
    -- Omrekenen hoort bij het wijzigen van de prijs: dat mag wie de prijs
    -- mag wijzigen (zoals de regels op adres_prijzen).
    if soort = 'omgerekend' then
      if not (public.heeft_recht('prijzen_zien') and public.heeft_recht('klanten_bewerken')) then
        raise exception 'Je rol mag de prijs niet wijzigen, en dus ook niet omrekenen.';
      end if;
    elsif not eigenaar then
      raise exception 'Alleen de eigenaar kan op kantoor betalingen boeken.';
    end if;
  elsif bron = 'dag' then
    -- Een wasser die overdag geld krijgt: alleen bij een contant adres dat
    -- vandaag op de route staat, en alleen vandaag.
    if soort not in ('betaald', 'ongedaan') then
      raise exception 'Overdag kun je alleen een betaling intikken.';
    end if;
    if not public.dag_geld_toegang(adres_id)
       or (moment at time zone 'Europe/Amsterdam')::date <> (now() at time zone 'Europe/Amsterdam')::date then
      raise exception 'Dit adres staat vandaag niet op je route, of betaalt niet contant.';
    end if;
  else
    if soort = 'terugbetaald' then
      raise exception 'Teruggeven legt de eigenaar vast, op kantoor.';
    end if;
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
      if now() > vrij_eind + interval '24 hours' then
        raise exception 'Deze tik komt te laat binnen (meer dan een dag na de avond).';
      end if;
    end if;
  end if;

  -- Wat er bij deze soort hoort.
  if soort in ('betaald', 'korting') then
    if schoon <= 0 or schoon > 10000 then
      raise exception 'Vul een bedrag in.';
    end if;
  elsif soort not in ('vooruit', 'terugbetaald', 'omgerekend') then
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
    -- Staan er nog beurten vooruit, of is de laatste beurt met vooruit
    -- betaald, dan zit de vaste korting al in de prijs per beurt.
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    if st.vooruit_over - st.vooruit_vast > 0 or coalesce((
      select x.vooruit > 0 from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' order by x.datum desc, x.ref desc limit 1
    ), false) then
      raise exception 'Deze beurt is vooruit betaald; de vaste korting zit al in de prijs per beurt.';
    end if;
  elsif soort = 'korting' and tekst = '' then
    raise exception 'Zet erbij waarom je korting geeft.';
  end if;

  if soort = 'vooruit' then
    select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') as methode, cu.inactief_op, cu.deleted_at, cu.klant_id
      into adres_rij
      from public.customers cu
      left join public.streets s on s.id = cu.street_id
      left join public.districts d on d.id = s.district_id
      where cu.id = adres_id;
    if adres_rij.deleted_at is not null or adres_rij.inactief_op is not null then
      raise exception 'Dit adres is gestopt; vooruit betalen kan niet meer.';
    end if;
    if adres_rij.methode <> 'contant'
       or not exists (select 1 from public.contant_periodes p where p.customer_id = adres_id and p.tot is null) then
      raise exception 'Dit adres betaalt niet contant; vooruit betalen kan hier niet.';
    end if;
    if stuks is null or stuks < 1 or stuks > 12 then
      raise exception 'Kies tussen 1 en 12 beurten.';
    end if;
    -- Staan er nog beurten van een vorige bewoner, dan eerst die afhandelen:
    -- anders klopt het terug te geven bedrag niet meer.
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    if st.vooruit_vast > 0 then
      raise exception 'Geef eerst de vooruitbetaalde beurten van de vorige bewoner terug.';
    end if;
    verwacht := public.vooruit_prijs(adres_id);
    -- Een lagere prijs per beurt dan de gewone (of een eigen prijs zonder
    -- gewone prijs) is een afspraak die alleen de eigenaar maakt: een beurt
    -- dekt altijd een hele gewone beurt, hoe weinig er ook voor betaald is.
    if not eigenaar then
      if verwacht is null then
        raise exception 'Dit adres heeft geen prijs; vooruit betalen kan alleen op kantoor.';
      end if;
      if per_beurt is not null and round(per_beurt, 2) < verwacht - 0.005 then
        raise exception 'De prijs per beurt is lager dan de gewone prijs (€ %). Laat de eigenaar dit op kantoor boeken.',
          replace(to_char(verwacht, 'FM9999990.00'), '.', ',');
      end if;
    end if;
    per_beurt := round(coalesce(per_beurt, verwacht), 2);
    if per_beurt is null then
      raise exception 'Dit adres heeft geen prijs.';
    end if;
    if per_beurt <= 0 or per_beurt > 1000 then
      raise exception 'De prijs per beurt moet tussen 0 en 1.000 euro liggen.';
    end if;
    if verwacht is not null and abs(verwacht - per_beurt) <= 0.005 then
      verwacht := null;
    end if;
    schoon := stuks * per_beurt;
    klant := adres_rij.klant_id;
    -- Vanaf welke beurt: de oudste wasbeurt die nu nog open staat (niet al
    -- met vooruit betaald), anders de dag na de laatste wasbeurt, anders
    -- vandaag. De beginstand van de papieren kaart doet niet mee.
    select min(x.datum) into begint from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' and x.bedrag - x.gedekt > 0.005 and x.vooruit = 0;
    if begint is null then
      select max(x.datum) + 1 into begint from public.geld_posten(bedrijf, array[adres_id]) x
        where x.soort = 'wassen';
    end if;
    begint := coalesce(begint, (moment at time zone 'Europe/Amsterdam')::date);
  elsif soort = 'omgerekend' then
    -- De prijs is omhoog gegaan en de klant rekent om: hetzelfde geld, minder
    -- beurten tegen de nieuwe prijs; wat overblijft wordt tegoed. Alles
    -- rekent de database zelf; de app geeft mee wat hij liet zien (bedrag =
    -- de waarde van de beurten, aantal = de nieuwe beurten), zodat er niets
    -- anders geboekt wordt dan wat er gevraagd is.
    select cu.inactief_op is not null, cu.klant_id into gestopt, klant
      from public.customers cu where cu.id = adres_id;
    if gestopt then
      raise exception 'Dit adres is gestopt; omrekenen kan niet meer.';
    end if;
    select k.eigen, k.eigen_waarde into vorige_aantal, eigen_waarde
      from public.geld_vooruit_klanten(bedrijf, array[adres_id]) k;
    if coalesce(vorige_aantal, 0) = 0 then
      raise exception 'Er zijn geen vooruitbetaalde beurten om om te rekenen.';
    end if;
    per_beurt := public.vooruit_prijs(adres_id);
    if per_beurt is null then
      raise exception 'Dit adres heeft geen prijs.';
    end if;
    stuks_nieuw := floor(eigen_waarde / per_beurt)::int;
    if stuks_nieuw >= vorige_aantal then
      raise exception 'De prijs is niet hoger dan wat er vooruit betaald is; er valt niets om te rekenen.';
    end if;
    if abs(schoon - eigen_waarde) > 0.005 or (stuks is not null and stuks <> stuks_nieuw) then
      raise exception 'Het is intussen veranderd. Kijk opnieuw en probeer het nog eens.';
    end if;
    schoon := eigen_waarde;
    stuks := stuks_nieuw;
    select min(x.datum) into begint from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' and x.bedrag - x.gedekt > 0.005 and x.vooruit = 0;
    if begint is null then
      select max(x.datum) + 1 into begint from public.geld_posten(bedrijf, array[adres_id]) x
        where x.soort = 'wassen';
    end if;
    begint := coalesce(begint, (moment at time zone 'Europe/Amsterdam')::date);
  elsif soort = 'terugbetaald' then
    -- Zie vooruit_terug: de beurten van vorige bewoners altijd helemaal; bij
    -- een gestopt adres ook de eigen beurten plus tegoed, min wat de laatste
    -- klant nog open heeft.
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    select cu.inactief_op is not null, cu.klant_id into gestopt, klant
      from public.customers cu where cu.id = adres_id;
    select k.vorige_waarde, k.vorige, k.eigen_waarde into vorige_waarde, vorige_aantal, eigen_waarde
      from public.geld_vooruit_klanten(bedrijf, array[adres_id]) k;
    terug := public.vooruit_terug(gestopt, vorige_waarde, eigen_waarde, st.open);
    stuks := case when gestopt then least(st.vooruit_over, 99) else least(coalesce(vorige_aantal, 0), 99) end;
    if terug = 0 and not (gestopt and st.vooruit_over > 0) then
      raise exception 'Er is niets terug te geven.';
    end if;
    if abs(schoon - terug) > 0.005 then
      raise exception 'Het bedrag is intussen veranderd. Kijk opnieuw en probeer het nog eens.';
    end if;
    schoon := terug;
  else
    stuks := null;
    per_beurt := null;
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
      and (
        (oud.vrijgave_id is not null
         and moment < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id))
        or (oud.bron = 'dag'
            and (oud.op at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date)
      )
    ) then
      raise exception 'Na de eindtijd kan alleen de eigenaar dit nog herstellen.';
    end if;
    vrij := coalesce(vrij, oud.vrijgave_id);
  end if;

  -- Een andere betaling op hetzelfde adres, vlak ervoor: van een collega, of
  -- twee keer op de knop gedrukt. Alleen van dezelfde soort: eerst de pof
  -- van de kaart betalen en daarna beurten vooruit is juist de bedoeling.
  if soort in ('betaald', 'vooruit') then
    select g.id into botsing from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.soort = geld_boeken.soort and g.id <> geld_boeken.id
        and g.op > moment - interval '30 minutes' and g.op <= moment + interval '1 minute'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc limit 1;
  end if;

  insert into public.betaal_gebeurtenissen
    (id, company_id, customer_id, adres, soort, bedrag, reden, vaste_korting_id, herroept_id,
     vrijgave_id, bron, door, door_naam, op, getoond_open, botsing_met,
     aantal, prijs_per_beurt, vanaf, klant_id, prijs_verwacht, alle_beurten)
  values
    (geld_boeken.id, bedrijf, adres_id, public.geld_adres_tekst(adres_id), soort, schoon, tekst,
     case when soort = 'korting' then vaste_korting end,
     case when soort = 'ongedaan' then herroept end,
     vrij, bron, auth.uid(), public.geld_mijn_naam(), moment,
     round(getoond_open, 2), botsing,
     stuks,
     case when soort in ('vooruit', 'omgerekend') then per_beurt end,
     case when soort in ('vooruit', 'omgerekend') then begint end,
     case when soort in ('vooruit', 'terugbetaald', 'omgerekend') then klant end,
     case when soort = 'vooruit' then verwacht end,
     soort = 'terugbetaald' and coalesce(gestopt, false))
  on conflict do nothing;
  get diagnostics nieuw = row_count;

  -- Beurten erbij of eraf: misschien kan een geplande wissel nu door (of
  -- moet een doorgegane terug).
  if nieuw > 0 and soort in ('vooruit', 'terugbetaald', 'omgerekend', 'ongedaan') then
    perform public.betaalwissels_bijwerken(bedrijf, array[adres_id]);
  end if;

  return jsonb_build_object('status', 'nieuw', 'botsing', botsing is not null,
                            'prijs_afwijkend', verwacht is not null and soort = 'vooruit');
end
$$;

revoke execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) from public, anon;
grant execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) to authenticated;
