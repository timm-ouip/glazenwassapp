-- Een invul-linkje hoort bij een klant van hetzelfde bedrijf.
--
-- klant_links.klant_id verwees alleen naar klanten(id). Wie bij bedrijf A
-- klanten mag bewerken, kon zo via de API een linkje maken voor het id van
-- een klant van bedrijf B (set_company_id zet het linkje dan op A, en de RLS
-- kijkt alleen naar het linkje), en de invulfunctie zocht de klant alleen op
-- id. Nu dwingt de verwijzing (klant_id, company_id) af dat het bedrijf
-- klopt, en controleert de functie het zelf ook.

alter table public.klant_links drop constraint if exists klant_links_klant_id_fkey;
alter table public.klant_links
  add constraint klant_links_klant_bedrijf_fkey
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade;

create or replace function public.klant_vult_gegevens_in(sleutel text, velden jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.klant_links;
  k public.klanten;
  huidig jsonb;
  veld text;
  nieuw text;
  na jsonb := '{}'::jsonb;
begin
  select * into l
    from public.klant_links
    where token = sleutel and geldig_tot > now() and aantal < 30
    for update;
  if not found then
    return false;
  end if;
  select * into k
    from public.klanten
    where id = l.klant_id and company_id = l.company_id and deleted_at is null
    for update;
  if not found then
    return false;
  end if;
  update public.klant_links set aantal = aantal + 1 where klant_id = l.klant_id;

  huidig := to_jsonb(k);
  foreach veld in array array['naam', 'telefoon', 'telefoon2', 'email', 'email2'] loop
    continue when not (velden ? veld);
    nieuw := left(btrim(coalesce(velden ->> veld, '')), 160);
    -- Een naam laat je niet leeg: dan heet de klant in de lijst niets meer.
    continue when veld = 'naam' and nieuw = '';
    continue when nieuw = coalesce(huidig ->> veld, '');
    na := na || jsonb_build_object(veld, nieuw);
  end loop;
  if na = '{}'::jsonb then
    return true;
  end if;
  -- Ook na samenvoegen nog ergens te bereiken.
  if coalesce(na ->> 'telefoon', k.telefoon, '') = '' and coalesce(na ->> 'email', k.email, '') = '' then
    return false;
  end if;

  perform set_config('wooshy.door_klant', '1', true);
  update public.klanten set
    naam = coalesce(na ->> 'naam', naam),
    telefoon = coalesce(na ->> 'telefoon', telefoon),
    telefoon2 = coalesce(na ->> 'telefoon2', telefoon2),
    email = coalesce(na ->> 'email', email),
    email2 = coalesce(na ->> 'email2', email2)
  where id = k.id and company_id = k.company_id;
  perform set_config('wooshy.door_klant', '', true);
  return true;
end
$$;
revoke execute on function public.klant_vult_gegevens_in(text, jsonb) from public, anon, authenticated;
grant execute on function public.klant_vult_gegevens_in(text, jsonb) to service_role;
