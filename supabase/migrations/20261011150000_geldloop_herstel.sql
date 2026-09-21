-- Betalingen: herstelpunten uit de review van fase 5 en 7.
--
-- * Wie geen prijzen mag zien, ziet ook geen prijswijzigingen van geldlopers.
-- * Een verhuisde klant (prullenbak) telt bij het dossier als geen klant: de
--   nieuwe bewoner krijgt een eigen klant.
-- * Meerprijzen moeten echte bedragen zijn; een naam mag niet leeg.
-- * Terugdraaien van "nieuwe klant" zet de klachten van het adres terug, en
--   gooit de klant niet weg als er mail of klachten aan hangen. Terugdraaien
--   van "laten stoppen" zegt het als er niets terug te zetten viel.
-- * Het avondoverzicht vindt dossierwijzigingen per avond, ook na middernacht.
-- * Een wasser ziet en boekt alleen bij adressen van zijn eigen team, en de
--   wasbeurt van vandaag telt alleen mee als hij na de start van de wijk valt.

drop policy "Wijzigingen lezen" on public.geldloop_wijzigingen;
create policy "Wijzigingen lezen" on public.geldloop_wijzigingen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or (vrijgave_id is not null and public.geldloop_loopt_voor_mij(vrijgave_id))
      or ((select public.heeft_recht('klanten_bekijken')) and soort not in ('prijs', 'stoppen'))
    )
  );

