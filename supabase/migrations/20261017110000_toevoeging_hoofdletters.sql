-- Een toevoeging bij een huisnummer staat officieel in hoofdletters: 12A, niet
-- 12a (zo schrijft het BAG het ook). Dit doet de database zelf, zodat het ook
-- klopt voor een import, Paaltje en een aanmelding — niet alleen voor wat er in
-- het scherm getypt wordt. Een lege toevoeging blijft '' (de kolom is not null).

create or replace function public.customers_toevoeging_hoofdletters()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.addition := upper(btrim(new.addition));
  return new;
end
$$;

create trigger customers_toevoeging_hoofdletters
  before insert or update of addition on public.customers
  for each row execute function public.customers_toevoeging_hoofdletters();

-- Wat er al staat, één keer rechtzetten: alleen de rijen die er echt van
-- veranderen.
--
-- Dit legt geen geschiedenis vast en maakt geen meldingen: het wijzigingslog
-- (customers_wijzigingen) kijkt alleen naar frequentie, notitie, prijs en
-- dergelijke, en gaat bij een andere toevoeging dus al niet af. Voor de
-- zekerheid staat het log toch uit (wooshy.geen_log, alleen binnen deze
-- migratie). De controle op wie een huisnummer mag wijzigen
-- (customers_wijziging_controleren) slaat zichzelf over zonder bedrijf, en de
-- vooruitbetaal-bewaker (customers_vooruit_bewaken) doet niets zolang
-- betaalmethode en straat gelijk blijven.
select set_config('wooshy.geen_log', '1', true);

update public.customers
  set addition = upper(btrim(addition))
  where addition is distinct from upper(btrim(addition));
