# Overdracht WhatsApp in Wooshy — stand 16 september 2026

Stuur dit bestand mee in een nieuw gesprek. Alles hieronder staat live en is
gecommit op `main` (laatste commit: `039172a`), tenzij anders vermeld.

**Volgende stap: de koppeling met Kapso bouwen (zie "Nu doen: Kapso").**

## Werkwijze (zelfde als `docs/overdracht-2026-09-15.md`)

- **Timmie codeert niet:** leg het uit in gewone taal en kom zelf met voorstellen. Stel vragen klikbaar (AskUserQuestion) en alleen bij echte keuzes.
- **Na elke codewijziging:** de subagent `code-reviewer` laten meekijken (zie `CLAUDE.md`), echte punten oplossen en Timmie vertellen wat hij vond.
- **Typecheck app:** `/Users/Timmie/.bun/bin/bunx tsc --noEmit -p .`
- **Typecheck functions:** `DENO_DIR=<scratchpad>/deno /Users/Timmie/.bun/bin/bunx deno check --node-modules-dir=none supabase/functions/<naam>/index.ts`. Daarna `deno.lock` in de repo weggooien.
  - Deze fouten waren er al en komen niet van jou: `geheim.ts` (Uint8Array), `smtp.ts`, `acties.ts:~123/216`, `mailwerk.ts` (bestemming), `dagrapport/index.ts`, `opmaken.ts`, `mail-versturen/index.ts` (SupabaseClient-type bij `klantenVoorDag`/`telDekking`).
- **Migraties:** `supabase db push --yes`. Na een migratie de typen in `src/integrations/supabase/types.ts` **met de hand** bijwerken (niet opnieuw genereren).
- **Functies uitrollen:** `supabase functions deploy <naam> --use-api`. Rol ook elke functie opnieuw uit die een gewijzigd `_gedeeld`-bestand importeert.
- **App bouwen en live zetten:**
  1. `/Users/Timmie/.bun/bin/bun run --bun build`
  2. `PATH=/Users/Timmie/.bun/bin:$PATH script -q <log> bunx --bun wrangler@4.120.0 deploy -c .output/server/wrangler.json`
  3. Controleer met `curl` of een nieuwe asset-file 200 geeft op https://timm-ouip-glazenwassapp.wasapp.workers.dev
- **Geen geheimen uitlezen of printen.** Sleutels zet Timmie zelf met `supabase secrets set …`.
- **Klanten zijn testdata; laat ze staan.**
  - "De Ramensopperij" is het echte bedrijf; de browser in de app is daar ingelogd.
- **Achtergrond staat in het geheugen:** `memory/whatsapp-plan.md` (alle keuzes en de stand per fase).
- **Rapport voor Timmie:** https://claude.ai/artifact/MrkaYXQxuDmVgpmK3XiY3i (werk het bij na elke stap).

## Gemaakte keuzes (grill-sessie, samengevat)

- **Nummer:** blijft in de WhatsApp Business-app (coexistence). Eén nummer per bedrijf. Timmie en straks zijn broer (eigen bedrijf in Wooshy) koppelen elk hun eigen nummer.
- **Paaltje voert zelf door** bij een nummer dat zeker bij een klant hoort (geel + Ongedaan maken).
- **Paaltje antwoordt zelf** per categorie (standaard: overslaan en "Vragen over planning").
  - Wachttijd 10 min, alleen van 07:00 tot 21:00.
  - Geen ondertekening.
  - Nooit aan niet-klanten.
- **Media:** alleen tonen. Oude chats worden opgehaald, maar Paaltje doet er niets mee.
- **Aankondigingen:** per aankondiging kies je "zoals bij de klant ingesteld", mail, WhatsApp of beide. Toestemming van bestaande klanten gaat in één keer, met Ongedaan maken.
- **"Stop"** zet WhatsApp uit voor die klant. Alleen de eigenaar zet het weer aan (in de interface; de database laat `klanten_bewerken` het nog toe).
- **Rechten:** gelijk aan mail (`mail_lezen` en `mail_versturen`).
- **Route: Kapso** (kapso.com), níet zelf Tech Provider en níet Twilio.
  - **Waarom:** Kapso is Meta-partner, ondersteunt coexistence en koppelt via zijn eigen Meta-app, dus er is geen App Review nodig. Twilio rekent bovenop Meta en kan geen coexistence.
  - **Prijs:** gratis abonnement is 1 nummer en 2.000 berichten per maand. Pro is $25 per maand voor 3 nummers en 100.000 berichten; inkomend telt mee.
  - **Meta-kosten** laat je Meta rechtstreeks afschrijven (`meta_billing_mode: customer_managed`); via Kapso betalen kost +5%.
  - **Nog onzeker:**
    - coexistence voor +31 is niet officieel bevestigd, dus eerst testen;
    - de data staan in de VS (vraag de DPA op, zet de bewaartermijn kort);
    - het 5- of 20-berichten-per-seconde-limiet bij coexistence;
    - of de ruwe Meta-webhook echoes en history doorstuurt.

