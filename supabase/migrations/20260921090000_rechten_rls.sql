-- Fase 5, stap C: wat iemand mag, dwingt de database af.
--
-- Tot nu toe mocht iedereen van een bedrijf alles (behalve de mail, die was
-- van de eigenaar). Nu per recht uit zijn rol (heeft_recht; de eigenaar mag
-- altijd alles):
--
--   planning           wijken, straten, de planning, en adressen bijwerken
--                      (kleur, overslaan, volgorde)
--   klanten_bekijken   klanten en hun adressen zien
--   klanten_bewerken   klanten en adressen maken, wijzigen, weggooien;
--                      aanmeldingen
--   mail_lezen         het postvak, de mailbox, de categorieën
--   mail_versturen     aankondigingen en wat er verstuurd is
--   (eigenaar)         rapport, dagrapport, afspraken van Paaltje,
--                      bedrijfsgegevens, rollen
--
-- Prijzen staan sinds stap B in eigen tabellen met het recht prijzen_zien.

-- Eén hulpje om per tabel vier regels neer te zetten. Leeg = geen regel (dan
-- mag het niemand via de app). Het bedrijf komt er altijd bij.
create or replace function pg_temp.regels(
  tabel text,
  lezen text,
  maken text,
  wijzigen text,
  weggooien text
)
returns void
language plpgsql
as $$
declare
  bedrijf constant text := '(company_id = (select public.current_company_id()))';
begin
  if lezen is not null then
    execute format('create policy "Lezen met recht" on public.%I for select to authenticated using (%s and (%s))',
      tabel, bedrijf, lezen);
  end if;
  if maken is not null then
    execute format('create policy "Maken met recht" on public.%I for insert to authenticated with check (%s and (%s))',
      tabel, bedrijf, maken);
  end if;
  if wijzigen is not null then
    execute format('create policy "Wijzigen met recht" on public.%I for update to authenticated using (%s and (%s)) with check (%s and (%s))',
      tabel, bedrijf, wijzigen, bedrijf, wijzigen);
  end if;
  if weggooien is not null then
    execute format('create policy "Weggooien met recht" on public.%I for delete to authenticated using (%s and (%s))',
      tabel, bedrijf, weggooien);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- De oude regels weg
-- ---------------------------------------------------------------------
drop policy if exists "Bedrijf beheert eigen klanten" on public.customers;
drop policy if exists "Bedrijf beheert eigen klantgegevens" on public.klanten;
drop policy if exists "Bedrijf beheert eigen klantmailadressen" on public.klant_emails;
drop policy if exists "Bedrijf beheert eigen aanmeldingen" on public.aanmeldingen;
drop policy if exists "Bedrijf beheert eigen wijken" on public.districts;
drop policy if exists "Bedrijf beheert eigen straten" on public.streets;
drop policy if exists "Bedrijf beheert eigen straatgroepen" on public.straat_groepen;
drop policy if exists "Bedrijf beheert eigen markeringen" on public.markeringen;
drop policy if exists "Bedrijf beheert eigen wasdagen" on public.wasdag_regels;
drop policy if exists "Bedrijf beheert eigen klussen" on public.klussen;
drop policy if exists "Bedrijf beheert eigen mailantwoorden" on public.mail_antwoorden;
drop policy if exists "Eigenaar ziet eigen berichten" on public.berichten;
drop policy if exists "Eigenaar beheert categorieen van berichten" on public.bericht_categorieen;
drop policy if exists "Eigenaar ziet eigen categorieen" on public.mail_categorieen;
drop policy if exists "Eigenaar ziet eigen mappen" on public.mail_mappen;
drop policy if exists "Eigenaar ziet eigen mailbox" on public.mailboxen;
drop policy if exists "Bedrijf ziet eigen mailingen" on public.mailingen;
drop policy if exists "Bedrijf ziet eigen ontvangers" on public.mail_ontvangers;

-- ---------------------------------------------------------------------
-- De nieuwe regels
-- ---------------------------------------------------------------------
-- Adressen: wie plant, werkt ze bij (kleur, overslaan, volgorde); wie klanten
-- bewerkt, maakt ze en gooit ze weg (weggooien is in de app bijwerken van
-- deleted_at, echt wissen gebeurt vanuit de prullenbak).
select pg_temp.regels('customers',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$);

-- Klantgegevens. De wijklijst toont namen, dus planning mag ze lezen.
select pg_temp.regels('klanten',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$);

