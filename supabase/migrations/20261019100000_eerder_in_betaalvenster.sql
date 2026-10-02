-- "Eerder" in het betaalvenster.
--
-- Tijdens het geldlopen (en op kantoor bij Afrekenen, de wijklijst en de dag)
-- zie je bij een adres niet alleen wat er vanavond gebeurde, maar ook alle
-- boekingen van eerder: wanneer, wat, en wie het intikte. Klopt er iets niet,
-- dan draait de eigenaar (of wie mag afrekenen) het terug, en tikt het daarna
-- gewoon goed in. Niets wordt gewist: terugdraaien is een nieuwe regel
-- (soort 'ongedaan') in het logboek, met wie het deed.
--
-- Wat niet terug kan met "Klopt niet": een 'ongedaan' zelf, de beginstand en
-- een 1 van de papieren kaart (die zet je op de Wijkkaart), en voor wie geen
-- eigenaar is ook teruggeven en omrekenen (die blijven bij de eigenaar).
--
-- Alleen toevoegen en vervangen; er verandert niets aan bestaande gegevens.

-- ---------------------------------------------------------------------
-- 1. De boekingen van één adres
-- ---------------------------------------------------------------------
-- Voor iedereen die het betaalvenster van dit adres mag openen: wie bedragen
-- mag zien (de eigenaar, en dus ook wie mag afrekenen), of een geldloper voor
-- wie dit adres nu in een lopende vrijgave valt (geldloop_toegang, zoals in
-- geldloop_lijst). Een geldloper ziet aan de deur ook bedragen; hier dus ook.
-- Alleen wat het venster nodig heeft: geen ids van mensen, geen klant.
-- Standaard het laatste jaar; 'ouder' zegt hoeveel er nog voor ligt.
create or replace function public.geld_eerder(adres_id uuid, alles boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  grens timestamptz := case when alles then '-infinity'::timestamptz else now() - interval '1 year' end;
begin
  if bedrijf is null then
    raise exception 'Je bent niet ingelogd.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres_id and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if not (public.heeft_recht('prijzen_zien') or public.geldloop_toegang(adres_id)) then
    raise exception 'Je mag de betalingen van dit adres nu niet zien.';
  end if;

  return jsonb_build_object(
    'ouder', (select count(*) from public.betaal_gebeurtenissen g
              where g.customer_id = adres_id and g.company_id = bedrijf
                and g.soort <> 'ongedaan' and g.op < grens),
    'boekingen', coalesce((
      with v as (select * from public.geld_vooruit(bedrijf, array[adres_id]))
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'reden', g.reden, 'aantal', g.aantal,
        'prijs_per_beurt', g.prijs_per_beurt, 'bron', g.bron, 'door_naam', g.door_naam, 'op', g.op,
        'ongedaan', (select jsonb_build_object('door_naam', o.door_naam, 'op', o.op)
                     from public.betaal_gebeurtenissen o
                     where o.herroept_id = g.id and o.company_id = bedrijf
                     order by o.op limit 1),
        -- Voor de bevestigvraag bij vooruit, en de tekst bij omgerekend
        -- (zoals geld_gebeurtenis_json).
        'gebruikt', case when g.soort = 'vooruit' then
          (select count(*) from v where v.soort = 'dekking' and v.vooruit_id = g.id) end,
        'omgerekend_van', case when g.soort = 'omgerekend' then
          (select coalesce(sum(v.aantal), 0) from v where v.soort = 'omgerekend' and v.ref = g.id) end
      ) order by g.op desc, g.id desc)
      from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.company_id = bedrijf
        and g.soort <> 'ongedaan' and g.op >= grens
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.geld_eerder(uuid, boolean) from public, anon;
grant execute on function public.geld_eerder(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Boeken: wie mag afrekenen, draait ook iets van vroeger terug
-- ---------------------------------------------------------------------
-- (was: 20261019090000_afrekenen_zonder_vrijgave.sql; nieuw is alleen het
-- stuk bij 'ongedaan')
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
      -- Met het recht "afrekenen" mag het ook, behalve geld teruggeven en
      -- omrekenen: die blijven bij de eigenaar.
      if not public.mag_afrekenen() then
        raise exception 'Alleen de eigenaar (of wie mag afrekenen) kan op kantoor betalingen boeken.';
      end if;
      if soort = 'terugbetaald' then
        raise exception 'Teruggeven legt de eigenaar vast, op kantoor.';
      end if;
      if soort = 'omgerekend' then
        raise exception 'Omrekenen naar een nieuwe prijs doet de eigenaar, op kantoor.';
      end if;
      -- Altijd nu: een boeking op een eerdere dag blijft bij de eigenaar.
      -- (Iets van vroeger terugdraaien mag wel; dat krijgt ook "nu".)
      moment := now();
      -- Korting tot wat er openstaat; korting die tegoed wordt, geeft de eigenaar.
      if soort = 'korting' then
        select * into st from public.geld_stand(bedrijf, array[adres_id]);
        if schoon > greatest(st.open, 0) + 0.005 then
          raise exception 'Korting boven wat er openstaat (€ %) geeft de eigenaar.',
            replace(to_char(greatest(st.open, 0), 'FM9999990.00'), '.', ',');
        end if;
      end if;
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
        raise exception 'Dit adres heeft geen prijs; vooruit betalen boekt dan de eigenaar.';
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
    -- Vanaf welke beurt: zie geld_vooruit_vanaf (de app laat dezelfde datum zien).
    select x.vanaf into begint from public.geld_vooruit_vanaf(bedrijf, array[adres_id], moment) x;
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
        -- Wie mag afrekenen: zijn eigen kantoorboeking, op dezelfde dag (de
        -- bron 'kantoor' is hierboven al op het recht gecontroleerd).
        or (oud.bron = 'kantoor' and geld_boeken.bron = 'kantoor'
            and (oud.op at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date)
      )
    ) then
      -- Nieuw: wie mag afrekenen, draait op kantoor ook een boeking van
      -- vroeger of van een ander terug ("Klopt niet" in het betaalvenster).
      -- Behalve een 1 van de papieren kaart (die hoort bij de Wijkkaart) en
      -- teruggeven of omrekenen (die blijven bij de eigenaar).
      if geld_boeken.bron <> 'kantoor' or not public.mag_afrekenen() then
        raise exception 'Na de eindtijd kan alleen de eigenaar (of wie mag afrekenen) dit nog herstellen.';
      end if;
      if oud.bron = 'kaart' then
        raise exception 'Dit komt van de papieren kaart; dat verander je op de Wijkkaart.';
      end if;
      if oud.soort in ('terugbetaald', 'omgerekend') then
        raise exception 'Teruggeven en omrekenen draait alleen de eigenaar terug.';
      end if;
    end if;
    -- Nieuw: een vooruitbetaling waar daarna nog iets van teruggegeven of
    -- omgerekend is, draait alleen de eigenaar terug (ook als het je eigen
    -- boeking was): anders hangt dat van de eigenaar ineens in de lucht.
    if not eigenaar and oud.soort = 'vooruit' and exists (
      select 1 from public.betaal_gebeurtenissen t
      where t.customer_id = adres_id and t.company_id = bedrijf
        and t.soort in ('terugbetaald', 'omgerekend') and t.op >= oud.op
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = t.id)
    ) then
      raise exception 'Hier is daarna nog iets van teruggegeven of omgerekend; dit draait de eigenaar terug.';
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
