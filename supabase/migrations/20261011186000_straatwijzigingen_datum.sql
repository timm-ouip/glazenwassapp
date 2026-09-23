-- `geldloop_straat_wijzigingen_van(datum)` botste op zijn eigen parameter: in
-- `v.datum = datum` wist Postgres niet of de rechterkant de kolom of de
-- parameter was, en gaf "column reference datum is ambiguous". Het lijstje met
-- straatwijzigingen bleef daardoor leeg in het avondoverzicht.
create or replace function public.geldloop_straat_wijzigingen_van(datum date)
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
    public.heeft_recht('prijzen_zien') or public.heeft_recht('geldlopen')
  ) then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'straat', w.straat,
      'voor_naam', w.voor_naam, 'na_naam', w.na_naam,
      'door', w.door, 'door_naam', w.door_naam, 'op', w.op,
      'teruggedraaid_op', w.teruggedraaid_op, 'teruggedraaid_naam', w.teruggedraaid_naam
    ) order by w.op)
    from public.geldloop_straat_wijzigingen w
    join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
    where w.company_id = bedrijf and v.datum = datum
  ), '[]'::jsonb);
end
$fn$;
revoke execute on function public.geldloop_straat_wijzigingen_van(date) from public, anon;
grant execute on function public.geldloop_straat_wijzigingen_van(date) to authenticated;
