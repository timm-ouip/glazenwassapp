-- Omrekenen geldt vanaf de dag zelf.
--
-- Een beurt van de dag waarop omgerekend werd, die pas daarna werd afgemeld,
-- ging nog van de oude beurten af: dan was er na het omrekenen minder geld
-- dan de app had laten zien, en kwam de klant tekort. Nu gaat het omrekenen
-- vóór de beurten van die dag. Verder gelijk aan de versie uit
-- 20261016096000_vooruit_omrekenen.sql.

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
      -- Teruggeven telt na de beurten van die dag; omrekenen geldt al voor de
      -- beurt van die dag zelf (de nieuwe prijs gaat in op de dag van het
      -- omrekenen).
      while ti <= m
            and ((t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum
                 or (t_soort[ti] = 'omgerekend' and (t_op[ti] at time zone 'Europe/Amsterdam')::date <= p.datum)) loop
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
