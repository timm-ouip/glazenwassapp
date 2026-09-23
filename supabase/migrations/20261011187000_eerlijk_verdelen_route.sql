-- ---------------------------------------------------------------------
-- Eerlijk verdelen volgt voortaan de looproute
-- ---------------------------------------------------------------------
-- Tot nu toe legde "Eerlijk verdelen" de grootste straat bij wie tot dan toe
-- het minst had. Qua aantallen eerlijk, maar iedereen kreeg zo straten door
-- de hele wijk heen en liep de avond kriskras.
--
-- Nu loopt de verdeling de wijk af in de volgorde van de wijkkaart — wijk,
-- dan het stuk van de wijk ("Fase A"), dan de straat — en knipt die rij in
-- net zoveel aaneengesloten stukken als er lopers zijn, elk met ongeveer
-- evenveel deuren. Iedereen houdt zo één aaneengesloten stuk.
--
-- Het gewicht van een straat is wat er die avond echt te doen is: een adres
-- telt mee als er geld open staat, er nog niets is ingetikt, en het niet nog
-- op de wasbeurt van deze maand wacht — dezelfde regel als "Samen nog te
-- gaan" op het overzicht. Het aantal adressen telt er duizendmaal lichter bij
-- op: dan blijft een avond waarop (nog) nergens iets open staat toch netjes
-- verdeeld, in plaats van dat de eerste loper de hele wijk krijgt.
--
-- Net als in 20261011185000: in één keer schoon en dan rechtstreeks
-- wegschrijven, zonder per straat een regel in het logboek. Dat logboek is
-- voor wat er 's avonds verandert, niet voor deze ene klik.

create or replace function public.geldloop_straten_eerlijk(vrijgave uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  mensen uuid[];
  hoeveel integer;
  route jsonb;
  totaal numeric := 0;
  doel numeric;
  gelopen numeric := 0;
  beurt integer := 1;
  r record;
  verdeeld integer := 0;
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not public.geldloop_loopt_voor_mij(vrijgave) then
    raise exception 'Je loopt deze avond niet, dus je kunt de straten niet verdelen.';
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into mensen
    from public.geldloop_vrijgave_lopers where vrijgave_id = v.id;
  hoeveel := coalesce(cardinality(mensen), 0);
  if hoeveel < 2 then
    raise exception 'Er loopt maar één iemand: er valt niets te verdelen.';
  end if;

  -- De straten van deze avond op een rij, in de volgorde van de wijkkaart,
  -- met per straat zijn gewicht. Straten zonder stuk staan achter de stukken
  -- van hun eigen wijk, net als op de wijkenpagina.
  with alle_adressen as (
    select array_agg(c.id) as ids
      from public.customers c
      join public.streets s on s.id = c.street_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
     where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null
  ),
  stand as (
    select * from public.geld_stand(bedrijf, coalesce((select ids from alle_adressen), '{}'))
  ),
  per_adres as (
    select
      c.street_id,
      (c.inactief_op is null) as actief,
      (
        st.open > 0.005
        and not exists (
          select 1 from public.betaal_gebeurtenissen g
           where g.customer_id = c.id and g.vrijgave_id = v.id
             and g.soort in ('betaald', 'niet_thuis', 'geen_geld')
             and not exists (select 1 from public.betaal_gebeurtenissen o
                              where o.herroept_id = g.id)
        )
        and not exists (
          select 1 from public.wasdag_regels wr
           where wr.customer_id = c.id and wr.company_id = bedrijf
             and date_trunc('month', wr.datum) = date_trunc('month', v.datum)
             and wr.gedaan_op is null
             and wr.niet_gewassen_op is null
        )
      ) as telt
      from stand st
      join public.customers c on c.id = st.customer_id
  ),
  per_straat as (
    select
      s.id,
      d.sort_order as wijk_sort,
      coalesce(g.sort_order, 1000000) as stuk_sort,
      s.sort_order as straat_sort,
      s.name as naam,
      count(*) filter (where a.telt) * 1000 + count(*) filter (where a.actief) as gewicht
      from public.streets s
      join public.districts d on d.id = s.district_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
      left join public.straat_groepen g on g.id = s.groep_id
      left join per_adres a on a.street_id = s.id
     where s.company_id = bedrijf and s.deleted_at is null
     group by s.id, d.sort_order, g.sort_order, s.sort_order, s.name
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', p.id, 'gewicht', p.gewicht)
                     order by p.wijk_sort, p.stuk_sort, p.straat_sort, p.naam),
           '[]'::jsonb)
    into route
    from per_straat p;

  select coalesce(sum((e ->> 'gewicht')::numeric), 0) into totaal
    from jsonb_array_elements(route) e;
  doel := case when totaal > 0 then totaal / hoeveel else 0 end;

  -- In één keer schoon, en daarna rechtstreeks wegschrijven: zo staat deze
  -- klik niet als dertig regels in het logboek van de avond.
  delete from public.geldloop_straat_lopers sl
    using public.streets s, public.geldloop_vrijgave_wijken w
    where sl.vrijgave_id = v.id and s.id = sl.street_id
      and w.vrijgave_id = v.id and w.district_id = s.district_id;

  for r in
    select (e ->> 'id')::uuid as id, (e ->> 'gewicht')::numeric as gewicht
      from jsonb_array_elements(route) e
  loop
    insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
      values (v.id, r.id, mensen[beurt], bedrijf);
    verdeeld := verdeeld + 1;
    gelopen := gelopen + r.gewicht;
    -- Zodra dit stuk zijn deel heeft, gaat de volgende loper verder waar
    -- deze ophoudt. Eén knip per loper: een enkele grote straat schuift dus
    -- niemand over.
    if beurt < hoeveel and doel > 0 and gelopen >= doel * beurt then
      beurt := beurt + 1;
    end if;
  end loop;

  return jsonb_build_object('straten', verdeeld, 'lopers', hoeveel);
end
$$;
revoke execute on function public.geldloop_straten_eerlijk(uuid) from public, anon;
grant execute on function public.geldloop_straten_eerlijk(uuid) to authenticated;
