-- Eenmalig werk in een bepaalde maand.
--
-- customers.maandwerk kende alleen kalendermaanden, dus alles kwam elk jaar
-- terug: "in oktober de serre" gold voor elke oktober. Een klant die vraagt
-- om "volgende maand één keer de serre" hoort dat niet elk jaar te krijgen.
-- Zo'n stuk werk krijgt nu een jaar erbij:
--   {"id": "…", "maanden": ["10"], "jaar": 2026, "notitie": "serre"}
-- Zonder jaar blijft het zoals het was: elk jaar.
--
-- De prijs van een wasdag telt de meerprijs daarom alleen mee als het stuk
-- werk elk jaar geldt, of als het jaar van die wasdag klopt. Verder dezelfde
-- functie als in 20260922090000_prijskolommen_weg.sql.

create or replace function public.wasdag_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrag numeric := 0;
begin
  if new.customer_id is not null then
    select coalesce(ap.prijs, 0) + coalesce((
      select sum((ap.maandwerk_extra ->> (w ->> 'id'))::numeric)
      from public.customers c, jsonb_array_elements(
        case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
      ) as t(w)
      where c.id = new.customer_id
        and w -> 'maanden' ? to_char(new.datum, 'MM')
        and coalesce(w ->> 'jaar', to_char(new.datum, 'YYYY')) = to_char(new.datum, 'YYYY')
        and jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')) = 'number'
    ), 0)
    into bedrag
    from public.adres_prijzen ap
    where ap.customer_id = new.customer_id and ap.company_id = new.company_id;
  end if;
  insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  values (new.id, new.company_id, coalesce(bedrag, 0))
  on conflict (regel_id) do nothing;
  return null;
end
$$;

revoke execute on function public.wasdag_prijs_aanmaken() from public, anon, authenticated;
