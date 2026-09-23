-- Niet gewassen: een adres dat toch overgeslagen is.
--
-- Aan de deur blijkt soms dat er helemaal niet gewassen is — vergeten, of er
-- kon niemand bij. Dan hoort er ook geen geld voor gevraagd te worden. Deze
-- knop haalt de wasbeurt van die maand weg: het bedrag valt van de pof af en
-- het adres telt weer als niet gewassen, zodat je hem opnieuw kunt inplannen
-- als je nog een keer in de wijk bent.
--
-- De hele wasdagregel gaat mee in de wijziging, dus de eigenaar zet hem in
-- één klik terug — net als bij alles wat een geldloper aan de deur aanpast.

alter table public.geldloop_wijzigingen drop constraint if exists geldloop_wijzigingen_soort_check;
alter table public.geldloop_wijzigingen
  add constraint geldloop_wijzigingen_soort_check
  check (soort in ('adres', 'prijs', 'klant', 'klant_nieuw', 'stoppen', 'niet_gewassen'));

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
  -- De wasbeurt van de maand van deze avond; staan er meer, dan de laatste.
  select * into r from public.wasdag_regels w
   where w.customer_id = adres_id and w.company_id = bedrijf
     and date_trunc('month', w.datum) = date_trunc('month', dag)
   order by w.datum desc
   limit 1;
  if not found then
    raise exception 'Er staat deze maand geen wasbeurt op dit adres.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  insert into public.geldloop_wijzigingen
    (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door_naam)
  values (bedrijf, adres_id, vrij, 'niet_gewassen', to_jsonb(r), '{}'::jsonb, tekst, naam);

  delete from public.wasdag_regels where id = r.id;
end
$fn$;

revoke execute on function public.geldloop_niet_gewassen(uuid, date) from public, anon;
grant execute on function public.geldloop_niet_gewassen(uuid, date) to authenticated;

-- Terugdraaien kent er een geval bij: de wasbeurt komt terug zoals hij was.
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
  elsif w.soort = 'niet_gewassen' then
    if exists (
      select 1 from public.wasdag_regels r
       where r.customer_id = w.customer_id and r.datum = (w.voor ->> 'datum')::date
    ) then
      raise exception 'Dit adres staat alweer op die dag ingepland.';
    end if;
    -- De hele regel is bewaard, dus hij komt terug zoals hij was: dezelfde
    -- dag, dezelfde prijs, hetzelfde team.
    insert into public.wasdag_regels
      select * from jsonb_populate_record(null::public.wasdag_regels, w.voor);
  end if;

  update public.geldloop_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(), teruggedraaid_naam = public.geld_mijn_naam()
    where id = wijziging;
end
$$;

revoke execute on function public.geldloop_wijziging_terugdraaien(uuid) from public, anon;
grant execute on function public.geldloop_wijziging_terugdraaien(uuid) to authenticated;
