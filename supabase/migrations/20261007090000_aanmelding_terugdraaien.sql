-- Een automatisch gekoppelde aanmelding: zichtbaar én terug te draaien.
--
-- Vulde iemand via de aanmeldpagina zijn gegevens in bij een adres waar nog
-- niets bij stond, dan kwamen die er meteen op en stond de aanmelding direct
-- op "klaar". Niemand zag het, en terugdraaien kon niet. Met een flyer kan
-- iemand zo de adressen van zijn buren "aanmelden" met zijn eigen mail en
-- 06-nummer — en dan de aankondigingen van die buren krijgen.
--
-- Nu blijft het automatisch (dat scheelt werk), maar de aanmelding staat open
-- in Te doen, met Klopt en Ongedaan maken. Wat er precies veranderde staat in
-- `automatisch`, zodat terugdraaien niets anders raakt:
--   klant_nieuw          de klant is door deze aanmelding aangemaakt
--   vorige_klant_id      wie er vóór de aanmelding aan het adres hing (of null)
--   vorige_klant         de (lege) gegevens van die klant, als die er al was
--   postcode_gevuld      de postcode van het adres was leeg en is bijgevuld
--   vorige_aangemeld_op  wat er stond bij "aangemeld op"

alter table public.aanmeldingen
  add column if not exists automatisch jsonb;

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
  vorig jsonb;
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
    -- Hangt er intussen iemand anders aan het adres, dan niet zomaar
    -- terugdraaien: dan zou het werk van daarna verdwijnen.
    if huidig is distinct from a.klant_id then
      raise exception 'Aan dit adres is intussen iets veranderd. Kijk op de klantenpagina hoe het er nu voor staat.';
    end if;
    update public.customers
    set klant_id = nullif(au ->> 'vorige_klant_id', '')::uuid,
        aangemeld_op = nullif(au ->> 'vorige_aangemeld_op', '')::timestamptz,
        postcode = case when coalesce((au ->> 'postcode_gevuld')::boolean, false) then '' else postcode end
    where id = a.customer_id;
  end if;

  if a.klant_id is not null then
    if coalesce((au ->> 'klant_nieuw')::boolean, false) then
      -- Door deze aanmelding gemaakt: naar de prullenbak, niet hard weg.
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

revoke all on function public.aanmelding_terugdraaien(uuid) from public, anon;
grant execute on function public.aanmelding_terugdraaien(uuid) to authenticated;