select pg_temp.regels('klant_emails',
  $r$(select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken')) or (select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$);

select pg_temp.regels('aanmeldingen',
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('klanten_bewerken'))$r$);

-- Wijken en straten ziet iedereen van het bedrijf (ze geven een adres zijn
-- naam). Een klant invoeren of importeren kan een wijk of straat aanmaken,
-- dus dat mag ook wie klanten bewerkt.
select pg_temp.regels('districts',
  'true',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning'))$r$);

select pg_temp.regels('streets',
  'true',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning'))$r$);

select pg_temp.regels('straat_groepen',
  'true',
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning'))$r$);

select pg_temp.regels('markeringen',
  'true',
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning'))$r$);

-- De planning. Een klant laten stoppen kan dagen van de planning halen (en
-- ongedaan maken zet ze terug), dus dat mag ook wie klanten bewerkt.
select pg_temp.regels('wasdag_regels',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$);

select pg_temp.regels('klussen',
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$,
  $r$(select public.heeft_recht('planning')) or (select public.heeft_recht('klanten_bewerken'))$r$);

-- Mail. Lezen en indelen met mail_lezen; instellingen, rapport en afspraken
-- blijven bij de eigenaar (hun regels staan al en blijven).
select pg_temp.regels('berichten',
  $r$(select public.heeft_recht('mail_lezen'))$r$, null, null, null);
select pg_temp.regels('mail_mappen',
  $r$(select public.heeft_recht('mail_lezen'))$r$, null, null, null);
select pg_temp.regels('mailboxen',
  $r$(select public.heeft_recht('mail_lezen'))$r$, null, null, null);
select pg_temp.regels('mail_categorieen',
  $r$(select public.heeft_recht('mail_lezen'))$r$, null, null, null);
select pg_temp.regels('bericht_categorieen',
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$);
select pg_temp.regels('mail_antwoorden',
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$,
  $r$(select public.heeft_recht('mail_lezen'))$r$);
select pg_temp.regels('mailingen',
  $r$(select public.heeft_recht('mail_lezen')) or (select public.heeft_recht('mail_versturen'))$r$, null, null, null);
select pg_temp.regels('mail_ontvangers',
  $r$(select public.heeft_recht('mail_lezen')) or (select public.heeft_recht('mail_versturen'))$r$, null, null, null);

-- De indeling van een mail aanpassen: wie mail leest, niet alleen de eigenaar.
create or replace function public.zet_bericht_categorieen(bericht uuid, categorieen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('mail_lezen') then
    raise exception 'Je mag de indeling van mail niet aanpassen.';
  end if;
  if not exists (select 1 from public.berichten where id = bericht and company_id = bedrijf) then
    raise exception 'Die mail bestaat niet.';
  end if;
  -- Leest Paaltje hem net, dan zou hij zijn eigen indeling erbij zetten.
  if exists (select 1 from public.berichten where id = bericht and paaltje_status = 'bezig') then
    raise exception 'Paaltje leest deze mail net. Probeer het zo nog eens.';
  end if;
  delete from public.bericht_categorieen where bericht_id = bericht;
  insert into public.bericht_categorieen (bericht_id, categorie_id, company_id, door)
    select bericht, c.id, bedrijf, 'mens'
    from public.mail_categorieen c
    where c.id = any(categorieen) and c.company_id = bedrijf and c.deleted_at is null;
  update public.berichten set indeling_door_mens = true where id = bericht;
end
$$;

-- ---------------------------------------------------------------------
-- Wat "planning" aan een adres mag
--
-- Een regel in de database kan niet per kolom kiezen. Deze trigger doet dat
-- wel: wie planning heeft maar geen klanten bewerkt, mag kleur, overslaan,
-- volgorde, notities en ritme aanpassen, maar niet weggooien, laten stoppen,
-- van klant wisselen of het huisnummer veranderen. De server (Paaltje,
-- aanmeldingen) en de eigenaar mogen alles.
-- ---------------------------------------------------------------------
create or replace function public.adres_wijziging_controleren()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_company_id() is null then
    return new;
  end if;
  if (new.deleted_at, new.inactief_op, new.inactief_reden, new.klant_id, new.house_number, new.addition)
     is distinct from
     (old.deleted_at, old.inactief_op, old.inactief_reden, old.klant_id, old.house_number, old.addition)
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen of van klant wisselen.';
  end if;
  return new;
end
$$;

create trigger customers_wijziging_controleren before update on public.customers
  for each row execute function public.adres_wijziging_controleren();
