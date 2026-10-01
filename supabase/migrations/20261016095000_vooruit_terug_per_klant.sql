-- Contant vooruitbetalen: terug te geven per klant.
--
-- De ongebruikte vooruit-beurten van een adres zijn van twee soorten: van
-- een vorige bewoner (de vooruit-rij hoort bij een andere klant dan de
-- huidige), en van de huidige (of laatste) klant zelf. Wat er terug moet:
--   * de beurten van vorige bewoners altijd helemaal: wat de huidige klant
--     nog open heeft, gaat niet van het geld van een ander af;
--   * bij een gestopt adres daarbij de eigen beurten plus tegoed, min wat de
--     laatste klant nog open heeft (nooit onder nul);
--   * bij een adres dat nog loopt niets meer: tegoed blijft op het adres
--     staan en gaat van de volgende beurt af (het kan van de nieuwe bewoner
--     zijn).
-- Het afsluiten bij "terugbetaald" (geld_vooruit) past hier al bij: bij een
-- lopend adres alleen de beurten van andere klanten, bij een gestopt adres
-- alle. Wat de laatste klant daarna nog open heeft, blijft open staan.

-- Oude regels "terugbetaald" sloten alle beurten af (zo rekende het toen).
-- Er zijn er nog geen; voor de volledigheid.
update public.betaal_gebeurtenissen
  set alle_beurten = true
  where soort = 'terugbetaald' and not alle_beurten;

-- ---------------------------------------------------------------------
-- 1. De ongebruikte beurten per adres, gesplitst naar klant
-- ---------------------------------------------------------------------
create or replace function public.geld_vooruit_klanten(bedrijf uuid, adressen uuid[])
returns table (customer_id uuid, vorige int, vorige_waarde numeric, eigen int, eigen_waarde numeric)
language sql
stable
security definer
set search_path = public
as $$
  select v.customer_id,
    coalesce(sum(v.aantal) filter (where x.vorige), 0)::int,
    coalesce(sum(v.bedrag) filter (where x.vorige), 0),
    coalesce(sum(v.aantal) filter (where not x.vorige), 0)::int,
    coalesce(sum(v.bedrag) filter (where not x.vorige), 0)
  from public.geld_vooruit(bedrijf, adressen) v
  join public.betaal_gebeurtenissen g on g.id = v.vooruit_id
  join public.customers c on c.id = v.customer_id
  cross join lateral (
    select g.klant_id is not null and g.klant_id is distinct from c.klant_id as vorige
  ) x
  where v.soort in ('over', 'over_vast')
  group by v.customer_id
$$;
revoke execute on function public.geld_vooruit_klanten(uuid, uuid[]) from public, anon, authenticated;

