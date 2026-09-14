-- Paaltje stelt vaste afspraken voor als je zijn concept flink aanpaste.
--
-- Per beantwoorde mail kijkt hij één keer; deze kolom onthoudt dat. Oude mail
-- die al beantwoord was telt als bekeken: hij leert van wat vanaf nu weggaat,
-- anders komt er in één keer een stapel voorstellen.

alter table public.berichten add column afspraak_bekeken_op timestamptz;

update public.berichten
set afspraak_bekeken_op = now()
where beantwoord_op is not null;

create index berichten_afspraak_te_bekijken_idx
  on public.berichten (beantwoord_op desc)
  where afspraak_bekeken_op is null and beantwoord_op is not null;
