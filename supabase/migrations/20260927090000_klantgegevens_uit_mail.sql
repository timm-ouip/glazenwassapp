-- Klantgegevens uit mail.
--
-- Paaltje haalt naam, adres en telefoon uit een klantmail. Herkent Wooshy
-- daarmee een klant, dan koppelt hij het mailadres en vult hij lege velden
-- aan. Wat hij deed staat per mail in `berichten.klantgegevens`, zodat het
-- rechts naast de mail te zien is en ongedaan gemaakt kan worden.
--
-- Een klant kan nu twee mailadressen en twee telefoonnummers hebben: vaak
-- mailen of appen de man én de vrouw.

alter table public.klanten
  add column if not exists email2 text not null default '',
  add column if not exists telefoon2 text not null default '';

-- Niet in `voorstel`: een gevuld voorstel zet een mail in "Wacht op jou".
alter table public.berichten
  add column if not exists klantgegevens jsonb not null default '{}';

--   klant   = het adres dat op de klant zelf staat (houdt zich vanzelf bij)
--   mens    = iemand koppelde het met de hand
--   paaltje = Wooshy herkende de klant aan telefoon of adres en koppelde het
alter table public.klant_emails drop constraint if exists klant_emails_bron_check;
alter table public.klant_emails
  add constraint klant_emails_bron_check check (bron in ('klant', 'mens', 'paaltje'));

-- Beide mailadressen op de klant houden zich bij.
create or replace function public.klant_emails_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  adres text;
begin
  delete from public.klant_emails where klant_id = new.id and bron = 'klant';
  foreach adres in array array[new.email, new.email2] loop
    if trim(coalesce(adres, '')) <> '' then
      insert into public.klant_emails (company_id, klant_id, email, bron)
      values (new.company_id, new.id, lower(trim(adres)), 'klant')
      -- Een koppeling van een mens blijft van een mens: gaat het vak later weer
      -- leeg (bijvoorbeeld bij Ongedaan maken), dan blijft zijn koppeling staan.
      -- Een koppeling van Wooshy wordt het adres van de klant zelf.
      on conflict (company_id, klant_id, email) do update
        set bron = case when klant_emails.bron = 'mens' then 'mens' else 'klant' end;
    end if;
  end loop;
  return new;
end
$$;

revoke execute on function public.klant_emails_bijhouden() from public, anon, authenticated;

drop trigger if exists klanten_emails_bijhouden on public.klanten;
create trigger klanten_emails_bijhouden
  after insert or update of email, email2 on public.klanten
  for each row execute function public.klant_emails_bijhouden();
