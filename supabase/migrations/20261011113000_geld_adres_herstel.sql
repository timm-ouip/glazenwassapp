-- Het geld van één adres (dossier): de parameter "adres" botste met de kolom
-- adres van het logboek. Verder gelijk aan geld_overzichten.

create or replace function public.geld_adres(adres uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  st record;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres]);
  return jsonb_build_object(
    'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
    'gebeurtenissen', coalesce((
      select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op desc)
      from public.betaal_gebeurtenissen g
      where g.customer_id = adres and g.company_id = bedrijf and g.soort <> 'ongedaan'
    ), '[]'::jsonb),
    'vaste_kortingen', coalesce((
      select jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag,
                                          'door_naam', vk.gemaakt_naam, 'op', vk.gemaakt_op)
                       order by vk.gemaakt_op)
      from public.vaste_kortingen vk where vk.customer_id = adres and vk.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;
