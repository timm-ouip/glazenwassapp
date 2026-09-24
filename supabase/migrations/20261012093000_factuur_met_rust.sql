-- Een factuur even met rust laten.
--
-- Dit hoort juist bij een verstuurde factuur -- het VvE-bestuur heeft gezegd
-- dat het in de volgende vergadering komt -- en die staat verder op slot.
-- Vandaar een eigen functie: dit ene veld mag wel, de rest niet.
create or replace function public.factuur_met_rust(factuur uuid, tot date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag de facturen niet aanpassen.';
  end if;
  update public.facturen
    set met_rust_tot = tot
    where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
end
$$;
