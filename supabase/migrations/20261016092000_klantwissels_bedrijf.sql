-- De vaste regel voor elke tabel: RLS, een policy op het bedrijf, én de
-- trigger die het bedrijf invult. adres_klantwissels (uit
-- 20261016091000_vooruit_betalen_herstel.sql) miste die laatste. Nu vult de
-- trigger op customers het bedrijf zelf in, maar schrijft er later iets
-- anders in, dan is dit het vangnet.
create trigger adres_klantwissels_set_company_id before insert on public.adres_klantwissels
  for each row execute function public.set_company_id();
