-- Een straat kan bovenaan een printkolom beginnen.
--
-- De printlijst is één doorlopende volgorde; waar een kolom afbreekt bepaalt
-- de indeling zelf, op hoogte. Daardoor is "zet deze straat bovenaan die
-- kolom" niet uit te drukken: staat hij in de volgorde al vlak vóór de
-- bovenste straat van die kolom, dan valt er niets te verschuiven en blijft
-- hij onderaan de kolom ernaast staan.
--
-- Deze vlag is die ontbrekende informatie: bij het indelen begint een straat
-- met `kolom_start` altijd aan een nieuwe kolom.

alter table public.streets add column if not exists kolom_start boolean not null default false;
