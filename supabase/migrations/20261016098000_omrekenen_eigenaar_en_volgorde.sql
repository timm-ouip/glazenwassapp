-- Omrekenen: herstelpunten uit de review.
--
-- * Alleen de eigenaar rekent om, en alleen op kantoor (net als
--   teruggeven): het hoort bij een afspraak over geld, niet bij de deur.
-- * Welke beurten een wasbeurt dekken hangt af van wanneer hij werd
--   afgemeld (Dag klaar), niet van zijn datum: wat vóór het omrekenen was
--   afgemeld gaat van de oude beurten, wat daarna komt van de nieuwe. Zo
--   klopt het altijd met wat de app bij het omrekenen liet zien: een beurt
--   van gisteren die pas later wordt afgemeld, of een beurt van vandaag die
--   al eerder was afgemeld, verschuift niets meer. (Vervangt de regel uit
--   20261016097000_omrekenen_zelfde_dag.sql.)

-- (was: 20261016097000_omrekenen_zelfde_dag.sql)
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
      select x.ref, x.datum, x.bedrag as w, coalesce(nullif(wp.normaal, 0), x.bedrag) as b,
             coalesce(wr.gedaan_op, '-infinity'::timestamptz) as gedaan
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

      -- Welke beurten deze wasbeurt dekken: wat vóór een omrekenen werd
      -- afgemeld, gaat van de oude beurten; wat daarna werd afgemeld, van de
      -- nieuwe (op het moment van Dag klaar, niet op de datum van de beurt).
      for i in 1 .. n loop
        if s_rest[i] > 0 and s_vanaf[i] <= p.datum
           and (s_nieuw_op[i] is null or p.gedaan >= s_nieuw_op[i])
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

-- (was: 20261016096000_vooruit_omrekenen.sql) Omrekenen alleen door de eigenaar, op kantoor.
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
    if not eigenaar then
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
    if soort = 'omgerekend' then
      raise exception 'Omrekenen naar een nieuwe prijs doet de eigenaar, op kantoor.';
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
