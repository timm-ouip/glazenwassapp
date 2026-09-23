-- Wie er vanavond meelopen, in de avond zelf.
--
-- Het loopscherm moet de straten kunnen verdelen, en daarvoor moet het weten
-- wie er die avond zijn. Dat stond tot nu toe alleen in het venster van de
-- eigenaar; `mijn_geldloop` gaf alleen de wijken terug.
create or replace function public.mijn_geldloop()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eigenaar boolean := public.is_eigenaar();
begin
  if bedrijf is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'datum', v.datum, 'begin_op', v.begin_op, 'eind_op', v.eind_op,
      'wijken', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'naam', d.name) order by d.sort_order), '[]')
                 from public.geldloop_vrijgave_wijken w join public.districts d on d.id = w.district_id
                 where w.vrijgave_id = v.id),
      'lopers', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                 from public.geldloop_vrijgave_lopers l
                 join public.employees e on e.id = l.employee_id
                 where l.vrijgave_id = v.id)
    ) order by v.begin_op)
    from public.geldloop_vrijgaven v
    where v.company_id = bedrijf
      and v.ingetrokken_op is null
      and v.eind_op > now()
      and v.datum <= (now() at time zone 'Europe/Amsterdam')::date
      and (eigenaar or exists (
        select 1 from public.geldloop_vrijgave_lopers l
        where l.vrijgave_id = v.id and l.employee_id = auth.uid()))
  ), '[]'::jsonb);
end
$$;
