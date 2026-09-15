# Overdracht Wooshy — stand 15 september 2026

Stuur dit bestand mee in een nieuw gesprek. Alles hieronder staat live en is
gecommit op `main` (laatste commit: `7c8ee94`), tenzij anders vermeld.

## Werkwijze (belangrijk voor de volgende sessie)

- **Timmie codeert niet:** leg uit in gewone taal, kom zelf met voorstellen, en vraag alleen naar echte keuzes.
- **Na elke codewijziging** laat je de subagent `code-reviewer` meekijken (zie `CLAUDE.md`), los je echte punten op en vertel je Timmie wat hij vond.
- **Bouwen, controleren en uitrollen:**
  - Bouwen: `/Users/Timmie/.bun/bin/bun run --bun build`.
  - Typecheck: `/Users/Timmie/.bun/bin/bunx --bun tsc --noEmit -p tsconfig.json`.
  - App live zetten: `script -q /dev/null /Users/Timmie/.bun/bin/bunx --bun wrangler@4.120.0 deploy -c .output/server/wrangler.json`.
  - Draai de deploy op de achtergrond met log naar een bestand. Het log kapt vaak af, dus controleer met `wrangler deployments list`.
  - Live: https://timm-ouip-glazenwassapp.wasapp.workers.dev
- **Supabase** (project `wvpvluidfanfagvoiywc`):
  - Migraties doorzetten: `supabase db push --linked --yes`.
  - Een functie uitrollen: `supabase functions deploy <naam> --use-api`.
  - Proefruns in SQL doe je in een `do $proef$ … raise exception 'PROEF %' …` blok. Dan draait alles terug.
- **Scripts die bestanden aanpassen:** gebruik `s.replace(oud, () => nieuw)`, anders wordt `$$` in SQL `$`.
- **Geen geheimen uitlezen of printen.** Wachtwoorden (mailbox, Mijndomein, Brevo) vult Timmie zelf in.
- **Het echte bedrijf is "De Ramensopperij"** (inlog `info@deramensopperij.nl`). "Wassersapp beta" (`meneertimmie@hotmail.com`) is een testbedrijf. Alle klanten zijn nog testdata; laat ze staan.
- **Geheugen:** meer achtergrond staat in `~/.claude/projects/-Users-Timmie-Glazenwassapp/memory/`, vooral `mailbox-plan-paaltje.md`, `stoppen-is-inactief.md` en `echt-bedrijf-ramensopperij.md`.

## Wat er gebouwd is

### Complete mailbox met Paaltje (fases 0–4 en 6)
- **Mailbox:** Mijndomein via IMAP, elke 2 minuten opgehaald (`mail-ophalen`). Het Postvak in Wooshy toont 3 kolommen met een klantkaart. Lezen, weggooien, beantwoorden en nieuwe mail versturen gaat via SMTP (`mail-acties`).
- **Paaltje (`paaltje-lezen`, AI):**
  - deelt alle mail in (categorieën per bedrijf, meerdere per mail, "Overige post" voor mail die niet van klanten komt);
  - zet antwoorden klaar en doet voorstellen (overslaan, stoppen, aanmelding, klant koppelen);
  - leert van verstuurde antwoorden en stelt vaste afspraken voor;
  - stuurt zelf een bevestiging als hij overslaan zelf doorvoert.
- **Rapport en dagrapport:** het Rapport (terugdraaien) en het dagrapport om 06:30, per mail en als pagina.
- **Aankondigingen:** gaan via Brevo (`mail-versturen`). Antwoorden komen in de eigen mailbox.
  - Er is een proefmail naar een zelfgekozen adres, met een rem van 10 per uur.
  - Een afzender mag alleen versturen vanaf het domein van de gekoppelde mailbox.
- **DNS deramensopperij.nl:** SPF bevat `include:spf.brevo.com`, en `brevo-code`, DKIM en DMARC staan goed.
- **Fase 6, opgeruimd:** de oude Brevo-inbound (functie `mail-inbox`, tabel `mail_antwoorden`, tabblad Antwoorden, oude assistent). Er is een backup in schema `backup_fase6`.

