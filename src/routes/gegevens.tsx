/**
 * De invulpagina voor één klant: zijn eigen naam, telefoon en e-mail.
 *
 * Openbaar, geen inlog. Je komt hier via het linkje uit het dossier ("Linkje
 * voor de klant"), dat 7 dagen werkt. Bewust kaal, net als /aanmelden: één
 * kaart, alleen deze vijf velden. De rest van het dossier (adres, prijzen,
 * notities, geschiedenis) bestaat op deze pagina niet; wat er wel komt, staat
 * in `klantgegevens.functions.ts`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  IconCheck as Check,
  IconDroplets as Droplets,
  IconLoader2 as Loader2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bewaarGegevensPagina,
  haalGegevensPagina,
  type InvulGegevens,
} from "@/lib/klantgegevens.functions";

export const Route = createFileRoute("/gegevens")({
  validateSearch: (search: Record<string, unknown>): { t: string } => ({
    t: String(search["t"] ?? ""),
  }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ deps }) => {
    if (!deps.t) return null;
    try {
      return await haalGegevensPagina({ data: { token: deps.t } });
    } catch {
      // Een storing, geen kapot linkje: dan ook niet "vraag een nieuwe".
      return "storing" as const;
    }
  },
  head: () => ({
    meta: [
      { title: "Je gegevens" },
      { name: "robots", content: "noindex, nofollow" },
      // Het linkje is geheim; niet doorgeven aan een site waar je hiervandaan heen klikt.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: GegevensPagina,
});

/** Dik genoeg voor een duim, en 16px zodat iOS niet inzoomt. */
const veld = "h-12 rounded-xl text-base";

function GegevensPagina() {
  const geladen = Route.useLoaderData();
  const pagina = geladen === "storing" ? null : geladen;
  const { t: token } = Route.useSearch();
  const [g, setG] = useState<InvulGegevens>(
    pagina?.gegevens ?? { naam: "", telefoon: "", telefoon2: "", email: "", email2: "" },
  );
  // Wat er stond toen de pagina openging: alleen wat daarvan afwijkt gaat mee.
  const [begin, setBegin] = useState<InvulGegevens>(g);
  const [klaar, setKlaar] = useState(false);
  const [bezig, setBezig] = useState(false);
  const val = useRef<HTMLInputElement>(null);

  if (geladen === "storing") {
    return (
      <Omhulsel>
        <div className="px-6 py-10 text-center">
          <h1 className="font-display text-xl font-semibold">Even geen verbinding</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Probeer het over een paar minuten nog eens met hetzelfde linkje.
          </p>
        </div>
      </Omhulsel>
    );
  }

  if (!pagina) {
    return (
      <Omhulsel>
        <div className="px-6 py-10 text-center">
          <h1 className="font-display text-xl font-semibold">Deze link werkt niet meer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vraag je glazenwasser om een nieuwe link.
          </p>
        </div>
      </Omhulsel>
    );
  }

  if (klaar) {
    return (
      <Omhulsel>
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-tint-groen">
            <Check className="size-7 text-tint-groen-ink" />
          </div>
          <h1 className="font-display text-xl font-semibold">Bedankt!</h1>
          <p className="mx-auto mt-2 max-w-[26ch] text-sm text-muted-foreground">
            Je gegevens zijn bijgewerkt. Je kunt dit venster nu sluiten.
          </p>
          <button
            type="button"
            className="mt-4 text-sm font-medium text-brand-ink hover:underline"
            onClick={() => setKlaar(false)}
          >
            Nog iets aanpassen
          </button>
        </div>
      </Omhulsel>
    );
  }

  async function versturen() {
    if (!g.naam.trim()) {
      toast.error("Vul je naam in.");
      return;
    }
    if (!g.telefoon.trim() && !g.email.trim()) {
      toast.error("Vul een telefoonnummer of een e-mailadres in, zodat we je kunnen bereiken.");
      return;
    }
    setBezig(true);
    try {
      await bewaarGegevensPagina({
        data: { token, gegevens: g, begin, val: val.current?.value ?? "" },
      });
      setBegin(g);
      setKlaar(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Dit lukt nu niet. Probeer het later nog eens.",
      );
    } finally {
      setBezig(false);
    }
  }

  const zet = (k: keyof InvulGegevens) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setG((oud) => ({ ...oud, [k]: e.target.value }));

  return (
    <Omhulsel>
      <div className="border-b border-border bg-card-header px-6 py-5 text-center">
        <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
          <Droplets className="size-5" />
        </div>
        <h1 className="font-display text-lg font-semibold leading-tight">{pagina.bedrijf}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kloppen je gegevens? Vul aan of verbeter wat niet klopt.
        </p>
      </div>

      <form
        className="space-y-5 px-6 py-6"
        onSubmit={(e) => {
          e.preventDefault();
          void versturen();
        }}
      >
        {/* Het lokkertje: onzichtbaar voor een mens. */}
        <input
          ref={val}
          type="text"
          name="bedrijfsnaam"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute -left-[9999px] size-0 opacity-0"
        />

        <div className="space-y-2">
          <Label htmlFor="naam">Naam</Label>
          <Input
            id="naam"
            className={veld}
            autoComplete="name"
            value={g.naam}
            onChange={zet("naam")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telefoon">Telefoonnummer</Label>
            <Input
              id="telefoon"
              className={veld}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={g.telefoon}
              onChange={zet("telefoon")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefoon2">Tweede telefoon (optioneel)</Label>
            <Input
              id="telefoon2"
              className={veld}
              type="tel"
              inputMode="tel"
              value={g.telefoon2}
              onChange={zet("telefoon2")}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mailadres</Label>
          <Input
            id="email"
            className={veld}
            type="email"
            autoComplete="email"
            value={g.email}
            onChange={zet("email")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email2">Tweede e-mailadres (optioneel)</Label>
          <Input
            id="email2"
            className={veld}
            type="email"
            value={g.email2}
            onChange={zet("email2")}
          />
        </div>

        <Button
          type="submit"
          className="h-12 w-full rounded-full bg-brand text-base text-brand-foreground hover:bg-brand/90"
          disabled={bezig}
        >
          {bezig ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Opslaan…
            </>
          ) : (
            "Opslaan"
          )}
        </Button>
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
