-- De kaart per maand op de rekening, zoals op een factuur.
--
-- Een beginstand van de kaart (met vakjes) gaf tot nu toe één regel met één
-- totaal: "3× wasbeurt € 47". Staan er twee prijzen in (een oude 0 houdt zijn
-- oude bedrag, een nieuwe krijgt de prijs van nu), dan was er geen prijs per
-- beurt te noemen. Nu geeft geld_schuld per maand mee wat die kost, en maakt
-- de app er een regel per prijs van: "2× wasbeurt à € 15" en "Wasbeurt € 17".
--
-- Alleen de omschrijving van een beginstand met vakjes krijgt er stukjes bij
-- ("2026-07~15.00~0"); bedrag, aantal en alles wat rekent blijft gelijk.
-- (was: 20261017120000_kaart_vakjes.sql)
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
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag,
         case when g.vakjes is null then greatest(coalesce(g.aantal, 1), 1)
              else coalesce(g.aantal, 0) end::int,
         case when g.vakjes is null then coalesce(array_to_string(g.maanden, ','), '')
              else concat_ws(',',
                     nullif(array_to_string(g.maanden, ','), ''),
                     (select string_agg((v ->> 'maand') || '=' || (v ->> 'teken'), ',' order by v ->> 'maand')
                        from jsonb_array_elements(g.vakjes) v
                        where v ->> 'teken' not in ('0', 'x')),
                     -- Per maand wat hij kost ("2026-07~15.00~0"), zodat de
                     -- rekening er net als een factuur een regel per prijs
                     -- van kan maken. Wie alleen maanden of merkjes leest,
                     -- slaat deze stukjes over.
                     (select string_agg((v ->> 'maand') || '~' || round((v ->> 'bedrag')::numeric, 2)::text
                                        || '~' || (v ->> 'teken'), ',' order by v ->> 'maand')
                        from jsonb_array_elements(g.vakjes) v
                        where v ->> 'teken' <> 'x' and coalesce((v ->> 'bedrag')::numeric, 0) > 0))
         end,
         0, g.id
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort = 'beginstand' and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  -- Wasbeurten: met de dagnotitie en het extra werk van die ronde erbij.
  select r.customer_id, 'wassen', r.datum, wp.prijs, 1,
         concat_ws(' · ',
           (select string_agg(btrim(m ->> 'notitie'), ', ')
              from jsonb_array_elements(
                     case when jsonb_typeof(cu.maandwerk) = 'array' then cu.maandwerk else '[]'::jsonb end
                   ) m
              where coalesce(m -> 'maanden', '[]'::jsonb) ? substr(r.ronde, 6, 2)
                and coalesce(m ->> 'jaar', '') in ('', substr(r.ronde, 1, 4))
                and btrim(coalesce(m ->> 'notitie', '')) <> ''),
           nullif(btrim(r.notitie), '')),
         1, r.id
  from public.wasdag_regels r
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  join public.customers cu on cu.id = r.customer_id
  where r.company_id = bedrijf and r.customer_id = any (adressen)
    and r.gedaan_op is not null and wp.prijs > 0
    and r.niet_gewassen_op is null
    and r.betaalmethode is distinct from 'overmaken'
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
