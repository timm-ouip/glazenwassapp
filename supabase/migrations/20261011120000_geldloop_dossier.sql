-- Betalingen, fase 5: het dossier voor de geldloper.
--
-- Tijdens een vrijgegeven avond, en alleen voor adressen in die wijk, mag de
-- geldloper het dossier bijwerken: notitie en extra werk, prijs en
-- frequentie, naam/telefoon/mail van de klant, en een klant laten stoppen.
-- Dat gaat via de functies hieronder (de gewone tabellen blijven voor hem
-- dicht). Elke wijziging komt met voor en na in geldloop_wijzigingen, zodat
-- de eigenaar hem in het avondoverzicht ziet en ongedaan kan maken.

create table public.geldloop_wijzigingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null,
  vrijgave_id uuid references public.geldloop_vrijgaven (id) on delete set null,
  soort text not null check (soort in ('adres', 'prijs', 'klant', 'klant_nieuw', 'stoppen')),
  voor jsonb not null default '{}'::jsonb,
  na jsonb not null default '{}'::jsonb,
  adres text not null default '',
  door uuid default auth.uid(),
  door_naam text not null default '',
  op timestamptz not null default now(),
  teruggedraaid_op timestamptz,
  teruggedraaid_door uuid,
  teruggedraaid_naam text,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create index geldloop_wijzigingen_adres on public.geldloop_wijzigingen (customer_id, op);
create index geldloop_wijzigingen_bedrijf on public.geldloop_wijzigingen (company_id, op);
create trigger geldloop_wijzigingen_set_company_id before insert on public.geldloop_wijzigingen
  for each row execute function public.set_company_id();

alter table public.geldloop_wijzigingen enable row level security;
revoke all on public.geldloop_wijzigingen from anon;
create policy "Wijzigingen lezen" on public.geldloop_wijzigingen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or (select public.heeft_recht('klanten_bekijken'))
      or (vrijgave_id is not null and public.geldloop_loopt_voor_mij(vrijgave_id))
    )
  );

-- De bewaker op adressen laat de geldloopfuncties door (vlag wooshy.geldloop).
-- Verder gelijk aan de versie uit betalingen_fundament.
create or replace function public.adres_wijziging_controleren()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_company_id() is null
     or coalesce(current_setting('wooshy.geldloop', true), '') = '1' then
    return new;
  end if;
  if (new.deleted_at, new.inactief_op, new.inactief_reden, new.klant_id, new.house_number, new.addition, new.betaalmethode)
     is distinct from
     (old.deleted_at, old.inactief_op, old.inactief_reden, old.klant_id, old.house_number, old.addition, old.betaalmethode)
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen, van klant wisselen of de betaalmethode veranderen.';
  end if;
  return new;
end
$$;

