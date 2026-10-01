-- Contant vooruitbetalen: correcties uit de eindreview.
--
-- * Een geldloper kan geen lagere prijs per beurt boeken dan de gewone (een
--   beurt van één cent dekte anders een hele beurt), en zonder gewone prijs
--   niet vooruit laten betalen. De eigenaar op kantoor wel.
-- * Nieuwe bewoner: pas vooruit betalen als de beurten van de vorige zijn
--   teruggegeven. Teruggeven bij een adres dat nog loopt gaat alleen over die
--   beurten (plus tegoed): wat de huidige klant open heeft blijft open, en
--   zijn eigen vooruit-beurten blijven staan. Bij een gestopt adres blijft
--   het alles, min wat er nog open staat.
-- * De browser kan bij het aanmaken van een adres geen wisselkolommen zetten.
-- * betaalwissel_ongedaan zet de vlag terug op wat hij was.
-- * Terugzetten van een weggehaalde dag houdt de betaalmethode van Dag klaar.

-- ---------------------------------------------------------------------
-- 1. Het logboek: welke beurten een "terugbetaald" afsloot
-- ---------------------------------------------------------------------
-- Waar: het adres was gestopt, alle beurten gingen eraf. Anders alleen die
-- van een andere klant dan klant_id (de klant van toen).
alter table public.betaal_gebeurtenissen
  add column alle_beurten boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Een nieuw adres begint zonder wissel
-- ---------------------------------------------------------------------
create or replace function public.customers_vooruit_nieuw()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('wooshy.wissel', true), '') <> '1' then
    new.wissel_status := null;
    new.wissel_naar := null;
    new.wissel_vorige := null;
    new.wissel_gepland_op := null;
    new.wissel_gepland_naam := null;
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;
  return new;
end
$$;
create trigger customers_vooruit_nieuw before insert on public.customers
  for each row execute function public.customers_vooruit_nieuw();

-- ---------------------------------------------------------------------
-- 3. De functies
-- ---------------------------------------------------------------------
-- (was: 20261016091000_vooruit_betalen_herstel.sql) Teruggeven sluit alleen
-- de beurten van vorige bewoners af, of alles als het adres gestopt was.
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
           array_agg(g.ontvangen_op order by g.op, g.id), array_agg(g.bedrag order by g.op, g.id),
           array_agg(g.klant_id order by g.op, g.id), array_agg(g.alle_beurten order by g.op, g.id)
      into t_id, t_op, t_binnen, t_bedrag, t_klant, t_alles
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
      -- Bij een adres dat nog loopt geeft de eigenaar alleen de beurten van
      -- een vorige bewoner terug; die van de huidige klant blijven staan. Bij
      -- een gestopt adres gaan alle beurten eraf.
      while ti <= m and (t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum loop
        t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
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
--   * vooruit: een geldloper mag geen lagere prijs per beurt boeken dan de
--     gewone, en zonder gewone prijs niet vooruit laten betalen; eerst de
--     beurten van een vorige bewoner teruggeven.
--   * terugbetaald: bij een adres dat nog loopt alleen de beurten van vorige
--     bewoners plus tegoed. Het logboek onthoudt voor welke klant, en of het
--     adres gestopt was (dan gaan alle beurten eraf).
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
  vast_waarde numeric;
  vast_aantal int;
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

  if soort not in ('betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan', 'vooruit', 'terugbetaald') then
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
  elsif soort not in ('vooruit', 'terugbetaald') then
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
  elsif soort = 'terugbetaald' then
    -- Gestopt: alle beurten plus tegoed, min wat er nog open staat. Loopt
    -- het adres nog: alleen de beurten van vorige bewoners plus tegoed; wat
    -- de huidige klant nog open heeft blijft gewoon open staan.
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    select cu.inactief_op is not null, cu.klant_id into gestopt, klant
      from public.customers cu where cu.id = adres_id;
    select coalesce(sum(v.bedrag), 0), coalesce(sum(v.aantal), 0) into vast_waarde, vast_aantal
      from public.geld_vooruit(bedrijf, array[adres_id]) v where v.soort = 'over_vast';
    if gestopt then
      terug := greatest(0, round(st.vooruit_waarde - st.open, 2));
      stuks := least(st.vooruit_over, 99);
    else
      terug := round(vast_waarde + greatest(0, -st.open), 2);
      stuks := least(vast_aantal, 99);
    end if;
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
     case when soort = 'vooruit' then per_beurt end,
     case when soort = 'vooruit' then begint end,
     case when soort in ('vooruit', 'terugbetaald') then klant end,
     case when soort = 'vooruit' then verwacht end,
     soort = 'terugbetaald' and coalesce(gestopt, false))
  on conflict do nothing;
  get diagnostics nieuw = row_count;

  -- Beurten erbij of eraf: misschien kan een geplande wissel nu door (of
  -- moet een doorgegane terug).
  if nieuw > 0 and soort in ('vooruit', 'terugbetaald', 'ongedaan') then
    perform public.betaalwissels_bijwerken(bedrijf, array[adres_id]);
  end if;

  return jsonb_build_object('status', 'nieuw', 'botsing', botsing is not null,
                            'prijs_afwijkend', verwacht is not null and soort = 'vooruit');
