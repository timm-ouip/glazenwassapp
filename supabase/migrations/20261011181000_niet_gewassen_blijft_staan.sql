-- "Niet gewassen" haalt de dag niet meer weg, maar markeert hem.
--
-- Eerst verdween de wasbeurt uit de planning. Dat klopte voor het geld (er is
-- niets gedaan, dus er is niets te betalen), maar het wiste ook het spoor: op
-- de dag stond het adres er ineens niet meer tussen, en op de wijkenpagina
-- sprong de maand terug naar "niet ingepland" zonder dat iemand kon zien
-- waarom. Vanaf nu blijft de regel staan met een stempel erop:
--   * op de dag staat hij rood, met "niet gewassen" erbij;
--   * zijn bedrag telt nergens mee — niet in de omzet, niet in wat de klant
--     open heeft staan;
--   * op de wijkenpagina blijft de maand zichtbaar, met dezelfde markering.

alter table public.wasdag_regels
  add column niet_gewassen_op timestamptz,
  add column niet_gewassen_door uuid,
  add column niet_gewassen_naam text;

-- ---------------------------------------------------------------------
-- 1. Een gemarkeerde wasbeurt is geen schuld
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit betalingen_fundament, met één regel erbij:
-- een wasbeurt die als "niet gewassen" is teruggemeld telt niet mee.
create or replace function public.geld_schuld(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag, greatest(coalesce(g.aantal, 1), 1)::int,
         coalesce(array_to_string(g.maanden, ','), ''), 0, g.id
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort = 'beginstand' and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  -- Wasbeurten: met de dagnotitie en het extra werk van die maand erbij.
  select r.customer_id, 'wassen', r.datum, wp.prijs, 1,
         concat_ws(' · ',
           (select string_agg(btrim(m ->> 'notitie'), ', ')
              from jsonb_array_elements(
                     case when jsonb_typeof(cu.maandwerk) = 'array' then cu.maandwerk else '[]'::jsonb end
                   ) m
              where coalesce(m -> 'maanden', '[]'::jsonb) ? to_char(r.datum, 'MM')
                and coalesce(m ->> 'jaar', '') in ('', to_char(r.datum, 'YYYY'))
                and btrim(coalesce(m ->> 'notitie', '')) <> ''),
           nullif(btrim(r.notitie), '')),
         1, r.id
  from public.wasdag_regels r
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  join public.customers cu on cu.id = r.customer_id
  where r.company_id = bedrijf and r.customer_id = any (adressen)
    and r.gedaan_op is not null and wp.prijs > 0
    and r.niet_gewassen_op is null
    and r.datum <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = r.customer_id and r.datum >= p.vanaf and (p.tot is null or r.datum <= p.tot)
    )
  union all
  -- Uitgevoerde klussen, met wat het was.
  select k.customer_id, 'klus', k.gedaan_op, kp.prijs, 1, k.omschrijving, 2, k.id
  from public.klussen k
  join public.klus_prijzen kp on kp.klus_id = k.id
  where k.company_id = bedrijf and k.customer_id = any (adressen)
    and k.gedaan_op is not null and k.deleted_at is null and kp.prijs > 0
    and k.gedaan_op <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = k.customer_id and k.gedaan_op >= p.vanaf and (p.tot is null or k.gedaan_op <= p.tot)
    )