### Klant stopt = inactief
- **Stoppen:** met de rechtermuisknop kies je "Klant stopt…", of je klikt op het prullenbakje. Je kiest dan "Verhuisd", "Andere reden", "Annuleren" of "Verwijderen" (voor een fout of een testadres).
- **Verhuisd:** de klantgegevens gaan naar de prullenbak, de woning (prijs, notities) blijft bewaard.
- **Andere reden:** alles blijft bewaard.
- **Planning:** staan er nog wasdagen, dan komt de vraag of die van de planning af moeten. Vandaag blijft altijd staan.
- **Terugvinden:** op de klantenpagina staat een filter "Inactief" met een knop "Weer actief".
- **Bekend adres:** een aanmelding op een inactief adres wordt soort `bekend_adres`, met een voorstel op basis van de oude gegevens.
- **Planning, dagpagina en printlijst:** herkennen gestopte adressen met een label.

### Rollen en rechten (fase 5, stap A–D)
- **Rollen:** de eigenaar maakt rollen met vinkjes (Instellingen → Team). Rechten zijn `planning`, `klanten_bekijken`, `klanten_bewerken`, `prijzen_zien`, `mail_lezen`, `mail_versturen` en `instellingen_team`. De eigenaar mag alles.
- **De database dwingt alles af (RLS via `heeft_recht()`):**
  - wie alleen "planning" heeft, mag een adres niet weggooien, laten stoppen of van klant wisselen;
  - serverfuncties controleren per actie.
- **Prijzen:** staan alleen nog in `adres_prijzen`, `wasdag_prijzen` en `klus_prijzen`. De oude prijskolommen zijn weg.
  - Zonder `prijzen_zien` is er nergens een bedrag te zien.
  - Nieuwe adressen en wasdagen krijgen vanzelf een prijsregel; een wasdag krijgt een momentopname.
- **App:** pagina's zonder recht tonen "Geen toegang"; menu, tabbladen, bewerkvelden en knoppen volgen de rechten. Het klantdossier is alleen-lezen zonder `klanten_bewerken`.
- **Keuzes van Timmie:**
  - Medewerkers met "mail lezen" mogen prijzen in Paaltjes concepten zien.
  - Verschuiven op de planning houdt de aangepaste dagprijs (`verplaatsWasdag`).
  - Ongedaan maken van leegmaken, inplannen en verplaatsen zet de dag terug met zijn bedrag (`wasdag_weghalen` / `wasdag_terugzetten`).
- **Medewerkers uitnodigen kan nu veilig.**

## Wat er nog moet gebeuren

1. **Timmie zelf:** in het Brevo-account een eventuele inbound-doorsturing naar Wooshy uitzetten. De functie `mail-inbox` bestaat niet meer.
2. **Klein, nog niet gebouwd:**
   - **Klus toevoegen met alleen "planning":** in het klantdossier lukt dat niet (alleen-lezen zonder `klanten_bewerken`), via het menu op de wijklijst en de klantenpagina wel. Kan anders als Timmie dat wil.
   - **Weekenddagen bij opschuiven:** vrijdag, zaterdag en zondag schuiven alle drie naar maandag. Staat een adres op twee van die dagen, dan blijft er één over.
3. **Later opruimen:**
   - de kolom `mail_wijzigingen.antwoord_id` en de index daarop;
   - de backup-schema's `backup_fase5` en `backup_fase6`, als alles een tijd goed draait.
4. **Nog niet in de browser getest door Claude.** Het browservenster mocht de live site niet openen. Laat Timmie de nieuwe schermen een keer doorlopen:
   - het filter Inactief;
   - het stopvenster;
   - Instellingen → Team → Rollen;
   - een testmedewerker met beperkte rechten.

## Ideeën die al eerder genoemd zijn (niet ingepland)
- **Een eigen categorie "Facturen":** er komt mail over facturen binnen in de categorie Overig.
- **Het echte klantenbestand importeren**, als Timmie zover is.
