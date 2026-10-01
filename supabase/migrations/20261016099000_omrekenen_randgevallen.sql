-- Omrekenen: twee randgevallen.
--
-- * Een oudere beurt die pas ná het omrekenen wordt afgemeld (terwijl een
--   latere al eerder was afgemeld) werd door niemand gedekt: de oude beurten
--   niet (te laat), de nieuwe niet (vóór hun vanaf-datum). Nu dekken de
--   nieuwe beurten alles wat na het omrekenen ging meetellen.
-- * Wordt een dag teruggezet of "niet gewassen" teruggedraaid na het
--   omrekenen, dan houdt de beurt zijn oude afmeldtijd en ging hij van de
--   oude beurten af. Nu telt het moment waarop hij weer meetelt: de nieuwe
--   regel (teruggezet) of het terugdraaien van het stempel. De afmeldtijd
--   zelf en Dag klaar blijven zoals ze zijn.
-- Verder gelijk aan de versie uit 20261016098000_omrekenen_eigenaar_en_volgorde.sql.

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
  -- De vooruitbetalingen (ook die uit omrekenen), oud naar nieuw.
  s_id uuid[];
  s_binnen timestamptz[];
  s_rest int[];
  s_p numeric[];
  s_vanaf date[];
  s_klant uuid[];
  s_grens date[];
  -- Omgerekend door (id, tijd van tikken, tijd van binnenkomen): deze
  -- beurten dekken alleen wat vóór dat moment was afgemeld.
  s_om uuid[];
  s_om_op timestamptz[];
  s_om_binnen timestamptz[];
  -- Zelf een omgerekende betaling: dekt alleen wat vanaf dat moment is afgemeld.
  s_nieuw_op timestamptz[];
  -- Teruggegeven, op volgorde.
  t_id uuid[];
  t_op timestamptz[];
  t_binnen timestamptz[];
  t_klant uuid[];
  t_alles boolean[];
  t_bedrag numeric[];
  -- Omgerekend, op volgorde.
  r record;
  n int;
  m int;
  i int;
  j int;
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
           array_agg(coalesce(g.aantal, 0)::int order by g.op, g.id), array_agg(g.prijs_per_beurt order by g.op, g.id),
           array_agg(g.vanaf order by g.op, g.id), array_agg(g.klant_id order by g.op, g.id),
           array_agg(case when g.soort = 'omgerekend' then g.op end order by g.op, g.id)
      into s_id, s_binnen, s_rest, s_p, s_vanaf, s_klant, s_nieuw_op
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
    s_om := '{}';
    s_om_op := '{}';
    s_om_binnen := '{}';
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
      -- Het eerste omrekenen ná deze betaling, van dezelfde klant, zet hem om.
      select g.id, g.op, g.ontvangen_op into r
        from public.betaal_gebeurtenissen g
        where g.customer_id = a and g.company_id = bedrijf and g.soort = 'omgerekend'
          and g.id <> s_id[i] and g.ontvangen_op >= s_binnen[i]
          and (s_klant[i] is null or g.klant_id is not distinct from s_klant[i])
          and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
        order by g.op, g.id
        limit 1;
      s_om := array_append(s_om, r.id);
      s_om_op := array_append(s_om_op, r.op);
      s_om_binnen := array_append(s_om_binnen, r.ontvangen_op);
    end loop;

    select array_agg(g.id order by g.op, g.id), array_agg(g.op order by g.op, g.id),
           array_agg(g.ontvangen_op order by g.op, g.id), array_agg(g.bedrag order by g.op, g.id),
           array_agg(g.klant_id order by g.op, g.id), array_agg(g.alle_beurten order by g.op, g.id)
      into t_id, t_op, t_binnen, t_bedrag, t_klant, t_alles
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort = 'terugbetaald'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id);
    m := coalesce(cardinality(t_id), 0);
    ti := 1;

    for p in
      -- Vanaf wanneer deze beurt meetelt: afgemeld, of later pas (de dag is
      -- weggehaald en teruggezet, of "niet gewassen" is teruggedraaid).
      select x.ref, x.datum, x.bedrag as w, coalesce(nullif(wp.normaal, 0), x.bedrag) as b,
             greatest(coalesce(wr.gedaan_op, '-infinity'::timestamptz),
                      coalesce(wr.created_at, '-infinity'::timestamptz),
                      coalesce((select max(gw.teruggedraaid_op) from public.geldloop_wijzigingen gw
                                where gw.customer_id = a and gw.soort = 'niet_gewassen'
                                  and gw.voor ->> 'id' = x.ref::text), '-infinity'::timestamptz)) as gedaan
      from public.geld_schuld(bedrijf, array[a]) x
      left join public.wasdag_prijzen wp on wp.regel_id = x.ref
      left join public.wasdag_regels wr on wr.id = x.ref
      where x.soort = 'wassen'
      order by x.datum, x.ref
    loop
      -- Eerst wat er vóór deze beurt is teruggegeven: de beurten die toen
      -- over waren komen vrij als tegoed, en het teruggegeven geld gaat eraf.
      -- "Toen over" = al binnen op het moment dat het teruggeven binnenkwam;
      -- een vooruit-tik zonder bereik die later binnenkomt, telt gewoon door.
      -- Bij een adres dat nog loopt alleen de beurten van een vorige bewoner;
      -- bij een gestopt adres alle. Beurten die al waren omgerekend, niet.
      while ti <= m and (t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum loop
        t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
        for i in 1 .. n loop
          if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
             and (s_om_binnen[i] is null or s_om_binnen[i] > t_binnen[ti])
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
        ti := ti + 1;
      end loop;

      -- Welke beurten deze wasbeurt dekken: wat vóór een omrekenen meetelde,
      -- gaat van de oude beurten; wat daarna ging meetellen, van de nieuwe
      -- (op het moment van afmelden, niet op de datum van de beurt). De
      -- nieuwe beurten dekken ook een oudere beurt die pas na het omrekenen
      -- werd afgemeld: hun vanaf-datum geldt niet.
      for i in 1 .. n loop
        if s_rest[i] > 0
           and (case when s_nieuw_op[i] is not null then p.gedaan >= s_nieuw_op[i]
                     else s_vanaf[i] <= p.datum end)
           and (s_om_op[i] is null or p.gedaan < s_om_op[i])
           and (s_grens[i] is null or p.datum <= s_grens[i]) then
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
        if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0
           and (s_om_binnen[i] is null or s_om_binnen[i] > t_binnen[ti])
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
      ti := ti + 1;
    end loop;

    -- Omgerekend: wat er van de oude beurten over was komt vrij als tegoed,
    -- en de nieuwe beurten gaan eraf. Netto blijft het verschil als tegoed.
    for j in 1 .. n loop
      if s_nieuw_op[j] is not null then
        t_dag := (s_nieuw_op[j] at time zone 'Europe/Amsterdam')::date;
        for i in 1 .. n loop
          if s_om[i] = s_id[j] and s_rest[i] > 0 then
            customer_id := a; soort := 'omgerekend'; ref := s_id[j]; vooruit_id := s_id[i];
            datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
            return next;
            s_rest[i] := 0;
          end if;
        end loop;
        customer_id := a; soort := 'omgerekend_af'; ref := s_id[j]; vooruit_id := null;
        datum := t_dag;
        bedrag := -(select g.aantal * g.prijs_per_beurt from public.betaal_gebeurtenissen g where g.id = s_id[j]);
        aantal := 0;
        return next;
      end if;
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