create or replace function public.geldloop_dossier_bewaren(adres_id uuid, wijzigingen jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  vrij uuid := public.geldloop_dossier_toegang(adres_id);
  c public.customers;
  voor jsonb;
  na jsonb;
  naam text := public.geld_mijn_naam();
  tekst text := public.geld_adres_tekst(adres_id);
  kl jsonb := wijzigingen -> 'klant';
  nieuwe_klant uuid;
  aantal int := 0;
begin
  select * into c from public.customers
    where id = adres_id and company_id = bedrijf and deleted_at is null;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  -- 1. Het adres: notitie, frequentie en extra werk.
  if wijzigingen ?| array['note', 'interval_maanden', 'ritme', 'maandwerk'] then
    if wijzigingen ? 'interval_maanden'
       and (wijzigingen ->> 'interval_maanden')::int not in (1, 2, 3, 4, 6, 12) then
      raise exception 'Onbekende frequentie.';
    end if;
    if wijzigingen ? 'ritme' and (wijzigingen ->> 'ritme')::int not between 1 and 12 then
      raise exception 'Onbekende maand.';
    end if;
    if wijzigingen ? 'maandwerk' and jsonb_typeof(wijzigingen -> 'maandwerk') <> 'array' then
      raise exception 'Het extra werk klopt niet.';
    end if;
    voor := jsonb_build_object('note', c.note, 'interval_maanden', c.interval_maanden,
                               'ritme', c.ritme, 'maandwerk', c.maandwerk);
    update public.customers set
      note = case when wijzigingen ? 'note' then left(coalesce(wijzigingen ->> 'note', ''), 2000) else note end,
      interval_maanden = case when wijzigingen ? 'interval_maanden'
                              then (wijzigingen ->> 'interval_maanden')::int else interval_maanden end,
      ritme = case when wijzigingen ? 'ritme' then (wijzigingen ->> 'ritme')::int else ritme end,
      maandwerk = case when wijzigingen ? 'maandwerk' then wijzigingen -> 'maandwerk' else maandwerk end
    where id = adres_id
    returning jsonb_build_object('note', note, 'interval_maanden', interval_maanden,
                                 'ritme', ritme, 'maandwerk', maandwerk) into na;
    if voor is distinct from na then
      insert into public.geldloop_wijzigingen (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door, door_naam)
        values (bedrijf, adres_id, vrij, 'adres', voor, na, tekst, auth.uid(), naam);
      aantal := aantal + 1;
    end if;
  end if;

  -- 2. De prijs en wat het extra werk kost.
  if wijzigingen ?| array['prijs', 'maandwerk_extra'] then
    if wijzigingen ? 'prijs'
       and ((wijzigingen ->> 'prijs')::numeric < 0 or (wijzigingen ->> 'prijs')::numeric > 10000) then
      raise exception 'Vul een prijs tussen 0 en 10.000 in.';
    end if;
    if wijzigingen ? 'maandwerk_extra' and (
         jsonb_typeof(wijzigingen -> 'maandwerk_extra') <> 'object'
         or exists (select 1 from jsonb_each(wijzigingen -> 'maandwerk_extra') e
                    where jsonb_typeof(e.value) <> 'number'
                       or (e.value)::numeric < 0 or (e.value)::numeric > 10000)) then
      raise exception 'De meerprijs klopt niet.';
    end if;
    select coalesce((select jsonb_build_object('prijs', ap.prijs, 'maandwerk_extra', ap.maandwerk_extra)
                     from public.adres_prijzen ap where ap.customer_id = adres_id),
                    jsonb_build_object('prijs', 0, 'maandwerk_extra', '{}'::jsonb))
      into voor;
    insert into public.adres_prijzen (customer_id, company_id, prijs, maandwerk_extra)
      values (adres_id, bedrijf,
              coalesce(round((wijzigingen ->> 'prijs')::numeric, 2), (voor ->> 'prijs')::numeric),
              coalesce(wijzigingen -> 'maandwerk_extra', voor -> 'maandwerk_extra'))
      on conflict (customer_id) do update
        set prijs = excluded.prijs, maandwerk_extra = excluded.maandwerk_extra
      returning jsonb_build_object('prijs', prijs, 'maandwerk_extra', maandwerk_extra) into na;
    if voor is distinct from na then
      insert into public.geldloop_wijzigingen (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door, door_naam)
        values (bedrijf, adres_id, vrij, 'prijs', voor, na, tekst, auth.uid(), naam);
      aantal := aantal + 1;
    end if;
  end if;

  -- 3. De klant: gegevens aanvullen, of een nieuwe klant aan het adres.
  if kl is not null and jsonb_typeof(kl) = 'object' then
    if kl ? 'naam' and btrim(coalesce(kl ->> 'naam', '')) = '' then
      raise exception 'Vul een naam in.';
    end if;
    -- Een klant in de prullenbak (verhuisd) telt als geen klant: de nieuwe
    -- bewoner krijgt een eigen klant, en komt niet over de oude heen.
    if c.klant_id is null or not exists (
      select 1 from public.klanten k where k.id = c.klant_id and k.deleted_at is null
    ) then
      if btrim(coalesce(kl ->> 'naam', '')) = '' then
        raise exception 'Vul een naam in.';
      end if;
      insert into public.klanten (company_id, naam, telefoon, telefoon2, email, email2)
        values (bedrijf, left(btrim(kl ->> 'naam'), 200),
                left(btrim(coalesce(kl ->> 'telefoon', '')), 40), left(btrim(coalesce(kl ->> 'telefoon2', '')), 40),
                left(lower(btrim(coalesce(kl ->> 'email', ''))), 200), left(lower(btrim(coalesce(kl ->> 'email2', ''))), 200))
        returning id into nieuwe_klant;
      update public.customers set klant_id = nieuwe_klant where id = adres_id;
      insert into public.geldloop_wijzigingen (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door, door_naam)
        values (bedrijf, adres_id, vrij, 'klant_nieuw', '{}'::jsonb,
                jsonb_build_object('klant_id', nieuwe_klant, 'naam', kl ->> 'naam'), tekst, auth.uid(), naam);
      aantal := aantal + 1;
    else
      select jsonb_build_object('naam', coalesce(k.naam, ''), 'telefoon', coalesce(k.telefoon, ''),
                                'telefoon2', coalesce(k.telefoon2, ''), 'email', coalesce(k.email, ''),
                                'email2', coalesce(k.email2, ''))
        into voor from public.klanten k where k.id = c.klant_id;
      update public.klanten k set
        naam = case when kl ? 'naam' then left(btrim(kl ->> 'naam'), 200) else k.naam end,
        telefoon = case when kl ? 'telefoon' then left(btrim(kl ->> 'telefoon'), 40) else k.telefoon end,
        telefoon2 = case when kl ? 'telefoon2' then left(btrim(kl ->> 'telefoon2'), 40) else k.telefoon2 end,
        email = case when kl ? 'email' then left(lower(btrim(kl ->> 'email')), 200) else k.email end,
        email2 = case when kl ? 'email2' then left(lower(btrim(kl ->> 'email2')), 200) else k.email2 end
      where k.id = c.klant_id
      returning jsonb_build_object('naam', coalesce(k.naam, ''), 'telefoon', coalesce(k.telefoon, ''),
                                   'telefoon2', coalesce(k.telefoon2, ''), 'email', coalesce(k.email, ''),
                                   'email2', coalesce(k.email2, '')) into na;
      if voor is distinct from na then
        insert into public.geldloop_wijzigingen (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door, door_naam)
          values (bedrijf, adres_id, vrij, 'klant', voor || jsonb_build_object('klant_id', c.klant_id),
                  na || jsonb_build_object('klant_id', c.klant_id), tekst, auth.uid(), naam);
        aantal := aantal + 1;
      end if;
    end if;
  end if;

  return jsonb_build_object('wijzigingen', aantal);
end
$$;

create or replace function public.geldloop_wijziging_terugdraaien(wijziging uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  w public.geldloop_wijzigingen;
  nu jsonb;
begin
  select * into w from public.geldloop_wijzigingen where id = wijziging and company_id = bedrijf for update;
  if not found then
    raise exception 'Die wijziging bestaat niet.';
  end if;
  if w.teruggedraaid_op is not null then
    raise exception 'Deze wijziging is al teruggedraaid.';
  end if;
  if not public.is_eigenaar() and not (
    w.door = auth.uid() and w.vrijgave_id is not null and public.geldloop_loopt_voor_mij(w.vrijgave_id)
  ) then
    raise exception 'Na de eindtijd kan alleen de eigenaar dit nog terugdraaien.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  if w.soort = 'adres' then
    select jsonb_build_object('note', c.note, 'interval_maanden', c.interval_maanden,
                              'ritme', c.ritme, 'maandwerk', public.maandwerk_kern(c.maandwerk))
      into nu from public.customers c where c.id = w.customer_id;
    if nu is distinct from (w.na || jsonb_build_object('maandwerk', public.maandwerk_kern(w.na -> 'maandwerk'))) then
      raise exception 'Dit adres is intussen opnieuw gewijzigd; pas het in het dossier zelf aan.';
    end if;
    update public.customers set
      note = w.voor ->> 'note',
      interval_maanden = (w.voor ->> 'interval_maanden')::int,
      ritme = (w.voor ->> 'ritme')::int,
      maandwerk = w.voor -> 'maandwerk'
    where id = w.customer_id;
  elsif w.soort = 'prijs' then
    select jsonb_build_object('prijs', ap.prijs, 'maandwerk_extra', ap.maandwerk_extra)
      into nu from public.adres_prijzen ap where ap.customer_id = w.customer_id;
    if nu is distinct from w.na then
      raise exception 'De prijs is intussen opnieuw gewijzigd; pas hem in het dossier zelf aan.';
    end if;
    update public.adres_prijzen set
      prijs = (w.voor ->> 'prijs')::numeric,
      maandwerk_extra = w.voor -> 'maandwerk_extra'
    where customer_id = w.customer_id;
  elsif w.soort = 'klant' then
    select jsonb_build_object('naam', coalesce(k.naam, ''), 'telefoon', coalesce(k.telefoon, ''),
                              'telefoon2', coalesce(k.telefoon2, ''), 'email', coalesce(k.email, ''),
                              'email2', coalesce(k.email2, ''), 'klant_id', k.id)
      into nu from public.klanten k where k.id = (w.na ->> 'klant_id')::uuid;
    if nu is distinct from w.na then
      raise exception 'De klantgegevens zijn intussen opnieuw gewijzigd; pas ze in het dossier zelf aan.';
    end if;
    update public.klanten set
      naam = w.voor ->> 'naam', telefoon = w.voor ->> 'telefoon', telefoon2 = w.voor ->> 'telefoon2',
      email = w.voor ->> 'email', email2 = w.voor ->> 'email2'
    where id = (w.voor ->> 'klant_id')::uuid;
  elsif w.soort = 'klant_nieuw' then
    update public.customers set klant_id = null
      where id = w.customer_id and klant_id = (w.na ->> 'klant_id')::uuid;
    -- Klachten van dit adres die intussen aan de nieuwe klant hingen, gaan
    -- terug naar alleen het adres.
    update public.klachten set klant_id = null
      where customer_id = w.customer_id and klant_id = (w.na ->> 'klant_id')::uuid;
    update public.klanten set deleted_at = now()
      where id = (w.na ->> 'klant_id')::uuid and deleted_at is null
        and not exists (select 1 from public.customers c where c.klant_id = klanten.id)
        and not exists (select 1 from public.klachten k where k.klant_id = klanten.id)
        and not exists (select 1 from public.berichten b where b.klant_id = klanten.id);
  elsif w.soort = 'stoppen' then
    if public.stoppen_terugdraaien(w.na) = 0 then
      raise exception 'Dit adres is intussen opnieuw gewijzigd; zet het in het dossier zelf weer actief.';
    end if;
  end if;

  update public.geldloop_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(), teruggedraaid_naam = public.geld_mijn_naam()
    where id = wijziging;
end
$$;

create or replace function public.geldloop_wijzigingen_van(adres_id uuid default null, datum date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  begin_dag timestamptz := (datum::timestamp) at time zone 'Europe/Amsterdam';
  prijzen boolean := public.heeft_recht('prijzen_zien');
begin
  if bedrijf is null or not (prijzen or public.heeft_recht('klanten_bekijken')) then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'customer_id', w.customer_id, 'soort', w.soort, 'voor', w.voor, 'na', w.na,
      'adres', w.adres, 'door', w.door, 'door_naam', w.door_naam, 'op', w.op,
      'teruggedraaid_op', w.teruggedraaid_op, 'teruggedraaid_naam', w.teruggedraaid_naam
    ) order by w.op desc)
    from public.geldloop_wijzigingen w
    where w.company_id = bedrijf
      and (adres_id is null or w.customer_id = adres_id)
      -- Wie geen prijzen ziet, ziet ook geen prijswijzigingen (en geen stopzetting,
      -- waar de dagprijzen in kunnen staan).
      and (prijzen or w.soort not in ('prijs', 'stoppen'))
      -- Per avond: wat bij die avond hoort (ook na middernacht); zonder avond
      -- op de kalenderdag.
      and (datum is null
           or (w.vrijgave_id is not null
               and exists (select 1 from public.geldloop_vrijgaven v where v.id = w.vrijgave_id and v.datum = datum))
           or (w.vrijgave_id is null and w.op >= begin_dag and w.op < begin_dag + interval '1 day'))
  ), '[]'::jsonb);
