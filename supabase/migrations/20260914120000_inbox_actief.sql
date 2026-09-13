-- Het antwoordadres pas gebruiken als het postvak werkelijk openstaat.
--
-- Een aankondiging krijgt als antwoordadres antwoord+<token>@<inbox-domein>.
-- Staat dat domein nog niet goed in de DNS, of is de koppeling bij Brevo nog
-- niet gemaakt, dan komt het antwoord van de klant nergens aan — hij krijgt
-- een foutmelding terug, en jij hoort er nooit iets van. Erger dan geen
-- postvak.
--
-- Daarom een vlag per bedrijf. De knop "Postvak koppelen" zet hem pas aan
-- nadat hij heeft nagekeken dat de post aankomt; tot die tijd gaan antwoorden
-- gewoon naar de afzender, zoals altijd.
alter table public.companies
  add column if not exists mail_inbox_actief boolean not null default false;
