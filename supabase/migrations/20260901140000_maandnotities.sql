-- Werk dat maar in de ene maand hoort: een klant wordt elke maand gewassen,
-- maar in de even maand gaat de serre mee. Dat past niet in één notitie,
-- want op de printlijst van een oneven maand hoort de serre er niet te staan.
--
-- De gewone notitie blijft wat er élke keer geldt; deze twee komen daar
-- bovenop in de maand waar ze bij horen.

alter table public.customers
  add column note_even   text not null default '',
  add column note_oneven text not null default '';
