/**
 * De aanmeldpagina: hier vult een klant zijn eigen gegevens in.
 *
 * Openbaar, geen inlog, en bewust kaal: één kaart op een telefoonscherm, want
 * hier komt iemand binnen via een QR-code op de bus of op een flyer. Geen
 * zijbalk, geen menu, niets om op te klikken behalve het formulier.
 *
 * De pagina zegt nooit of een adres bij dit bedrijf bekend is. Elke bezoeker
 * ziet hetzelfde formulier en hetzelfde bedankje; wat er achter gebeurt staat
 * in `aanmelden.functions.ts`. Zou de pagina dat verschil tonen, dan kon
 * iedereen met een postcodeboek de klantenlijst nalopen.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Check, Droplets, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { dienGegevensIn, haalAanmeldPagina } from "@/lib/aanmelden.functions";
import { zoekOpPostcode } from "@/lib/postcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/aanmelden")({
  validateSearch: (search: Record<string, unknown>): { c: string } => ({
    c: String(search["c"] ?? ""),
  }),
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: async ({ deps }) => {
    if (!deps.c) return { bedrijf: null };
    try {
      return await haalAanmeldPagina({ data: { token: deps.c } });
    } catch {
      // Onbekende of uitgezette link. Geen reden om te weten wélke van de
      // twee het is; de bezoeker kan er toch niets aan doen.
      return { bedrijf: null };
    }
  },
  head: () => ({
    meta: [
      { title: "Je gegevens doorgeven" },
      // Niet in Google: deze pagina is voor wie de QR-code heeft, en een
      // vindbaar formulier is een uitnodiging voor onzin.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AanmeldPagina,
});

/** Het veld waar de invoer in staat — dik genoeg voor een duim, en 16px zodat
 *  iOS niet inzoomt zodra je erin tikt. */
const veld = "h-12 rounded-xl text-base";

