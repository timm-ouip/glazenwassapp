-- Twee sloten die nog ontbraken bij de ploegen (uit de review van 20-09).
--
-- 1. Het slot op de koppeling teamlid ↔ account gold alleen bij wijzigen. Wie
--    het teamrecht heeft, kon dus een teamlid aanmaken met het account van
--    iemand van een ander bedrijf: die naam liep dan mee in zijn eigen lijst,
--    en een openstaande uitnodiging van dat andere bedrijf raakte geblokkeerd
--    (de kolommen zijn uniek over alle bedrijven heen).
-- 2. Een ploeg kon een teamlid van een ander bedrijf bevatten: dag_ploeg_leden
--    verwees wel naar teamleden, maar controleerde het bedrijf niet.

create or replace function public.teamlid_koppeling_slot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  hoort_bij uuid;
begin
  -- De server (service-rol) en de koppelfunctie mogen het wel.
  if current_setting('role', true) = 'service_role'
     or coalesce(current_setting('wooshy.koppelt_teamlid', true), '') = 'ja'
     or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.employee_id is not distinct from old.employee_id
     and new.uitgenodigd_user_id is not distinct from old.uitgenodigd_user_id then
    return new;
  end if;

  -- Bij een insert mag een koppeling alleen als hij nergens naar wijst.
  if new.uitgenodigd_user_id is not null then
    raise exception 'De koppeling met een account gaat via uitnodigen.';
  end if;
  if new.employee_id is not null then
    select company_id into hoort_bij from public.employees where id = new.employee_id;
    if hoort_bij is distinct from new.company_id then
      raise exception 'Dit account hoort niet bij jouw bedrijf.';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists teamleden_koppeling_slot on public.teamleden;
create trigger teamleden_koppeling_slot before insert or update on public.teamleden
  for each row execute function public.teamlid_koppeling_slot();

-- Een ploeglid moet een teamlid van hetzelfde bedrijf zijn. Dat laten we de
-- database zelf afdwingen met een samengestelde verwijzing.
alter table public.teamleden add constraint teamleden_bedrijf_id_uniek unique (company_id, id);

alter table public.dag_ploeg_leden drop constraint if exists dag_ploeg_leden_teamlid_id_fkey;
alter table public.dag_ploeg_leden
  add constraint dag_ploeg_leden_teamlid_fkey
  foreign key (company_id, teamlid_id) references public.teamleden (company_id, id) on delete cascade;