end
$$;

revoke execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) from public, anon;
grant execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) Terug te geven zoals geld_boeken het rekent.
create or replace function public.geld_adres(adres uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  st record;
  vast_waarde numeric;
  gestopt boolean;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres]);
  select coalesce(sum(v.bedrag), 0) into vast_waarde
    from public.geld_vooruit(bedrijf, array[adres]) v where v.soort = 'over_vast';
  select c.inactief_op is not null into gestopt from public.customers c where c.id = adres;
  return jsonb_build_object(
    'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
    'vooruit_over', st.vooruit_over, 'vooruit_waarde', st.vooruit_waarde, 'vooruit_vast', st.vooruit_vast,
    'vooruit_vast_waarde', vast_waarde,
    -- Wat er nu terug moet (zoals geld_boeken het controleert). Gestopt: alle
    -- beurten plus tegoed, min wat er nog open staat. Loopt het adres nog:
    -- de beurten van vorige bewoners plus tegoed.
    'terug', case when gestopt then greatest(0, round(st.vooruit_waarde - st.open, 2))
                  else round(vast_waarde + greatest(0, -st.open), 2) end,
    'vooruit_p', public.vooruit_prijs(adres),
    'wissel', (select case when c.wissel_status is null then null else jsonb_build_object(
                 'status', c.wissel_status, 'vorige', c.wissel_vorige,
                 'gepland_op', c.wissel_gepland_op, 'gepland_naam', c.wissel_gepland_naam,
                 'uitgevoerd_op', c.wissel_uitgevoerd_op, 'periode_tot', c.wissel_periode_tot) end
               from public.customers c where c.id = adres),
    'gebeurtenissen', coalesce((
      select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op desc)
      from public.betaal_gebeurtenissen g
      where g.customer_id = adres and g.company_id = bedrijf and g.soort <> 'ongedaan'
    ), '[]'::jsonb),
    'vaste_kortingen', coalesce((
      select jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag,
                                          'door_naam', vk.gemaakt_naam, 'op', vk.gemaakt_op)
                       order by vk.gemaakt_op)
      from public.vaste_kortingen vk where vk.customer_id = adres and vk.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.geld_adres(uuid) from public, anon;
