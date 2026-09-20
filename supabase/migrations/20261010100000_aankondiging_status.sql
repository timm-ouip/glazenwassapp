-- Per adres zien of het planningsbericht verstuurd is en aankwam.
--
-- Tot nu toe wist de app alleen dát er een aankondiging de deur uit ging, met
-- de adressen als platte tekst en zonder wat Brevo er daarna nog over zei.
-- Nu bewaart de server per bericht welke adressen erin stonden (en welk
-- tijdvak er beloofd is), en houdt hij de afleverstatus bij.
--
-- "Geopend" doen we niet: daarvoor is een volgpixel nodig, en die valt onder
-- de cookieregels (toestemming van de klant). "Afgeleverd" is een melding van
-- de mailserver en mag wel. Voor WhatsApp gebruiken we de vinkjes die de
-- klant zelf aan heeft staan.

alter table public.mailingen
  add column soort text not null default 'aankondiging'
    check (soort in ('aankondiging', 'wijziging', 'niet_af'));

alter table public.mail_ontvangers
  -- Het kenmerk van Brevo (of van WhatsApp), om een latere melding terug te
  -- vinden bij de juiste ontvanger.
  add column message_id text not null default '',
  add column wa_id text not null default '',
  -- Leeg zolang er niets terugkwam. 'mislukt' staat al in status.
  add column bezorgstatus text not null default ''
    check (bezorgstatus in ('', 'afgeleverd', 'gelezen', 'vertraagd', 'gebounced', 'geblokkeerd', 'ongeldig', 'spam')),
  add column status_op timestamptz;

create index mail_ontvangers_message_idx
  on public.mail_ontvangers (message_id) where message_id <> '';
create index mail_ontvangers_wa_idx
  on public.mail_ontvangers (wa_id) where wa_id <> '';

-- Welke adressen er in een bericht stonden, en wat er beloofd is.
create table public.aankondiging_adressen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ontvanger_id uuid not null references public.mail_ontvangers(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  -- De dag waarvoor het bericht ging (bij een wijziging: de nieuwe dag).
  datum date not null,
  -- Het beloofde tijdvak, als dat in het bericht stond.
  tijdvak_van time,
  tijdvak_tot time,
  soort text not null default 'aankondiging'
    check (soort in ('aankondiging', 'wijziging', 'niet_af')),
  created_at timestamptz not null default now()
);
create index aankondiging_adressen_adres_idx
  on public.aankondiging_adressen (company_id, customer_id, datum);
create index aankondiging_adressen_ontvanger_idx
  on public.aankondiging_adressen (ontvanger_id);

-- Alleen de server schrijft; lezen gaat via de functie hieronder.
alter table public.aankondiging_adressen enable row level security;
revoke all on public.aankondiging_adressen from anon, authenticated;
create policy "Lezen met recht" on public.aankondiging_adressen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (public.heeft_recht('mail_lezen') or public.heeft_recht('mail_versturen'))
  );
create trigger aankondiging_adressen_set_company_id before insert on public.aankondiging_adressen
  for each row execute function public.set_company_id();

/**
 * Wat er per adres verstuurd is in een periode: de laatste zending per adres
 * en kanaal, met de dag waarvoor hij ging, het beloofde tijdvak en hoe het
 * afliep. De planning gebruikt dit voor het envelopje.
 */
create or replace function public.aankondigingen_voor(vanaf date, tot date)
returns table (
  customer_id uuid,
  kanaal text,
  soort text,
  aangekondigd_voor date,
  tijdvak_van time,
  tijdvak_tot time,
  status text,
  bezorgstatus text,
  verstuurd_op timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (aa.customer_id, o.kanaal)
    aa.customer_id,
    o.kanaal,
    aa.soort,
    aa.datum,
    aa.tijdvak_van,
    aa.tijdvak_tot,
    o.status,
    o.bezorgstatus,
    o.created_at
  from public.aankondiging_adressen aa
  join public.mail_ontvangers o on o.id = aa.ontvanger_id
  join public.mailingen m on m.id = o.mailing_id
  where aa.company_id = public.current_company_id()
    and (
      public.heeft_recht('planning')
      or public.heeft_recht('mail_lezen')
      or public.heeft_recht('mail_versturen')
    )
    and not m.test
    -- Ruimer dan de gevraagde periode: een adres dat voor dinsdag was
    -- aangekondigd en nu op donderdag staat, moet je juist zien (oranje).
    and aa.datum between (vanaf - 14) and (tot + 14)
  order by aa.customer_id, o.kanaal, o.created_at desc
$$;

revoke all on function public.aankondigingen_voor(date, date) from public, anon;
grant execute on function public.aankondigingen_voor(date, date) to authenticated;
