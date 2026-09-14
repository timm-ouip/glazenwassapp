-- Ook de verzendpogingen horen bij een bedrijf, net als elke andere tabel.
--
-- Bewust zonder policy, net als mailbox_geheimen: alleen de Edge Function
-- `mail-acties` schrijft en telt hier, met de service role. Komt er ooit een
-- scherm bij dat dit wil lezen, dan kan de policy op company_id filteren.
alter table public.mail_verzendpogingen
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- De tabel is nog leeg (net aangemaakt); voor de zekerheid toch invullen.
update public.mail_verzendpogingen p
  set company_id = m.company_id
  from public.mailboxen m
  where p.mailbox_id = m.id and p.company_id is null;

alter table public.mail_verzendpogingen
  alter column company_id set not null;

create trigger mail_verzendpogingen_set_company_id before insert on public.mail_verzendpogingen
  for each row execute function public.set_company_id();
