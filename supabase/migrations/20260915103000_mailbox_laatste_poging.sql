-- Wanneer er voor het laatst geprobeerd is op te halen, gelukt of niet.
--
-- De klok neemt de mailbox die het langst niet aan de beurt was eerst. Op
-- `laatste_sync` sorteren (alleen geslaagde rondes) zou een mailbox die steeds
-- misgaat eeuwig vooraan zetten, ten koste van de rest.
alter table public.mailboxen
  add column if not exists laatste_poging timestamptz;