-- Wat er terug moet (zie boven). `open` is wat er nu open staat (negatief =
-- tegoed).
create or replace function public.vooruit_terug(gestopt boolean, vorige numeric, eigen numeric, open numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select round(coalesce(vorige, 0)
               + case when gestopt then greatest(0, coalesce(eigen, 0) - coalesce(open, 0)) else 0 end, 2)
$$;
revoke execute on function public.vooruit_terug(boolean, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. De functies
-- ---------------------------------------------------------------------
-- (was: 20261016094000_vooruit_eindreview.sql) Terug zoals vooruit_terug het rekent.
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

-- (was: 20261016094000_vooruit_eindreview.sql)
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
  k record;
  gestopt boolean;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres]);
  select x.vorige, x.vorige_waarde, x.eigen, x.eigen_waarde into k
    from public.geld_vooruit_klanten(bedrijf, array[adres]) x;
  select c.inactief_op is not null into gestopt from public.customers c where c.id = adres;
  return jsonb_build_object(
    'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
    'vooruit_over', st.vooruit_over, 'vooruit_waarde', st.vooruit_waarde, 'vooruit_vast', st.vooruit_vast,
    -- De ongebruikte beurten: van vorige bewoners, en van de huidige klant.
    'vooruit_vorige', coalesce(k.vorige, 0), 'vooruit_vorige_waarde', coalesce(k.vorige_waarde, 0),
    'vooruit_eigen', coalesce(k.eigen, 0), 'vooruit_eigen_waarde', coalesce(k.eigen_waarde, 0),
    -- Wat er nu terug moet, zoals geld_boeken het controleert.
    'terug', public.vooruit_terug(gestopt, k.vorige_waarde, k.eigen_waarde, st.open),
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

-- (was: 20261016094000_vooruit_eindreview.sql)
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
      'vooruit_vorige', coalesce(vk.vorige, 0), 'vooruit_vorige_waarde', coalesce(vk.vorige_waarde, 0),
      'vooruit_eigen', coalesce(vk.eigen, 0), 'vooruit_eigen_waarde', coalesce(vk.eigen_waarde, 0),
      'terug', public.vooruit_terug(c.inactief_op is not null, vk.vorige_waarde, vk.eigen_waarde, st.open),
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
    left join public.geld_vooruit_klanten(bedrijf, adressen) vk on vk.customer_id = c.id
    where abs(st.open) > 0.005 or st.vooruit_vast > 0
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.geld_pof(uuid[]) from public, anon;
grant execute on function public.geld_pof(uuid[]) to authenticated;

-- (was: 20261016093000_vooruit_vast_in_lijsten.sql) Met de waarde van de
-- beurten van vorige bewoners en van de huidige klant, voor de waarschuwing
-- bij het stoppen aan de deur.
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

  select array_agg(c.id) into ids
    from public.customers c
    join public.streets s on s.id = c.street_id
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null;

  return (
    with basis as (
      select
        c.id, c.house_number, c.addition, c.sort_order, c.hoek_kant, c.note,
        c.interval_maanden, c.ritme, c.inactief_op, c.betaalmethode, c.klant_id,
        s.id as straat_id, s.name as straat, s.sort_order as straat_sort,
        s.sort_desc, s.doorlopend,
        d.id as wijk_id, d.name as wijk, d.sort_order as wijk_sort, d.betaalmethode as wijk_methode,
        k.naam as klantnaam,
        st.open, st.open_wassen, st.delen, st.vooruit_over, st.vooruit_waarde, st.vooruit_vast,
        public.vooruit_prijs(c.id) as vooruit_p,
        coalesce(vk.vorige_waarde, 0) as vooruit_vorige_waarde,
        coalesce(vk.eigen_waarde, 0) as vooruit_eigen_waarde,
        (select coalesce(array_agg(sl.employee_id order by sl.employee_id), '{}')
           from public.geldloop_straat_lopers sl
          where sl.vrijgave_id = v.id and sl.street_id = s.id) as lopers,
        -- Staat er deze maand nog een beurt te doen? Dan is dit adres nog niet
        -- aan de beurt om op te halen. Een beurt die als niet gewassen is
        -- gemeld telt hier niet mee: die is afgehandeld, en de geldloper moet
        -- er wél kunnen blijven staan voor de pof van eerder.
        exists (select 1 from public.wasdag_regels wr
                 where wr.customer_id = c.id and wr.company_id = bedrijf
                   and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
                   and wr.gedaan_op is null
                   and wr.niet_gewassen_op is null) as wacht,
        (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                   'door', g.door, 'door_naam', g.door_naam, 'aantal', g.aantal)
           from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.vrijgave_id = v.id
            and g.soort in ('betaald', 'vooruit', 'niet_thuis', 'geen_geld')
            and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
          order by g.op desc limit 1) as vanavond
      from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
      join public.customers c on c.id = st.customer_id
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
      left join public.geld_vooruit_klanten(bedrijf, coalesce(ids, '{}')) vk on vk.customer_id = c.id
      where c.inactief_op is null or st.open <> 0
    ),
    geteld as (
      select
        (b.vanavond is not null) as gedaan,
        (b.open > 0.005 and b.vanavond is null and not b.wacht) as nog_open,
        (coalesce(cardinality(b.lopers), 0) = 0 or auth.uid() = any (b.lopers)) as van_mij,
        b.straat_id
      from basis b
    )
    select jsonb_build_object(
      'vrijgave', jsonb_build_object('id', v.id, 'datum', v.datum, 'begin_op', v.begin_op,
                                     'eind_op', v.eind_op, 'ingetrokken', v.ingetrokken_op is not null),
      'adressen', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'wijk_id', b.wijk_id, 'wijk', b.wijk, 'wijk_sort', b.wijk_sort,
          'straat_id', b.straat_id, 'straat', b.straat, 'straat_sort', b.straat_sort,
          'sort_desc', b.sort_desc, 'doorlopend', b.doorlopend,
          'house_number', b.house_number, 'addition', coalesce(b.addition, ''),
          'sort_order', b.sort_order, 'hoek_kant', coalesce(b.hoek_kant, ''),
          'naam', coalesce(b.klantnaam, ''),
          'note', coalesce(b.note, ''),
          'interval_maanden', b.interval_maanden, 'ritme', b.ritme,
          'methode', coalesce(b.betaalmethode, b.wijk_methode),
          'gestopt', b.inactief_op is not null,
          'wacht_op_wasbeurt', b.wacht,
          'open', b.open, 'open_wassen', b.open_wassen, 'delen', b.delen,
          'vooruit_over', b.vooruit_over, 'vooruit_waarde', b.vooruit_waarde, 'vooruit_vast', b.vooruit_vast,
          'vooruit_p', b.vooruit_p,
          'vooruit_vorige_waarde', b.vooruit_vorige_waarde, 'vooruit_eigen_waarde', b.vooruit_eigen_waarde,
          'straat_lopers', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                            from public.employees e where e.id = any (b.lopers)),
          'klachten', (select coalesce(jsonb_agg(kl.omschrijving order by kl.ontvangen_op desc), '[]')
                       from public.klachten kl
                       where kl.deleted_at is null and kl.status = 'open'
                         and ((kl.customer_id = b.id and kl.klant_id is not distinct from b.klant_id)
                              or (kl.customer_id is null and kl.klant_id = b.klant_id))),
          'vaste_kortingen', (select coalesce(jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag)
                                                        order by vk.gemaakt_op), '[]')
                              from public.vaste_kortingen vk where vk.customer_id = b.id and vk.deleted_at is null),
          'kortingen_vanavond', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id', g.id, 'bedrag', g.bedrag, 'reden', g.reden,
                                     'door', g.door, 'door_naam', g.door_naam, 'op', g.op) order by g.op), '[]')
                                 from public.betaal_gebeurtenissen g
                                 where g.customer_id = b.id and g.vrijgave_id = v.id and g.soort = 'korting'
                                   and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
          'vanavond', b.vanavond
        ))
        from basis b
      ), '[]'::jsonb),
      'opgehaald', (select jsonb_build_object(
                      'mij', coalesce(sum(g.bedrag) filter (where g.door = auth.uid()), 0),
                      'mij_aantal', count(*) filter (where g.door = auth.uid()),
                      -- Wat het team samen ophaalde is voor de eigenaar; een
                      -- loper ziet alleen zijn eigen tas. Het weglaten aan deze
                      -- kant scheelt dat het meereist naar een telefoon die het
                      -- niet hoort te weten.
                      'totaal', case when public.is_eigenaar()
                                     then coalesce(sum(g.bedrag), 0) else 0 end)
                    from public.betaal_gebeurtenissen g
                    where g.vrijgave_id = v.id and g.soort in ('betaald', 'vooruit')
                      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id))
                   || (select jsonb_build_object(
                        'mijn_open', count(*) filter (where t.nog_open and t.van_mij),
                        'mijn_gedaan', count(*) filter (where t.gedaan and t.van_mij),
                        'mijn_straten_open', count(distinct t.straat_id) filter (where t.nog_open and t.van_mij),
                        'samen_open', count(*) filter (where t.nog_open),
                        'samen_gedaan', count(*) filter (where t.gedaan),
                        'samen_straten_open', count(distinct t.straat_id) filter (where t.nog_open))
                      from geteld t)
    )
  );
end
$$;

revoke execute on function public.geldloop_lijst(uuid) from public, anon;
grant execute on function public.geldloop_lijst(uuid) to authenticated;
