-- Een factuurregel hoort de klus of de beurt te volgen waar hij van komt.
--
-- Tot nu toe luisterde de trigger op `klussen` alleen naar `gedaan_op`. Dus:
--
--   * gooide je een afgevinkte klus weg, dan bleef zijn factuurregel staan en
--     factureerde je werk dat je zelf uit de app had gehaald;
--   * vinkte je een klus af en zette je de prijs er pas daarna in -- wat vaak
--     gebeurt, want de prijs komt na afloop -- dan ontstond er nooit een regel;
--   * paste je de prijs achteraf aan, dan bleef het oude bedrag staan.
--
-- Hetzelfde gold voor "prijs deze dag" bij een wasbeurt.
--
-- Overal dezelfde grens: een regel die al op een **genummerde** factuur staat,
-- blijft met rust. Dat papier ligt bij de klant; rechtzetten gaat met een
-- creditfactuur. Een vervangen regel (van een gecrediteerde factuur) blijft
-- ook staan.

-- ---------------------------------------------------------------------
-- 1. De regel van een klus, opnieuw bepaald
-- ---------------------------------------------------------------------
-- Eén plek die de vraag beantwoordt: hoort deze klus nu een losse factuurregel
-- te hebben, en zo ja met welk bedrag? Zowel het vinkje, de prullenbak, de
-- omschrijving als de prijs komen hier langs.
create or replace function public.klus_factuurregel_bijwerken(kl_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kl public.klussen;
  start_op date;
  methode text;
  k public.klanten;
  prijs numeric;
  tekst text;
  hoort boolean := false;
begin
  select * into kl from public.klussen where id = kl_id;
  if not found then
    return;
  end if;

  -- Alleen afgevinkt werk dat niet in de prullenbak ligt, bij een levend adres
  -- dat overmaakt, met een levende klant en een prijs. Dezelfde voorwaarden als
  -- `factuurregels_maken` voor een wasbeurt.
  if kl.gedaan_op is not null and kl.deleted_at is null then
    select c.factuur_start_op into start_op from public.companies c where c.id = kl.company_id;
    if start_op is not null and kl.gedaan_op >= start_op then
      select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') into methode
        from public.customers cu
        left join public.streets s on s.id = cu.street_id
        left join public.districts d on d.id = s.district_id
        where cu.id = kl.customer_id and cu.deleted_at is null;
      if methode = 'overmaken' then
        select kla.* into k
          from public.klanten kla
          join public.customers cu on cu.klant_id = kla.id
          where cu.id = kl.customer_id and kla.deleted_at is null;
        if found then
          select kp.prijs into prijs from public.klus_prijzen kp where kp.klus_id = kl.id;
          hoort := coalesce(prijs, 0) > 0;
        end if;
      end if;
    end if;
  end if;

  if not hoort then
    delete from public.factuurregels fr
      where fr.klus_id = kl_id
        and fr.vervangen_op is null
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f
                         where f.id = fr.factuur_id and f.nummer is null));
    return;
  end if;

  tekst := coalesce(nullif(btrim(kl.omschrijving), ''), 'Extra opdracht');

  -- Staat hij er al: bijwerken. Het btw-tarief van de regel zelf blijft staan,
  -- zodat een latere tariefwijziging een oude regel niet verandert.
  update public.factuurregels fr
    set datum = kl.gedaan_op,
        omschrijving = tekst,
        bedrag = prijs,
        bedrag_excl = public.factuur_excl(prijs, fr.btw_inclusief, fr.btw_procent)
    where fr.klus_id = kl_id
      and fr.deleted_at is null
      and fr.vervangen_op is null
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));

  -- Anders een nieuwe. De `not exists` blijft nodig: staat er een regel op een
  -- genummerde factuur, dan raakte de update hierboven niets en zou een insert
  -- op de ontdubbelindex klappen.
  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, klus_id, datum,
    omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    kl.company_id, k.id, kl.customer_id, 'klus', kl.id, kl.gedaan_op,
    tekst,
    prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  where not exists (
    select 1 from public.factuurregels fr
    where fr.klus_id = kl_id and fr.deleted_at is null and fr.vervangen_op is null
  );
end
$$;

revoke execute on function public.klus_factuurregel_bijwerken(uuid) from public, anon, authenticated;

create or replace function public.klus_factuurregel_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.klus_factuurregel_bijwerken(new.id);
  return new;
end
$$;

drop trigger if exists klussen_factuurregel on public.klussen;
create trigger klussen_factuurregel
  after update of gedaan_op, deleted_at, omschrijving, customer_id on public.klussen
  for each row execute function public.klus_factuurregel_bijhouden();

-- De prijs komt uit een eigen tabel en wordt vaak ná het afvinken ingevuld.
create or replace function public.klus_prijs_factuurregel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.klus_factuurregel_bijwerken(new.klus_id);
  return null;
end
$$;

drop trigger if exists klus_prijzen_factuurregel on public.klus_prijzen;
create trigger klus_prijzen_factuurregel
  after insert or update of prijs on public.klus_prijzen
  for each row execute function public.klus_prijs_factuurregel();

-- ---------------------------------------------------------------------
-- 2. "Prijs deze dag" bij een wasbeurt
-- ---------------------------------------------------------------------
create or replace function public.wasdag_prijs_factuurregel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dag date;
begin
  if tg_op = 'UPDATE' and new.prijs is not distinct from old.prijs then
    return null;
  end if;

  if new.prijs > 0 then
    update public.factuurregels fr
      set bedrag = new.prijs,
          bedrag_excl = public.factuur_excl(new.prijs, fr.btw_inclusief, fr.btw_procent)
      where fr.wasdag_regel_id = new.regel_id
        and fr.deleted_at is null
        and fr.vervangen_op is null
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f
                         where f.id = fr.factuur_id and f.nummer is null));
    if found then
      return null;
    end if;

    -- Nog geen regel: de beurt was gratis toen de dag werd afgemeld, en krijgt
    -- nu alsnog een prijs. `factuurregels_maken` kijkt zelf of de hele dag af
    -- is en slaat over wat er al staat, dus dit mag gewoon opnieuw.
    select r.datum into dag from public.wasdag_regels r where r.id = new.regel_id;
    if dag is not null and public.current_company_id() = new.company_id then
      perform public.factuurregels_maken(dag);
    end if;
    return null;
  end if;

  -- Terug naar nul: dan hoort er geen regel meer te zijn.
  delete from public.factuurregels fr
    where fr.wasdag_regel_id = new.regel_id
      and fr.vervangen_op is null
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));
  return null;
end
$$;

drop trigger if exists wasdag_prijzen_factuurregel on public.wasdag_prijzen;
create trigger wasdag_prijzen_factuurregel
  after update of prijs on public.wasdag_prijzen
  for each row execute function public.wasdag_prijs_factuurregel();
