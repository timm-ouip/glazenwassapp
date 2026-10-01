-- Herstel van 20261016105000: een verhuizing van een adres zonder klant
-- (voor.klant_id leeg) gaf in de opruimtaak "onbekend" in plaats van "nee",
-- waardoor die verborgen geschiedenis nooit gewist werd.

create or replace function public.verhuizing_log_opruimen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  weg integer;
begin
  delete from public.wijzigingen w
  using public.wijzigingen v
  join public.customers c on c.id = v.customer_id
  where w.verborgen_door = v.id
    and v.veld = 'verhuisd'
    and v.teruggedraaid_op is null
    and v.op < now() - interval '1 year'
    -- Staat dezelfde klant weer actief op het adres, dan is hij niet weg.
    and not (
      c.inactief_op is null
      and c.deleted_at is null
      and c.klant_id is not null
      and coalesce(c.klant_id = nullif(v.voor ->> 'klant_id', '')::uuid, false)
      and exists (select 1 from public.klanten k where k.id = c.klant_id and k.deleted_at is null)
    );
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.verhuizing_log_opruimen() from public, anon, authenticated;