function AanmeldPagina() {
  const { bedrijf } = Route.useLoaderData();
  const { c: token } = Route.useSearch();

  const [stap, setStap] = useState<"adres" | "gegevens" | "klaar">("adres");
  const [postcode, setPostcode] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [straat, setStraat] = useState("");
  const [plaats, setPlaats] = useState("");
  const [zelf, setZelf] = useState(false);
  const [zoeken, setZoeken] = useState(false);

  const [naam, setNaam] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [email, setEmail] = useState("");
  const [bezig, setBezig] = useState(false);
  const val = useRef<HTMLInputElement>(null);

  if (!bedrijf) {
    return (
      <Omhulsel>
        <div className="px-6 py-10 text-center">
          <h1 className="font-display text-xl font-semibold">Deze link werkt niet meer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vraag je glazenwasser om een nieuwe link of QR-code.
          </p>
        </div>
      </Omhulsel>
    );
  }

  if (stap === "klaar") {
    return (
      <Omhulsel>
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-tint-groen">
            <Check className="size-7 text-tint-groen-ink" />
          </div>
          <h1 className="font-display text-xl font-semibold">Bedankt!</h1>
          <p className="mx-auto mt-2 max-w-[26ch] text-sm text-muted-foreground">
            We hebben je gegevens binnen. Klopt er iets niet, dan nemen we contact met je op.
          </p>
        </div>
      </Omhulsel>
    );
  }

  async function zoekAdres() {
    setZoeken(true);
    const treffer = await zoekOpPostcode(postcode, huisnummer);
    setZoeken(false);
    if (!treffer) {
      // Kan een typefout zijn, een adres dat niet in het Kadaster staat, of de
      // dienst die het even niet doet. In alle drie de gevallen: zelf invullen,
      // want doodlopen is geen optie.
      setZelf(true);
      toast.error("We konden dit adres niet vinden. Vul je straat en plaats zelf in.");
      return;
    }
    setStraat(treffer.straat);
    setPlaats(treffer.plaats);
    setPostcode(treffer.postcode);
  }

  async function versturen() {
    if (!naam.trim()) {
      toast.error("Vul je naam in.");
      return;
    }
    if (!telefoon.trim() && !email.trim()) {
      toast.error("Vul een telefoonnummer of een e-mailadres in, zodat we je kunnen bereiken.");
      return;
    }
    setBezig(true);
    try {
      await dienGegevensIn({
        data: {
          token,
          naam,
          email,
          telefoon,
          postcode,
          straat,
          huisnummer,
          plaats,
          val: val.current?.value ?? "",
        },
      });
      setStap("klaar");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Dit lukt nu niet. Probeer het later nog eens.",
      );
    } finally {
      setBezig(false);
    }
  }

  const adresGevonden = straat.trim() !== "" && (zelf ? plaats.trim() !== "" : true);

  return (
    <Omhulsel>
      <div className="border-b border-border bg-card-header px-6 py-5 text-center">
        <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
          <Droplets className="size-5" />
        </div>
        <h1 className="font-display text-lg font-semibold leading-tight">{bedrijf}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {stap === "adres"
            ? "Vul hier je adres in, dan weten we wie we bij je thuis wassen."
            : "En bij wie horen deze ruiten?"}
        </p>
      </div>

      <form
        className="space-y-5 px-6 py-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (stap === "adres") {
            if (adresGevonden) setStap("gegevens");
            else void zoekAdres();
          } else {
            void versturen();
          }
        }}
      >
        {/* Het lokkertje. Onzichtbaar voor een mens, dus wie het invult is een
            robot. Niet met display:none — dat valt te herkennen. */}
        <input
          ref={val}
          type="text"
          name="bedrijfsnaam"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute -left-[9999px] size-0 opacity-0"
        />

        {stap === "adres" ? (
          <>
            <div className="grid grid-cols-[1fr_112px] gap-3">
              <div className="space-y-2">
                <Label htmlFor="postcode">Postcode</Label>
                <Input
                  id="postcode"
                  className={veld}
                  autoComplete="postal-code"
                  placeholder="1234 AB"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="huisnummer">Huisnummer</Label>
                <Input
                  id="huisnummer"
                  className={veld}
                  inputMode="numeric"
                  autoComplete="address-line2"
                  placeholder="12"
                  value={huisnummer}
                  onChange={(e) => setHuisnummer(e.target.value)}
                />
              </div>
            </div>

            {zelf ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="straat">Straat</Label>
                  <Input
                    id="straat"
                    className={veld}
                    autoComplete="address-line1"
                    value={straat}
                    onChange={(e) => setStraat(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plaats">Plaats</Label>
                  <Input
                    id="plaats"
                    className={veld}
                    autoComplete="address-level2"
                    value={plaats}
                    onChange={(e) => setPlaats(e.target.value)}
                  />
                </div>
              </div>
            ) : straat ? (
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {straat} {huisnummer}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {postcode} {plaats}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-brand-ink hover:underline"
                  onClick={() => setZelf(true)}
                >
                  Klopt niet? Zelf invullen
                </button>
              </div>
            ) : null}

            <Button
              type="submit"
              className="h-12 w-full rounded-full bg-brand text-base text-brand-foreground hover:bg-brand/90"
              disabled={zoeken}
            >
              {zoeken ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Zoeken…
                </>
              ) : adresGevonden ? (
                "Verder"
              ) : (
                "Zoek mijn adres"
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
              <span className="font-medium">
                {straat} {huisnummer}
              </span>
              <span className="text-muted-foreground">
                {" · "}
                {postcode} {plaats}
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="naam">Naam</Label>
              <Input
                id="naam"
                className={veld}
                autoComplete="name"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefoon">Telefoonnummer</Label>
              <Input
                id="telefoon"
                className={veld}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mailadres</Label>
              <Input
                id="email"
                className={veld}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-full"
                onClick={() => setStap("adres")}
              >
                Terug
              </Button>
              <Button
                type="submit"
                className="h-12 flex-1 rounded-full bg-brand text-base text-brand-foreground hover:bg-brand/90"
                disabled={bezig}
              >
                {bezig ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Versturen…
                  </>
                ) : (
                  "Versturen"
                )}
              </Button>
            </div>
          </>
        )}
      </form>
    </Omhulsel>
  );
}

/** De kaart waar alles in staat, gecentreerd op een leeg vel. */
function Omhulsel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md overflow-hidden rounded-[22px] border border-border bg-card shadow-card">
        {children}
      </div>
    </div>
  );
}