## Wat er staat (fase 1–4, live)

**Database** (`supabase/migrations/2026100{1,2,3,4}090000_*.sql`)
- **`berichten`** is kanaalloos.
  - Kolommen: `kanaal` ('mail'|'whatsapp'), `wa_id` (uniek met company_id), `wa_telefoon` ("316…"), `wa_sleutel` (gegenereerd, "06…"), `wa_type`, `wa_status`, `media` jsonb, `bron` (klant/app/wooshy/paaltje/geschiedenis).
  - Ingepland antwoord: `wa_antwoord_op`, `wa_antwoord_status`, `wa_antwoord_reden`, `wa_antwoord_direct`.
  - Alle mailqueries filteren expliciet op `kanaal='mail'`.
- **`klant_telefoons`** koppelt klanten op nummer, net als `klant_emails`. Trigger op `klanten.telefoon/telefoon2`; `telefoon_sleutel()` en `enige_klant_bij_telefoon()`.
- **`whatsapp_koppelingen`** (per bedrijf): `waba_id`, `phone_number_id`, `weergavenummer`, `soort` test/app, `status`, `paaltje_vanaf`. Het token staat versleuteld in **`whatsapp_geheimen`**.
- **Storage-bucket `whatsapp-media`:** paden `<bedrijf>/<bericht>/<id>.<ext>`, alleen bekende mime-types.
- **`mail_categorieen`:** nieuw zijn `zelf_antwoorden_whatsapp` en de categorie `planning`.
- **`companies`:** `wa_wachttijd_min`, `wa_antwoord_van`, `wa_antwoord_tot`.
- **`klanten`:** `wa_afgemeld_op`, `kanaal_voorkeur`, `wa_toestemming_op`, `wa_toestemming_bron`, `wa_marketing_op`.
- **`mail_wijzigingen.soort`:** nieuw zijn `whatsapp_afgemeld` en `whatsapp_antwoord`.
- **`wa_sjablonen`:** titel, meta_naam, meta_id, categorie utility/marketing, tekst met {naam}/{datum}/{adres}, variabelen, status.
- **`mailingen`:** `kanaal`, `sjabloon_id`, `aantal_whatsapp`. **`mail_ontvangers`:** `kanaal`, `telefoon`.
- **RPC's:** `whatsapp_gesprekken`, `wa_toestemming_bestaande_klanten(+_terug)`, `wa_toestemming_telling`.
- **Cron** `whatsapp-planner`: elke minuut.

**Edge functions**
- **`_gedeeld/whatsapp.ts`:**
  - Webhook: handtekening, `leesWijziging`.
  - Aanroepen: `graph()` (Meta-basis-URL `https://graph.facebook.com/v23.0`, Bearer-token), `tokenVan`.
  - Media en versturen: `haalMediaBinnen`, `verstuurTekst`, `verstuurSjabloon`.
  - Tijden: `binnenAntwoordtijd` (NL-tijd), `annuleerGeplandeAntwoorden`.
  - Sjablonen en nummers: `sjabloonVoorMeta`, `vulSjabloonIn`, `SJABLOON_STATUS`, `datumVoluit`, `mobielAlsWa`.
- **`whatsapp-webhook`** (verify_jwt=false):
  - Controleert `X-Hub-Signature-256` met `WHATSAPP_APP_SECRET`, en GET met `WHATSAPP_VERIFY_TOKEN` (staat).
  - Verwerkt `messages`, `statuses`, `smb_message_echoes` (annuleert Paaltjes antwoord), `history` en sjabloonstatussen.
  - Zet `paaltje_status='wacht'` vanaf `paaltje_vanaf` en haalt media binnen.
- **`whatsapp`** (ingelogd):
  - Beheer: `test_instellen`, `ontkoppelen`, `gelezen`.
  - Versturen en media: `versturen` (binnen 24 uur, 20 per minuut), `media_ophalen`.
  - Paaltjes ingeplande antwoord: `antwoord_annuleren`, `antwoord_nu`.
  - Sjablonen: `sjabloon_maken/verversen/weg/voorbeeld/versturen`.
- **`paaltje-lezen`:**
  - Mail zoals voorheen, plus een WhatsApp-ronde per gesprek: 45 s rust, eerdere berichtjes gelezen als één beurt.
  - `planWhatsAppAntwoord`, `zetWhatsAppUit`, `nummerZeker`, `klantAfgemeld`.
  - Bij WhatsApp géén letterlijke voorbeelden uit andere gesprekken in de prompt, en mogelijke klanten zonder prijs of planning.
- **`whatsapp-planner`:** verstuurt ingeplande antwoorden, met controles op nieuw bericht, al geantwoord, tijden en 24 uur.
- **`mail-versturen`:** aankondigingen per kanaal (`klantenVoorDag`, `verdeel`), WhatsApp-proef naar een 06-nummer.
- **`_gedeeld/dagrapport.ts`:** `whatsappDeel`.

