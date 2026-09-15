-- Twee keer per maand mag toch.
--
-- De vorige migratie liet een adres maar één keer per kalendermaand op de
-- planning. Dat klopt niet met hoe er gewerkt wordt: loopt een ronde uit, dan
-- wordt een adres op 1 september gewassen en eind september (als hij weer aan
-- de beurt is) nog eens; is een ronde vroeg klaar, dan begint de volgende al
-- op 30 oktober. De app vraagt nu als een adres binnen twee weken al op een
-- andere dag staat, in plaats van dat de database het weigert.
--
-- De functies wasdag_terugzetten en stoppen_terugdraaien houden
-- `on conflict do nothing`: dat blijft juist, alleen de dag-index doet nu nog mee.

drop index if exists public.wasdag_regels_een_per_maand;