end
$$;

create or replace function public.dag_geld_toegang(adres_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.heeft_recht('planning')
    and exists (
      select 1 from public.wasdag_regels r
      where r.customer_id = adres_id and r.company_id = public.current_company_id()
        and r.datum = (now() at time zone 'Europe/Amsterdam')::date
        -- Staat het adres in een team, dan alleen voor dat team (en de eigenaar).
        and (r.ploeg_nr is null or public.is_eigenaar() or exists (
          select 1 from public.dag_ploeg_leden l
          join public.teamleden t on t.id = l.teamlid_id
          where l.company_id = r.company_id and l.datum = r.datum and l.nr = r.ploeg_nr
            and t.employee_id = auth.uid()
        ))
    )
    and exists (
      select 1 from public.customers c
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      where c.id = adres_id and coalesce(c.betaalmethode, d.betaalmethode) = 'contant'
        and d.geld_peildatum is not null
    )
$$;

create or replace function public.dag_geld_stand(adres_id uuid)
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
  vandaag_prijs numeric;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.dag_geld_toegang(adres_id) then
    return null;
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres_id]);
  select wp.prijs into vandaag_prijs
    from public.wasdag_regels r join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.customer_id = adres_id and r.datum = vandaag and r.gedaan_op is null
      -- Alleen als hij straks ook echt meetelt (na de start van de wijk).
      and exists (select 1 from public.contant_periodes p
                  where p.customer_id = adres_id and vandaag >= p.vanaf and (p.tot is null or vandaag <= p.tot));
  return jsonb_build_object(
    'open', st.open + coalesce(vandaag_prijs, 0),
    'open_wassen', st.open_wassen + case when coalesce(vandaag_prijs, 0) > 0 then 1 else 0 end,
    'delen', st.delen || case when coalesce(vandaag_prijs, 0) > 0
                              then jsonb_build_array(jsonb_build_object(
                                'soort', 'wassen', 'datum', vandaag, 'bedrag', vandaag_prijs,
                                'rest', vandaag_prijs, 'aantal', 1, 'omschrijving', ''))
                              else '[]'::jsonb end,
    'vandaag', (select jsonb_build_object('id', g.id, 'bedrag', g.bedrag, 'door', g.door,
                                          'door_naam', g.door_naam, 'op', g.op)
                from public.betaal_gebeurtenissen g
                where g.customer_id = adres_id and g.bron = 'dag' and g.soort = 'betaald'
                  and (g.op at time zone 'Europe/Amsterdam')::date = vandaag
                  and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                order by g.op desc limit 1)
  );
end
$$;
