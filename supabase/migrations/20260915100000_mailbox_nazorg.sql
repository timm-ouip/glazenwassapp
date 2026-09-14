-- Twee dingen die bij de mailbox horen en er in eerste instantie niet bij zaten.

-- 1. De vangrail die elke andere tabel heeft: company_id vanzelf invullen als
--    een insert hem niet meestuurt. Nu schrijft alleen de service role hier en
--    die vult hem altijd zelf, maar zo blijft het kloppen als dat verandert.
create trigger mail_mappen_set_company_id before insert on public.mail_mappen
  for each row execute function public.set_company_id();

-- 2. Hoeveel mails er per map in Wooshy staan, in één vraag in plaats van één
--    per map. Security invoker: RLS op berichten geldt gewoon, dus alleen de
--    eigenaar krijgt getallen terug.
create or replace function public.mail_tellingen()
returns table (map_id uuid, aantal bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select b.map_id, count(*)
  from public.berichten b
  where b.op_server and b.deleted_at is null
  group by b.map_id
$$;

revoke all on function public.mail_tellingen() from public, anon;
grant execute on function public.mail_tellingen() to authenticated;
