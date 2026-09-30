-- Minder vaak een factuur: naast per beurt en per maand ook per kwartaal,
-- per half jaar en per jaar.
--
-- Het zijn vaste kalenderperiodes (jan-mrt, apr-jun ...; jan-jun en jul-dec),
-- voor iedereen dezelfde, zodat ze gelijk lopen met de btw-aangifte. Net als
-- bij "maand" wacht de app tot de periode voorbij is; de knop "toch nu
-- klaarzetten" (`nu_ook`) doorbreekt dat.

-- De oude check kende alleen beurt en maand. Zijn naam hebben we nooit zelf
-- gekozen, dus zoeken we hem op in plaats van erop te gokken.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.klanten'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%factuur_per%'
  loop
    execute format('alter table public.klanten drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.klanten
  add constraint klanten_factuur_per_check
  check (factuur_per in ('beurt', 'maand', 'kwartaal', 'halfjaar', 'jaar'));

-- De eerste dag van de periode waar een beurt in valt. Bij "beurt" is dat
-- de dag zelf: dan is elke dag een eigen factuur.
create or replace function public.factuur_periode_begin(per text, d date)
returns date
language sql
immutable
as $$
  select case per
    when 'maand' then date_trunc('month', d)::date
    when 'kwartaal' then date_trunc('quarter', d)::date
    when 'halfjaar' then
      (date_trunc('year', d) + case when extract(month from d) > 6 then interval '6 months' else interval '0' end)::date
    when 'jaar' then date_trunc('year', d)::date
    else d
  end
$$;

-- Is de periode van deze beurt voorbij? Pas dan komt er een concept, anders
-- stuur je halverwege een factuur en komt er daarna nog werk bij.
create or replace function public.factuur_periode_voorbij(per text, d date, vandaag date)
returns boolean
language sql
immutable
as $$
  select per = 'beurt'
    or public.factuur_periode_begin(per, d) + case per
         when 'maand' then interval '1 month'
         when 'kwartaal' then interval '3 months'
         when 'halfjaar' then interval '6 months'
         when 'jaar' then interval '1 year'
       end <= vandaag
$$;

create or replace function public.facturen_klaarzetten_voor(bedrijf uuid, nu_ook boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  g record;
  nieuw uuid;
  gemaakt integer := 0;
begin
  if bedrijf is null then
    return 0;
  end if;

  for g in
    select
      fr.klant_id,
      public.factuur_periode_begin(k.factuur_per, fr.datum) as bundel,
      array_agg(fr.id) as regels
    from public.factuurregels fr
    join public.klanten k on k.id = fr.klant_id
    where fr.company_id = bedrijf and fr.factuur_id is null and fr.deleted_at is null
      and k.deleted_at is null
      and (nu_ook or public.factuur_periode_voorbij(k.factuur_per, fr.datum, vandaag))
    group by 1, 2
  loop
    insert into public.facturen (company_id, klant_id)
      values (bedrijf, g.klant_id)
      returning id into nieuw;
    update public.factuurregels
      set factuur_id = nieuw
      where id = any (g.regels);
    gemaakt := gemaakt + 1;
  end loop;

  return gemaakt;
end
$$;
revoke execute on function public.facturen_klaarzetten_voor(uuid, boolean) from public, anon, authenticated;
