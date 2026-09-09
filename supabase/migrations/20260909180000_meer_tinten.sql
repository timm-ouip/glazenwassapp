-- Vier kleuren erbij om een markering mee te maken.
--
-- De eerste vier (geel, groen, paars, blauw) bleken te weinig om een wijk mee
-- te ordenen. Deze vier liggen er ver genoeg vandaan op de kleurencirkel om
-- ze náást elkaar in één lijst nog uit elkaar te houden, en ze hebben net als
-- de andere een lichte en een donkere variant in het ontwerp staan.
--
-- Rood blijft ontbreken: dat betekent "deze maand overgeslagen".

alter table public.markeringen drop constraint markeringen_tint_check;

alter table public.markeringen add constraint markeringen_tint_check
  check (tint in ('amber', 'oranje', 'roze', 'paars', 'blauw', 'turkoois', 'groen', 'limoen'));
