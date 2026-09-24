-- Maandconcepten: in de nacht van de 1e zet de app ze zelf klaar.
--
-- Tot nu toe moest iemand op "Concepten klaarzetten" drukken. Dat is prima als
-- je elke dag in de facturentab kijkt, maar de klanten met "verzamelen per
-- maand" wachten juist tot de maand voorbij is -- en dan moet je er precies op
-- dat moment aan denken. Dus doet de nacht van de 1e het voortaan zelf.
--
-- Klaarzetten is een veilige stap: een concept heeft geen nummer, gaat nergens
-- heen en is gewoon weg te gooien. Versturen blijft met de hand.

-- ---------------------------------------------------------------------
-- 1. Klaarzetten zonder ingelogde gebruiker
-- ---------------------------------------------------------------------
-- De bestaande functie leunt op `current_company_id()` en `heeft_recht`, en
-- die zijn er allebei niet als pg_cron aan de knop draait. Het werk zelf zit
-- daarom nu in een functie die het bedrijf gewoon meekrijgt; de oude functie
-- blijft de deur voor de app, met de rechtencontrole erop.
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
      case when k.factuur_per = 'maand' then date_trunc('month', fr.datum)::date else fr.datum end as bundel,
      array_agg(fr.id) as regels
    from public.factuurregels fr
    join public.klanten k on k.id = fr.klant_id
    where fr.company_id = bedrijf and fr.factuur_id is null and fr.deleted_at is null
      and k.deleted_at is null
      and (k.factuur_per = 'beurt'
           or nu_ook
           or fr.datum < date_trunc('month', vandaag)::date)
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

-- De knop in de app: dezelfde rechtencontrole als eerst, het werk erachter.
create or replace function public.facturen_klaarzetten(nu_ook boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;
  return public.facturen_klaarzetten_voor(bedrijf, nu_ook);
end
$$;

-- ---------------------------------------------------------------------
-- 2. Alle bedrijven die het factureren aan hebben staan
-- ---------------------------------------------------------------------
create or replace function public.facturen_maandconcepten()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  totaal integer := 0;
begin
  for c in select id from public.companies where factuur_start_op is not null loop
    -- Eén bedrijf dat struikelt, mag de rest niet meenemen: de nacht draait
    -- maar één keer per maand.
    begin
      totaal := totaal + public.facturen_klaarzetten_voor(c.id, false);
    exception when others then
      raise warning 'maandconcepten voor % mislukt: %', c.id, sqlerrm;
    end;
  end loop;
  return totaal;
end
$$;

revoke execute on function public.facturen_maandconcepten() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. De nacht van de 1e
-- ---------------------------------------------------------------------
-- pg_cron rekent in UTC; 02:00 UTC is hier drie of vier uur 's nachts. Ruim
-- na middernacht, zodat `date_trunc('month', vandaag)` echt de nieuwe maand is.
select cron.unschedule('facturen-maandconcepten')
where exists (select 1 from cron.job where jobname = 'facturen-maandconcepten');

select cron.schedule(
  'facturen-maandconcepten',
  '0 2 1 * *',
  $$select public.facturen_maandconcepten();$$
);
