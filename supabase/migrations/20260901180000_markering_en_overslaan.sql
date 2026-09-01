-- Drie dingen die bij een adres horen en op de printlijst uitkomen.
--
-- markering: waar je op moet letten. Geel is opletten, groen is nieuw. Leeg
--   is het gewone geval, en dat is verreweg het meeste.
-- overslaan: maanden ('jjjj-mm') waarin dit adres niet meegaat. Eén lijst,
--   want "t/m december" is gewoon alle maanden tot en met december erin.
-- start_maand: pas wassen vanaf deze maand ('jjjj-mm'). Voor een klant die
--   zich nu aanmeldt maar pas over twee maanden begint. Leeg = meteen.

alter table public.customers
  add column markering   text not null default '' check (markering in ('', 'geel', 'groen')),
  add column overslaan   text[] not null default '{}',
  add column start_maand text not null default '';