$$;
revoke execute on function public.geld_schuld(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. De knop aan de deur zet het stempel
-- ---------------------------------------------------------------------
create or replace function public.geldloop_niet_gewassen(adres_id uuid, dag date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  vrij uuid := public.geldloop_dossier_toegang(adres_id);
  r public.wasdag_regels;
  naam text := public.geld_mijn_naam();
  tekst text := public.geld_adres_tekst(adres_id);
begin
  -- Een geldloper meldt dit aan de deur, dus over de avond waarop hij loopt.
  if vrij is not null and not public.is_eigenaar() and not exists (
    select 1 from public.geldloop_vrijgaven v where v.id = vrij and v.datum = dag
  ) then
    raise exception 'Dat kan alleen voor de dag van je eigen avond.';
  end if;

  -- De laatste wasbeurt van die maand die al gewassen én afgemeld is. Wat nog
  -- gepland staat blijft staan: daar is nog niets mee misgegaan.
  select * into r from public.wasdag_regels w
   where w.customer_id = adres_id and w.company_id = bedrijf
     and date_trunc('month', w.datum) = date_trunc('month', dag)
     and w.datum <= dag
     and w.gedaan_op is not null
     and w.niet_gewassen_op is null
   order by w.datum desc
   limit 1;
  if not found then
    if exists (
      select 1 from public.wasdag_regels w
       where w.customer_id = adres_id and w.company_id = bedrijf
         and date_trunc('month', w.datum) = date_trunc('month', dag)
         and w.niet_gewassen_op is not null
    ) then
      raise exception 'Deze maand staat al als niet gewassen gemeld op dit adres.';
    end if;
    raise exception 'Er is deze maand geen wasbeurt afgemeld op dit adres.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  insert into public.geldloop_wijzigingen
    (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door_naam)
  values (bedrijf, adres_id, vrij, 'niet_gewassen',
          jsonb_build_object('id', r.id, 'datum', r.datum, 'gemarkeerd', true),
          '{}'::jsonb, tekst, naam);

  update public.wasdag_regels
    set niet_gewassen_op = now(), niet_gewassen_door = auth.uid(), niet_gewassen_naam = naam
    where id = r.id;
end
$fn$;
revoke execute on function public.geldloop_niet_gewassen(uuid, date) from public, anon;
grant execute on function public.geldloop_niet_gewassen(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Terugdraaien haalt het stempel er weer af
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit niet_gewassen_herstel; alleen de tak
-- 'niet_gewassen' is nieuw. Die kent twee soorten regels: de nieuwe, waarbij
-- de wasbeurt is blijven staan met een stempel, en de oude, waarbij hij is
-- weggehaald en helemaal in `voor` bewaard staat.
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
    -- Terug naar wie er eerst aan het adres hing (ook een verhuisde klant, die
    -- met het terugdraaien van "laten stoppen" terugkomt), of naar niemand.
    update public.customers set klant_id = nullif(w.voor ->> 'klant_id', '')::uuid
      where id = w.customer_id and klant_id = (w.na ->> 'klant_id')::uuid;
    -- Klachten van dit adres die intussen aan de nieuwe klant hingen, gaan mee.
    update public.klachten set klant_id = nullif(w.voor ->> 'klant_id', '')::uuid
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
  elsif w.soort = 'niet_gewassen' then
    if coalesce((w.voor ->> 'gemarkeerd')::boolean, false) then
      -- De regel is blijven staan: het stempel eraf halen is genoeg.
      update public.wasdag_regels
        set niet_gewassen_op = null, niet_gewassen_door = null, niet_gewassen_naam = null
        where id = (w.voor ->> 'id')::uuid and niet_gewassen_op is not null;
      if not found then
        raise exception 'Deze wasbeurt staat niet meer als niet gewassen gemeld.';
      end if;
    else
      -- Oude regels, van vóór deze migratie: de hele wasbeurt was weggehaald.
      if exists (
        select 1 from public.wasdag_regels r
         where r.customer_id = w.customer_id and r.datum = (w.voor ->> 'datum')::date
      ) then
        raise exception 'Dit adres staat alweer op die dag ingepland.';
      end if;
      perform set_config('wooshy.gedaan', '1', true);
      insert into public.wasdag_regels
        select * from jsonb_populate_record(null::public.wasdag_regels, w.voor - 'prijs');
      if jsonb_typeof(w.voor -> 'prijs') = 'number' then
        update public.wasdag_prijzen wp
          set prijs = (w.voor ->> 'prijs')::numeric
          where wp.regel_id = (w.voor ->> 'id')::uuid;
      end if;
    end if;
  end if;

  update public.geldloop_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(), teruggedraaid_naam = public.geld_mijn_naam()
    where id = wijziging;
end
$$;
revoke execute on function public.geldloop_wijziging_terugdraaien(uuid) from public, anon;
grant execute on function public.geldloop_wijziging_terugdraaien(uuid) to authenticated;