-- Mag de ingelogde gebruiker dit dossier nu bijwerken? De eigenaar altijd;
-- een geldloper alleen tijdens zijn avond. Geeft de avond terug (of null).
create or replace function public.geldloop_dossier_toegang(adres_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  vrij uuid := public.geldloop_vrijgave_voor(adres_id, now());
begin
  if vrij is null and not public.is_eigenaar() then
    raise exception 'Je mag dit dossier nu niet bijwerken: de wijk is niet (meer) voor je vrijgegeven.';
  end if;
  return vrij;
end
$$;
revoke execute on function public.geldloop_dossier_toegang(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lezen
-- ---------------------------------------------------------------------
create or replace function public.geldloop_dossier(adres_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  c record;
begin
  perform public.geldloop_dossier_toegang(adres_id);
  select cu.*, s.name as straat into c
    from public.customers cu join public.streets s on s.id = cu.street_id
    where cu.id = adres_id and cu.company_id = bedrijf and cu.deleted_at is null;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  return jsonb_build_object(
    'adres', jsonb_build_object(
      'id', c.id, 'straat', c.straat, 'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
      'note', coalesce(c.note, ''), 'interval_maanden', c.interval_maanden, 'ritme', c.ritme,
      'maandwerk', coalesce(c.maandwerk, '[]'::jsonb),
      'inactief_op', c.inactief_op, 'inactief_reden', c.inactief_reden,
      'prijs', coalesce((select ap.prijs from public.adres_prijzen ap where ap.customer_id = c.id), 0),
      'maandwerk_extra', coalesce((select ap.maandwerk_extra from public.adres_prijzen ap where ap.customer_id = c.id), '{}'::jsonb)
    ),
    'klant', (select jsonb_build_object(
                'id', k.id, 'naam', coalesce(k.naam, ''), 'telefoon', coalesce(k.telefoon, ''),
                'telefoon2', coalesce(k.telefoon2, ''), 'email', coalesce(k.email, ''),
                'email2', coalesce(k.email2, ''))
              from public.klanten k where k.id = c.klant_id and k.deleted_at is null)
  );
end
$$;

-- ---------------------------------------------------------------------
-- Bijwerken
-- ---------------------------------------------------------------------
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
    if wijzigingen ? 'maandwerk_extra' and jsonb_typeof(wijzigingen -> 'maandwerk_extra') <> 'object' then
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
    if c.klant_id is null then
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

-- Een klant laten stoppen, zoals op kantoor (verhuisd of gestopt).
create or replace function public.geldloop_stoppen(adres_id uuid, reden text, planning_weg boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vrij uuid := public.geldloop_dossier_toegang(adres_id);
  uitkomst jsonb;
begin
  if not exists (select 1 from public.customers c
                 where c.id = adres_id and c.company_id = bedrijf and c.deleted_at is null
                   and c.inactief_op is null) then
    raise exception 'Dit adres is al gestopt.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);
  uitkomst := public.zet_adressen_inactief(array[adres_id], reden, planning_weg);
  insert into public.geldloop_wijzigingen (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door, door_naam)
    values (bedrijf, adres_id, vrij, 'stoppen', '{}'::jsonb, uitkomst || jsonb_build_object('reden', reden),
            public.geld_adres_tekst(adres_id), auth.uid(), public.geld_mijn_naam());
  return uitkomst;
end
$$;

-- ---------------------------------------------------------------------
-- Terugdraaien
-- ---------------------------------------------------------------------
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
                              'ritme', c.ritme, 'maandwerk', c.maandwerk)
      into nu from public.customers c where c.id = w.customer_id;
    if nu is distinct from w.na then
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
    update public.klanten set deleted_at = now()
      where id = (w.na ->> 'klant_id')::uuid and deleted_at is null
        and not exists (select 1 from public.customers c where c.klant_id = klanten.id);
  elsif w.soort = 'stoppen' then
    perform public.stoppen_terugdraaien(w.na);
  end if;

  update public.geldloop_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(), teruggedraaid_naam = public.geld_mijn_naam()
    where id = wijziging;
end
$$;

-- De wijzigingen van geldlopers bij één adres (voor het gele vak in het
-- dossier), of van één avond (voor het avondoverzicht).
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
begin
  if bedrijf is null or not (public.heeft_recht('prijzen_zien') or public.heeft_recht('klanten_bekijken')) then
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
      and (datum is null or (w.op >= begin_dag and w.op < begin_dag + interval '1 day'))
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.geldloop_dossier(uuid) from public, anon;
grant execute on function public.geldloop_dossier(uuid) to authenticated;
revoke execute on function public.geldloop_dossier_bewaren(uuid, jsonb) from public, anon;
grant execute on function public.geldloop_dossier_bewaren(uuid, jsonb) to authenticated;
revoke execute on function public.geldloop_stoppen(uuid, text, boolean) from public, anon;
grant execute on function public.geldloop_stoppen(uuid, text, boolean) to authenticated;
revoke execute on function public.geldloop_wijziging_terugdraaien(uuid) from public, anon;
grant execute on function public.geldloop_wijziging_terugdraaien(uuid) to authenticated;
revoke execute on function public.geldloop_wijzigingen_van(uuid, date) from public, anon;
grant execute on function public.geldloop_wijzigingen_van(uuid, date) to authenticated;
