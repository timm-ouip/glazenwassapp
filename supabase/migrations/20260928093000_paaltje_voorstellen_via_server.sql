-- Voorstellen van Paaltje alleen via de server lezen.
--
-- In een voorstel staan prijzen (oud, nieuw, en de waarde vlak voor het
-- doorvoeren). Een rij kan niet half verborgen worden, dus las iemand met
-- "klanten bewerken" maar zonder "prijzen zien" die bedragen gewoon uit de
-- tabel. De Edge Function `paaltje-chat` (actie `lees_voorstellen`) geeft ze
-- nu terug en laat prijzen weg voor wie ze niet mag zien.
drop policy if exists "Voorstellen van Paaltje lezen" on public.paaltje_voorstellen;

-- Vangrail zoals bij de andere tabellen: schrijft later ooit de app zelf,
-- dan komt het bedrijf er vanzelf op.
create trigger paaltje_berichten_set_company_id before insert on public.paaltje_berichten
  for each row execute function public.set_company_id();
create trigger paaltje_voorstellen_set_company_id before insert on public.paaltje_voorstellen
  for each row execute function public.set_company_id();
create trigger paaltje_verbruik_set_company_id before insert on public.paaltje_verbruik
  for each row execute function public.set_company_id();
