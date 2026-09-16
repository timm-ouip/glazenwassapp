-- Nazorg op de planner en de nieuwe mailtabellen (na de code-review).

-- Het vaste vangnet: het bedrijf vult zich vanzelf in.
create trigger mail_regels_set_company_id before insert on public.mail_regels
  for each row execute function public.set_company_id();
create trigger geplande_mails_set_company_id before insert on public.geplande_mails
  for each row execute function public.set_company_id();

-- Oppakken geeft alleen de id's terug: de inhoud (met bijlagen) haalt de
-- planner per mail op, vlak voor het versturen. Anders staan vijf mails met
-- bijlagen tegelijk in het geheugen.
drop function if exists public.geplande_mails_oppakken(integer);
create function public.geplande_mails_oppakken(maximaal integer)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update public.geplande_mails g
     set status = 'bezig'
   where g.id in (
     select id from public.geplande_mails
      where status = 'wacht' and versturen_op <= now()
      order by versturen_op
      limit maximaal
      for update skip locked
   )
  returning g.id;
$$;

revoke execute on function public.geplande_mails_oppakken(integer) from public, anon, authenticated;
