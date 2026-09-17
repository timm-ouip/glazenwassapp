/**
 * Het privacybeleid van Wooshy. Openbaar, zonder inlog: Meta vraagt dit adres
 * voor de WhatsApp-koppeling, en klanten moeten het kunnen lezen. Het anker
 * #gegevens-verwijderen is de uitleg die Meta vraagt voor het wissen van
 * gegevens.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacybeleid — Wooshy" },
      {
        name: "description",
        content:
          "Hoe Wooshy en De Ramensopperij omgaan met klantgegevens, mail en WhatsApp-berichten.",
      },
    ],
  }),
  component: Privacy,
});

const BIJGEWERKT = "16 september 2026";
const CONTACT = "info@deramensopperij.nl";

function Privacy() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:py-16">
      <article className="mx-auto flex max-w-[68ch] flex-col gap-8 text-[15px] leading-relaxed">
        <header className="flex flex-col gap-2">
          <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Wooshy · De Ramensopperij
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.02em]">Privacybeleid</h1>
          <p className="text-muted-foreground">Bijgewerkt op {BIJGEWERKT}.</p>
        </header>

        <Blok titel="Wie zijn wij">
          <p>
            Wooshy is de planningsapp van glazenwassersbedrijf De Ramensopperij. Bedrijven die
            Wooshy gebruiken, plannen er hun werk mee en houden er contact mee met hun klanten, per
            mail en per WhatsApp. Het bedrijf waarvan jij klant bent, is verantwoordelijk voor jouw
            gegevens; De Ramensopperij levert en beheert de app.
          </p>
          <p>
            Vragen over je gegevens? Mail naar{" "}
            <a className="underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>
            .
          </p>
        </Blok>

        <Blok titel="Welke gegevens">
          <ul className="list-disc space-y-1 pl-5">
            <li>Naam, adres, postcode, telefoonnummers en mailadressen van klanten.</li>
            <li>Wanneer we komen, wat we wassen, afspraken en prijzen.</li>
            <li>
              Mail en WhatsApp-berichten die je met het bedrijf uitwisselt, inclusief foto's en
              spraakberichten die je meestuurt.
            </li>
            <li>Klachten en notities over het werk.</li>
            <li>Van medewerkers: naam, mailadres en wat ze in de app mogen.</li>
          </ul>
        </Blok>

        <Blok titel="Waarvoor">
          <ul className="list-disc space-y-1 pl-5">
            <li>Het werk plannen en uitvoeren, en je laten weten wanneer we komen.</li>
            <li>Je berichten beantwoorden en je verzoeken verwerken, zoals een keer overslaan.</li>
            <li>Facturen en de administratie.</li>
          </ul>
          <p>We verkopen je gegevens niet en gebruiken ze niet voor reclame van anderen.</p>
        </Blok>

        <Blok titel="Paaltje, de digitale assistent">
          <p>
            Wooshy heeft een digitale assistent, Paaltje. Die leest binnenkomende berichten, deelt
            ze in (bijvoorbeeld een verzoek om over te slaan) en kan een antwoord voorstellen of
            versturen. Nu doet hij dat bij mail; WhatsApp-berichten gaat hij binnenkort ook lezen.
            Daarvoor gaan de tekst van je bericht en de gegevens die nodig zijn om te antwoorden
            naar een AI-dienst (Anthropic). Die gebruikt ze alleen om het antwoord te maken, niet om
            zijn modellen te trainen. Je kunt altijd een mens spreken: zeg het in je bericht, of bel
            of mail het bedrijf.
          </p>
        </Blok>

        <Blok titel="WhatsApp">
          <p>
            Berichten via WhatsApp lopen via het WhatsApp Business Platform van Meta, en via Kapso,
            een partner van Meta die ons nummer aan Wooshy koppelt. Stuur je ons
            een bericht, dan gebruiken we je nummer om je te antwoorden. Foto's en spraakberichten
            die je meestuurt, bewaren we bij je berichten. Wil je geen WhatsApp-berichten meer van
            ons, laat het ons weten (bijvoorbeeld door <strong>stop</strong> te sturen); dan
            gebruiken we voortaan mail.
          </p>
        </Blok>

        <Blok titel="Wie helpt ons daarbij">
          <p>We werken met deze diensten, die je gegevens alleen voor ons verwerken:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Supabase — de database en opslag van Wooshy.</li>
            <li>Cloudflare — het online zetten van de app.</li>
            <li>Meta (WhatsApp Business Platform) — WhatsApp-berichten.</li>
            <li>
              Kapso — de koppeling tussen WhatsApp en Wooshy. Kapso zit in de Verenigde Staten; je
              WhatsApp-berichten gaan daarom ook via servers daar.
            </li>
            <li>Anthropic — de AI achter Paaltje.</li>
            <li>Brevo en onze mailprovider — het versturen en ontvangen van mail.</li>
            <li>
              PDOK (Kadaster) — postcodes en straatnamen opzoeken; daarvoor gaat alleen een adres
              mee.
            </li>
          </ul>
        </Blok>

        <Blok titel="Hoe lang">
          <p>
            We bewaren je gegevens zolang je klant bent, en daarna zolang de wet dat vraagt voor de
            administratie (meestal 7 jaar voor facturen). Berichten en klantgegevens die daar niet
            voor nodig zijn, wissen we op verzoek eerder.
          </p>
        </Blok>

        <Blok titel="Je rechten" id="gegevens-verwijderen">
          <p>
            Je mag inzien welke gegevens we van je hebben, ze laten verbeteren, of ze laten
            verwijderen. Ook kun je bezwaar maken tegen het gebruik ervan.
          </p>
          <p className="font-medium">Gegevens laten verwijderen</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Mail naar{" "}
              <a className="underline" href={`mailto:${CONTACT}`}>
                {CONTACT}
              </a>{" "}
              met als onderwerp "Gegevens verwijderen", en noem je naam, adres en het telefoonnummer
              of mailadres waarmee je contact had.
            </li>
            <li>We bevestigen binnen een week dat we je verzoek hebben ontvangen.</li>
            <li>
              Binnen een maand wissen we je gegevens, je berichten en de bewaarde foto's en
              spraakberichten, behalve wat we voor de administratie moeten bewaren. Dat laten we je
              weten.
            </li>
          </ol>
          <p>
            Ben je het niet eens met hoe we met je gegevens omgaan, dan kun je een klacht indienen
            bij de Autoriteit Persoonsgegevens.
          </p>
        </Blok>
      </article>
    </main>
  );
}

function Blok({ titel, id, children }: { titel: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-2.5">
      <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">{titel}</h2>
      {children}
    </section>
  );
}
