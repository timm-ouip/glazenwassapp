-- Prijstabellen: de koppeling met adres, dagregel en klus als één-op-één.
--
-- De koppeling loopt over twee kolommen (id + bedrijf). De database-ingang
-- (PostgREST) ziet een koppeling alleen als één-op-één als precies die twee
-- kolommen samen uniek zijn; anders geeft een opvraag vanuit het adres een
-- lijstje terug in plaats van één prijs. Het id alleen was al uniek, dus dit
-- verandert niets aan de gegevens.
alter table public.adres_prijzen add constraint adres_prijzen_adres_bedrijf_uniek unique (customer_id, company_id);
alter table public.wasdag_prijzen add constraint wasdag_prijzen_regel_bedrijf_uniek unique (regel_id, company_id);
alter table public.klus_prijzen add constraint klus_prijzen_klus_bedrijf_uniek unique (klus_id, company_id);

notify pgrst, 'reload schema';
