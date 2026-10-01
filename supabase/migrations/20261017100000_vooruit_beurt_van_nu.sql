-- Vooruit betalen: de beurt van nu telt als beurt 1.
--
-- Je loopt na het wassen. Staat de beurt van deze ronde nog open als de
-- klant vooruit betaalt, dan betaalt "4 beurten vooruit" díe beurt plus de
-- volgende drie. Tot nu toe begon een vooruitbetaling bij de óudste open
-- wasbeurt, zodat oude pof (juli, augustus) met vooruit-beurten werd betaald
-- en de beurt van nu pas als derde of vierde aan de beurt kwam.
--
-- Alleen `vanaf` van een nieuwe vooruitbetaling verandert: dat is nu de
-- datum van de beurt van nu (de laatste open wasbeurt, niet al met vooruit
-- betaald, van deze of de vorige maand). Daardoor dekt hij die beurt en
-- alles erna; oudere pof valt ervóór en blijft gewone pof, die met euro's
-- betaald wordt. Staat er geen beurt van nu open (al betaald, of nog niet
-- gewassen), dan blijft het zoals het was: de oudste open wasbeurt, anders
-- de dag na de laatste wasbeurt, anders vandaag.
--
-- Bestaande vooruitbetalingen houden hun eigen `vanaf` en rekenen dus
-- precies als voorheen. Extra werk op de beurt van nu blijft open (de
-- dekking per wasbeurt in geld_vooruit is niet veranderd). Omrekenen houdt
-- de oude regel. De app rekent hetzelfde (vooruitEerst in
-- src/lib/betalingen.ts).
--
-- (was: 20261016098000_omrekenen_eigenaar_en_volgorde.sql)
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
    -- Vanaf welke beurt. Je loopt na het wassen: staat de beurt van nu nog
    -- open (de laatste wasbeurt die open staat, niet al met vooruit betaald,
    -- van deze of vorige maand), dan is dat beurt 1 en blijft oudere pof
    -- gewone pof. Anders de oudste wasbeurt die nog open staat, anders de dag
    -- na de laatste wasbeurt, anders vandaag. De beginstand van de papieren
    -- kaart doet niet mee.
    select x.datum into begint from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' and x.bedrag - x.gedekt > 0.005 and x.vooruit = 0
        and x.datum >= (date_trunc('month', moment at time zone 'Europe/Amsterdam') - interval '1 month')::date
      order by x.datum desc, x.ref desc
      limit 1;
    if begint is null then
      select min(x.datum) into begint from public.geld_posten(bedrijf, array[adres_id]) x
        where x.soort = 'wassen' and x.bedrag - x.gedekt > 0.005 and x.vooruit = 0;
    end if;
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
