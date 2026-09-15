-- Fase 6: de oude route voor antwoorden op aankondigingen opruimen.
--
-- Vroeger kwamen antwoorden binnen via Brevo (edge function mail-inbox) en
-- stonden ze in mail_antwoorden. Nu leest Wooshy de echte mailbox (berichten,
-- Postvak, Paaltje) en gaan antwoorden naar het eigen adres. De oude tabel en
-- de instellingen ervan zijn niet meer nodig.
--
-- Eerst een kopie, buiten het bereik van de app: het testbedrijf had er nog
-- één antwoord in staan.

create schema if not exists backup_fase6;
revoke all on schema backup_fase6 from public, anon, authenticated;

create table backup_fase6.mail_antwoorden as select * from public.mail_antwoorden;
create table backup_fase6.companies_mailroute as
  select id, mail_token, mail_inbox_actief, mail_auto_doorvoeren, now() as bewaard_op
  from public.companies;

-- Rapportregels van toen wijzen nog naar een oud antwoord. De koppeling gaat
-- weg; de regel zelf (en wat er gebeurde) blijft staan in het rapport.
do $$
declare
  k record;
begin
  for k in
    select c.conname, c.conrelid::regclass::text as tabel
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.mail_antwoorden'::regclass
  loop
    execute format('alter table %s drop constraint %I', k.tabel, k.conname);
  end loop;
end
$$;

drop table public.mail_antwoorden;

alter table public.companies
  drop column if exists mail_token,
  drop column if exists mail_inbox_actief,
  drop column if exists mail_auto_doorvoeren;