grant execute on function public.geld_adres(uuid) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) Terug te geven zoals geld_boeken het rekent.
create or replace function public.geld_pof(wijken uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  adressen uuid[];
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  -- Alleen adressen die ooit contant betaalden (of een beginstand hebben).
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c
    join public.streets s on s.id = c.street_id and s.deleted_at is null
    join public.districts d on d.id = s.district_id and d.deleted_at is null
    where c.company_id = bedrijf and c.deleted_at is null
      and (wijken is null or s.district_id = any (wijken))
      and (exists (select 1 from public.contant_periodes p where p.customer_id = c.id)
           or exists (select 1 from public.betaal_gebeurtenissen g where g.customer_id = c.id));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'wijk_id', d.id, 'wijk', d.name, 'straat_id', s.id, 'straat', s.name,
      'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
      'naam', coalesce(k.naam, ''), 'methode', coalesce(c.betaalmethode, d.betaalmethode),
      'gestopt', c.inactief_op is not null,
      'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
      'vooruit_over', st.vooruit_over, 'vooruit_waarde', st.vooruit_waarde, 'vooruit_vast', st.vooruit_vast,
      'vooruit_vast_waarde', coalesce(vw.waarde, 0),
      'terug', case when c.inactief_op is not null then greatest(0, round(st.vooruit_waarde - st.open, 2))
                    else round(coalesce(vw.waarde, 0) + greatest(0, -st.open), 2) end,
      'laatst_betaald', (select max(g.op) from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('betaald', 'vooruit')
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
      'laatste_poging', (select jsonb_build_object('soort', g.soort, 'op', g.op, 'door_naam', g.door_naam)
                         from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('niet_thuis', 'geen_geld')
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                         order by g.op desc limit 1)
    ) order by st.open desc)
    from public.geld_stand(bedrijf, adressen) st
    join public.customers c on c.id = st.customer_id
    join public.streets s on s.id = c.street_id
    join public.districts d on d.id = s.district_id
    left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
    left join (
      select v.customer_id, sum(v.bedrag) as waarde
      from public.geld_vooruit(bedrijf, adressen) v where v.soort = 'over_vast'
      group by v.customer_id
    ) vw on vw.customer_id = c.id
    where abs(st.open) > 0.005 or st.vooruit_vast > 0
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.geld_pof(uuid[]) from public, anon;
grant execute on function public.geld_pof(uuid[]) to authenticated;

-- (was: 20261016091000_vooruit_betalen_herstel.sql) De vlag terug op wat hij was.
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
  oud text := coalesce(current_setting('wooshy.wissel', true), '');
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
  perform set_config('wooshy.wissel', oud, true);
end
$$;

revoke execute on function public.betaalwissel_ongedaan(uuid) from public, anon;
grant execute on function public.betaalwissel_ongedaan(uuid) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql) De bij Dag klaar vastgelegde
-- betaalmethode gaat mee in de momentopname.
create or replace function public.wasdag_weghalen(dag date, adressen uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  weg jsonb;
  kenmerk uuid;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald where company_id = bedrijf and created_at < now() - interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'prijs', wp.prijs,
    'normaal', wp.normaal,
    'ploeg_nr', r.ploeg_nr, 'volgorde', r.volgorde, 'rest', r.rest, 'vaste_start', r.vaste_start,
    'gedaan_op', r.gedaan_op, 'gedaan_door', r.gedaan_door, 'gedaan_bewaard', r.gedaan_bewaard,
    'ronde', r.ronde, 'betaalmethode', r.betaalmethode
  )), '[]'::jsonb)
  into weg
  from public.wasdag_regels r
  left join public.wasdag_prijzen wp on wp.regel_id = r.id
  where r.company_id = bedrijf
    and r.datum = dag
    and (adressen is null or r.customer_id = any(adressen));

  if jsonb_array_length(weg) = 0 then
    return null;
  end if;

  delete from public.wasdag_regels
  where company_id = bedrijf
    and datum = dag
    and (adressen is null or customer_id = any(adressen));

  insert into public.wasdag_weggehaald (company_id, regels) values (bedrijf, weg)
  returning id into kenmerk;
  return kenmerk;
end
$$;

revoke execute on function public.wasdag_weghalen(date, uuid[]) from public, anon;
grant execute on function public.wasdag_weghalen(date, uuid[]) to authenticated;

-- (was: 20261016091000_vooruit_betalen_herstel.sql) Een gedane regel komt
-- terug mét zijn betaalmethode. Zonder die stond hij na een wissel naar
-- overmaken zowel in de contante schuld als (via factuurregels) op een factuur.
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
       gedaan_op, gedaan_door, gedaan_bewaard, ronde, betaalmethode)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time,
           nullif(r ->> 'gedaan_op', '')::timestamptz,
           nullif(r ->> 'gedaan_door', '')::uuid,
           case when jsonb_typeof(r -> 'gedaan_bewaard') = 'object' then r -> 'gedaan_bewaard' end,
           nullif(r ->> 'ronde', ''),
           nullif(r ->> 'betaalmethode', '')
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