**Scherm**
- **Mailing:**
  - Tab WhatsApp (`components/whatsapp/WhatsAppGesprekken.tsx` en `Chat.tsx`): chat, antwoordveld, media en PaaltjeStrook.
  - Opstellen: kanaal, sjabloon, proefnummer.
  - Rapport: `whatsapp_afgemeld`.
  - Dagrapport.
- **Instellingen → mail → WhatsApp** (`WhatsAppInstellingen.tsx`): koppelen met het testnummer (nummer-ID, account-ID, token), wachttijd/tijden, sjablonen en toestemming (`Sjablonen.tsx`).
- **Paaltje: categorieën:** vinkje "WhatsApp zelf".
- **Klantdossier:** de tab heet nu "Berichten": mail plus `DossierWhatsApp` (voorkeur/toestemming, chat, eerste bericht via sjabloon).
- **`/privacy`:** openbaar, met `#gegevens-verwijderen`. Eerste opzet, laten nakijken. **Kapso als verwerker (VS) moet er nog in.**

**Nog nooit echt getest met WhatsApp.** Alleen de parsers, tijdberekening, sjabloonomzetting, tellingen en webhook-beveiliging zijn getest.

## Nu doen: Kapso instellen

### Wat Timmie doet
1. Kapso-account aanmaken (gratis abonnement), en bij de start **"Connect WhatsApp for customers"** kiezen.
2. Een API-sleutel aanmaken en die zelf op de server zetten: `supabase secrets set KAPSO_API_KEY=…`
3. **Zijn eigen nummer nog níet koppelen.** Na het koppelen worden zijn uitzendlijsten in de app alleen-lezen, en hij wil pas overstappen als alles klaar is. Advies: test met een prepaid-simkaart met WhatsApp Business.

### Wat jij bouwt (eerst de Kapso-docs nalezen, niets aannemen)
- **Docs:** https://docs.kapso.ai (API-intro, platform/customer-guide, setup-links, webhooks, message-events, meta-message-billing, coexistence-troubleshooting).
- **Aanbieder per koppeling:** kolom `aanbieder` ('meta'|'kapso') op `whatsapp_koppelingen`, plus `kapso_customer_id`.
  - `graph()` krijgt een variant voor Kapso: basis `https://api.kapso.ai/meta/whatsapp/v24.0/...` met `X-API-Key: KAPSO_API_KEY`.
  - Geen token per bedrijf; controleer hoe Kapso per nummer autoriseert.
  - Alle aanroepen (versturen, sjablonen, media) gaan via die ene helper.
- **Koppelen per bedrijf** (eigenaar, in Instellingen):
  1. Kapso-customer aanmaken voor het bedrijf.
  2. Setup link maken (`POST /platform/v1/customers/{id}/setup_links`) met `allowed_connection_types` coexistence en `meta_billing_mode: customer_managed`.
  3. Timmie via de link laten koppelen.
  4. Daarna `phone_number_id`, `waba_id` en het weergavenummer ophalen en in `whatsapp_koppelingen` zetten (via redirect of webhook; zie de docs).
  - De huidige handmatige testnummer-koppeling mag blijven voor Meta direct.
- **Webhooks:**
  - Kies het Kapso-formaat, met handtekening `X-Webhook-Signature` (HMAC-SHA256, eigen secret `KAPSO_WEBHOOK_SECRET`, dat Timmie zet).
  - Of kies het Meta-formaat; dat heeft géén Meta-handtekening, dus dan een eigen geheim in de URL of kop.
  - Vertaal naar dezelfde rijen als `leesWijziging`:
    - `origin: business_app` → bron `app` (annuleert Paaltjes antwoord, zet `beantwoord_op`);
    - `history_sync` → bron `geschiedenis`;
    - statussen, en media via Kapso's `media_url`/`media_download` naar de bucket.
  - Let op: Kapso probeert maar 3 keer (na 10 en 40 seconden). Antwoord dus snel en maak het idempotent (de unieke index op `wa_id` doet dat al).
  - Webhook per nummer/customer registreren via de API, bij het koppelen.
- **Sjablonen:** via de Kapso-proxy, dezelfde vorm. Controleer ook de statusmeldingen van sjablonen.
- **Privacypagina:** Kapso toevoegen als verwerker, met verwerking in de VS.
- **Rapport en geheugen** bijwerken. Code-reviewer, uitrollen en committen zoals altijd.

## Kleine open punten
- **Statusmelding te vroeg:** "afgeleverd/gelezen" die binnenkomt vóórdat een verstuurd bericht is opgeslagen, gaat verloren. Dat is geaccepteerd.
- **Tarieven:** Meta's tarieven vanaf oktober 2026 nagaan; volgens derden worden service-berichten dan mogelijk betaald.
- **Verwerkersovereenkomst:** DPA en subprocessorlijst van Kapso opvragen (legal@kap.so) en een korte bewaartermijn instellen.
