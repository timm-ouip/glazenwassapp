-- Twee dingen na de review van 19-09.
--
-- 1. Uitnodigingen. De server moet een bestaand account op e-mail kunnen
--    vinden (om iemand opnieuw uit te nodigen) en de openstaande uitnodigingen
--    van één bedrijf kunnen tonen. Via de Auth-API kon dat alleen door een
--    inloglink te maken (en dan weigerde de tweede mail binnen een minuut) of
--    door álle accounts van alle bedrijven op te halen. Deze twee functies
--    lezen auth.users rechtstreeks, en alleen de service-rol mag ze gebruiken.
--
-- 2. Een aanmelding terugdraaien mag niets overschrijven wat daarna gebeurde:
--    staan de gegevens niet meer zoals de aanmelding ze neerzette, of hangt de
--    nieuwe klant intussen ook aan een ander pand, dan weigert hij. En een
--    bijgevulde postcode gaat er alleen af als hij nog dezelfde is.

create or replace function public.gebruiker_met_email(adres text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(adres)) limit 1
$$;

revoke all on function public.gebruiker_met_email(text) from public, anon, authenticated;
grant execute on function public.gebruiker_met_email(text) to service_role;

create or replace function public.openstaande_uitnodigingen(bedrijf uuid)
returns table (id uuid, email text, uitgenodigd_op text, invited_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text, u.raw_app_meta_data ->> 'uitgenodigd_op', u.invited_at, u.created_at
  from auth.users u
  where u.raw_app_meta_data ->> 'uitgenodigd_voor' = bedrijf::text
    and not exists (select 1 from public.employees e where e.id = u.id)
  order by u.created_at
$$;

revoke all on function public.openstaande_uitnodigingen(uuid) from public, anon, authenticated;
grant execute on function public.openstaande_uitnodigingen(uuid) to service_role;

create or replace function public.aanmelding_terugdraaien(aanmelding uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.aanmeldingen%rowtype;
  au jsonb;
  huidig uuid;
  k public.klanten%rowtype;
  vorig jsonb;
  andere integer;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;

  select * into a from public.aanmeldingen
  where id = aanmelding and company_id = bedrijf
  for update;
  if not found or a.soort <> 'gekoppeld' or a.status <> 'open' or a.automatisch is null then
    raise exception 'Deze aanmelding is al afgehandeld.';
  end if;
  au := a.automatisch;

  if a.customer_id is not null then
    select klant_id into huidig from public.customers
    where id = a.customer_id and company_id = bedrijf
    for update;
    if huidig is distinct from a.klant_id then
      raise exception 'Aan dit adres is intussen iets veranderd. Kijk op de klantenpagina hoe het er nu voor staat.';
    end if;
  end if;

  if a.klant_id is not null then
    select * into k from public.klanten
    where id = a.klant_id and company_id = bedrijf
    for update;
    -- Wat je na de aanmelding zelf aanpaste, gaat voor: dan niet terugdraaien.
    if found and (k.naam <> a.naam or k.email <> a.email or k.telefoon <> a.telefoon) then
      raise exception 'De gegevens van deze klant zijn na de aanmelding aangepast. Pas ze op de klantenpagina aan.';
    end if;
    if coalesce((au ->> 'klant_nieuw')::boolean, false) then
      select count(*) into andere from public.customers
      where klant_id = a.klant_id and company_id = bedrijf and deleted_at is null
        and id is distinct from a.customer_id;
      if andere > 0 then
        raise exception 'Deze klant hangt intussen ook aan een ander adres. Pas het op de klantenpagina aan.';
      end if;
    end if;
  end if;

  if a.customer_id is not null then
    update public.customers
    set klant_id = nullif(au ->> 'vorige_klant_id', '')::uuid,
        aangemeld_op = nullif(au ->> 'vorige_aangemeld_op', '')::timestamptz,
        -- Alleen weghalen wat de aanmelding erin zette, niet een postcode die
        -- je daarna zelf verbeterde.
        postcode = case
          when coalesce((au ->> 'postcode_gevuld')::boolean, false) and postcode = a.postcode then ''
          else postcode
        end
    where id = a.customer_id;
  end if;

  if a.klant_id is not null then
    if coalesce((au ->> 'klant_nieuw')::boolean, false) then
      update public.klanten set deleted_at = now()
      where id = a.klant_id and company_id = bedrijf;
    elsif au ? 'vorige_klant' and jsonb_typeof(au -> 'vorige_klant') = 'object' then
      vorig := au -> 'vorige_klant';
      update public.klanten
      set naam = coalesce(vorig ->> 'naam', ''),
          email = coalesce(vorig ->> 'email', ''),
          telefoon = coalesce(vorig ->> 'telefoon', ''),
          straat = coalesce(vorig ->> 'straat', ''),
          huisnummer = coalesce(vorig ->> 'huisnummer', ''),
          postcode = coalesce(vorig ->> 'postcode', ''),
          plaats = coalesce(vorig ->> 'plaats', '')
      where id = a.klant_id and company_id = bedrijf;
    end if;
  end if;

  update public.aanmeldingen set status = 'geweigerd' where id = a.id;
end
$$;
