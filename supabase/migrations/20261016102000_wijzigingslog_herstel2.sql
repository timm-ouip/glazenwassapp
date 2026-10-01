-- Tweede herstel van het wijzigingslog (na de tweede review).
--
-- 1. Extra werk los terugzetten: élke meerprijsregel van hetzelfde adres
--    binnen die minuut die nog niet teruggezet is en niet meegaat, blokkeert.
--    Niet alleen de regel die nu nog precies zo staat: na een latere andere
--    meerprijswijziging kwam het werk anders terug voor € 0. Liever een keer
--    te veel weigeren. Wat in dezelfde keer al teruggezet wordt (de
--    herroept-regel van een meerprijs in `ids`) telt niet: anders blokkeerde
--    "samen terug" binnen een minuut na het opslaan zichzelf.
-- 2. Bij "intussen gewijzigd" telt alleen de duur die de database zelf
--    invulde niet mee. Een duur die met de hand is gezet (duur_zelf = true)
--    telt wél: die mag Ongedaan maken niet stilletjes overschrijven.

-- Het extra werk zonder de duur die de database zelf invulde.
create or replace function public.maandwerk_zonder_duur(maandwerk jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(
           case
             when jsonb_typeof(w) = 'object'
                  and coalesce(jsonb_typeof(w -> 'duur_zelf'), '') = 'boolean'
                  and (w ->> 'duur_zelf')::boolean
               then w
             when jsonb_typeof(w) = 'object' then w - 'duur' - 'duur_zelf'
             else w
           end
           order by nr), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(maandwerk) = 'array' then maandwerk else '[]'::jsonb end)
       with ordinality as t(w, nr)
$$;

-- Hoort er bij deze wijziging van het extra werk een meerprijs (zelfde adres,
-- binnen een minuut, nog niet teruggezet) die niet in `ids` zit? Security
-- definer, omdat wie de prijzen niet ziet die regel ook niet kan lezen; er
-- komt alleen ja of nee uit.
create or replace function public.wijziging_meerprijs_los(wijziging uuid, ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wijzigingen w
    join public.wijzigingen m
      on m.company_id = w.company_id and m.customer_id = w.customer_id
     and m.veld = 'meerprijs' and m.bron = 'app' and m.teruggedraaid_op is null
     and m.op between w.op - interval '1 minute' and w.op + interval '1 minute'
    where w.id = wijziging
      and w.company_id = public.current_company_id()
      and not (m.id = any (ids))
      -- Het terugzetten van een meerprijs die in dezelfde keer meegaat.
      and not coalesce(m.herroept = any (ids), false)
  )
$$;
