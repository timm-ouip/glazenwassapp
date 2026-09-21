-- Terugdraaien van een wijziging aan het adres keek naar het hele extra werk,
-- ook naar de duur die de database er zelf bij invult als de meerprijs
-- verandert. Daardoor leek elk adres "intussen gewijzigd". Nu telt alleen wat
-- de geldloper aanpast: welk werk, in welke maanden, welk jaar.

create or replace function public.maandwerk_kern(werk jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m -> 'id', 'maanden', m -> 'maanden', 'jaar', m -> 'jaar', 'notitie', m -> 'notitie')
         order by m ->> 'id'), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(werk) = 'array' then werk else '[]'::jsonb end) m
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
