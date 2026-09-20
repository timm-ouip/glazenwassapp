-- Postcodes die al in de database stonden één keer netjes schrijven:
-- vier cijfers, een spatie, twee hoofdletters. Vanaf nu doet de app dat bij
-- het opslaan zelf (src/lib/schoonschrift.ts), maar wat er vóór die tijd
-- ingetypt of ingelezen is, staat er nog zoals het kwam ("2562xc").
--
-- Alleen wat er echt op een Nederlandse postcode lijkt. Staat er iets anders
-- (een Belgische postcode, een half ingevulde), dan blijft dat staan: dan is
-- het beter dat het opvalt dan dat wij er iets van maken.

update customers
set postcode =
  substr(upper(replace(postcode, ' ', '')), 1, 4) || ' ' ||
  substr(upper(replace(postcode, ' ', '')), 5, 2)
where postcode is not null
  and replace(postcode, ' ', '') ~* '^[0-9]{4}[a-z]{2}$'
  and postcode !~ '^[0-9]{4} [A-Z]{2}$';

update klanten
set postcode =
  substr(upper(replace(postcode, ' ', '')), 1, 4) || ' ' ||
  substr(upper(replace(postcode, ' ', '')), 5, 2)
where postcode is not null
  and replace(postcode, ' ', '') ~* '^[0-9]{4}[a-z]{2}$'
  and postcode !~ '^[0-9]{4} [A-Z]{2}$';
