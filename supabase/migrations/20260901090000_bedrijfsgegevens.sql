-- Bedrijfsgegevens: alles wat je op een printlijst of factuur kwijt wilt.
-- Lege strings als standaard, net als employees.naam, zodat het formulier
-- nergens op null hoeft te controleren.

alter table public.companies
  add column adres    text not null default '',
  add column postcode text not null default '',
  add column plaats   text not null default '',
  add column telefoon text not null default '',
  add column email    text not null default '',
  add column kvk      text not null default '',
  add column btw      text not null default '',
  add column iban     text not null default '';

-- De policies die dit nodig heeft bestaan al sinds het multi-tenant schema:
-- "Zie eigen bedrijf" (select) en "Eigenaar wijzigt bedrijf" (update).
