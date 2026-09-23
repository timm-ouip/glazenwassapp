-- Wat er in een periode teruggemeld is als "niet gewassen".
--
-- De planning leest dit om de overgeslagen adressen bij die dag te tonen. Via
-- een functie en niet rechtstreeks uit de tabel, net als de rest van de
-- wijzigingen van geldlopers — dan staat op één plek wie het mag zien.

create or replace function public.geldloop_vergeten(vanaf date, tot date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not (
    public.heeft_recht('planning') or public.heeft_recht('prijzen_zien')
    or public.heeft_recht('klanten_bekijken')
  ) then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'customer_id', w.customer_id, 'adres', w.adres,
      'datum', w.voor ->> 'datum', 'door_naam', w.door_naam, 'op', w.op
    ) order by w.voor ->> 'datum', w.adres)
    from public.geldloop_wijzigingen w
    where w.company_id = bedrijf
      and w.soort = 'niet_gewassen'
      and w.teruggedraaid_op is null
      and (w.voor ->> 'datum')::date between vanaf and tot
  ), '[]'::jsonb);
end
$fn$;

revoke execute on function public.geldloop_vergeten(date, date) from public, anon;
grant execute on function public.geldloop_vergeten(date, date) to authenticated;
