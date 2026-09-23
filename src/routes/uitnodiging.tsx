import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Woordmerk } from "@/components/Merk";
import { useAuth } from "@/lib/auth";
import {
  accepteerUitnodiging,
  bekijkUitnodiging,
  completeInvite,
  stuurInloglink,
} from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/uitnodiging")({
  // De link uit de eigen uitnodigingsmail draagt id en code. Een link uit de
  // standaardmail van Supabase heeft ze niet; die zet zelf een sessie neer.
  validateSearch: (search: Record<string, unknown>): { id?: string; code?: string } => ({
    ...(typeof search["id"] === "string" ? { id: search["id"] } : {}),
    ...(typeof search["code"] === "string" ? { code: search["code"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Uitnodiging accepteren — Paaltje Systems" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UitnodigingPagina,
});

/** Zelfde sleutel als de loginpagina: daar staat je adres dan al ingevuld. */
const ONTHOUDEN_SLEUTEL = "glazenwas.laatste-email";

type Stand =
  | { soort: "laden" }
  /** Eigen uitnodiging met een geldige code. `bestaand`: dit adres heeft al
   *  een account, en logt in met het eigen wachtwoord. */
  | { soort: "code"; email: string; bedrijf: string; bestaand: boolean }
  /** Link uit de standaardmail van Supabase: er is al een sessie. */
  | { soort: "sessie" }
  | { soort: "fout"; uitleg: string; inloggen?: boolean };

function UitnodigingPagina() {
  const navigate = useNavigate();
  const { refreshEmployee } = useAuth();
  const { id, code } = Route.useSearch();
  const [stand, setStand] = useState<Stand>({ soort: "laden" });
  const [naam, setNaam] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);
  const [linkGestuurd, setLinkGestuurd] = useState(false);
  const bestaand = stand.soort === "code" && stand.bestaand;

  useEffect(() => {
    let actief = true;
    if (id && code) {
      bekijkUitnodiging({ data: { id, code } })
        .then((u) => {
          if (!actief) return;
          setStand(
            u.status === "geldig"
              ? { soort: "code", email: u.email, bedrijf: u.bedrijf, bestaand: u.bestaand }
              : { soort: "fout", uitleg: u.uitleg, inloggen: u.status === "gebruikt" },
          );
        })
        .catch(() => {
          if (actief) {
            setStand({
              soort: "fout",
              uitleg: "De uitnodiging kon even niet gecontroleerd worden. Probeer het zo nog eens.",
            });
          }
        });
    } else {
      // De Supabase-client herkent de uitnodigingstoken automatisch in de URL
      // en zet die om in een (tijdelijke) sessie zodra de pagina laadt.
      void supabase.auth.getSession().then(({ data }) => {
        if (!actief) return;
        setStand(
          data.session
            ? { soort: "sessie" }
            : {
                soort: "fout",
                uitleg:
                  "Deze uitnodigingslink is ongeldig of verlopen. Vraag de eigenaar om een nieuwe uitnodiging.",
              },
        );
      });
    }
    return () => {
      actief = false;
    };
  }, [id, code]);

  async function afronden() {
    if (!naam.trim() || (bestaand ? !wachtwoord : wachtwoord.length < 6)) {
      toast.error(
        bestaand
          ? "Vul je naam en je wachtwoord in."
          : "Vul je naam in en kies een wachtwoord van minimaal 6 tekens.",
      );
      return;
    }
    setBezig(true);
    try {
      if (stand.soort === "code" && stand.bestaand) await metEigenWachtwoord(stand.email);
      else if (stand.soort === "code" && id && code) await metCode(id, code, stand.email);
      else await metSessie();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBezig(false);
      return;
    }
    await refreshEmployee();
    setBezig(false);
    toast.success(
      stand.soort === "code" && stand.bedrijf
        ? `Welkom bij ${stand.bedrijf}!`
        : "Welkom bij het team!",
    );
    void navigate({ to: "/home" });
  }

  /** Eigen uitnodiging: de server zet het wachtwoord en het lidmaatschap, daarna gewoon inloggen. */
  async function metCode(id: string, code: string, email: string) {
    try {
      await accepteerUitnodiging({ data: { id, code, naam: naam.trim(), wachtwoord } });
    } catch (err) {
      throw new Error(
        "Account afronden mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: wachtwoord });
    if (error) {
      throw new Error(
        `Je account staat klaar, maar inloggen lukte niet: ${error.message}. Probeer het via Inloggen.`,
      );
    }
    try {
      window.localStorage.setItem(ONTHOUDEN_SLEUTEL, email);
    } catch {
      // Privémodus of geen opslag beschikbaar: dan onthouden we niets.
    }
  }

  /** Al een account: inloggen met het eigen wachtwoord, en dan meedoen. */
  async function metEigenWachtwoord(email: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password: wachtwoord });
    if (error) {
      throw new Error(
        `Inloggen mislukt: ${error.message}. Wachtwoord kwijt? Vraag hieronder een inloglink.`,
      );
    }
    try {
      await completeInvite({ data: { naam: naam.trim() } });
    } catch (err) {
      throw new Error(
        "Account afronden mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /** Wachtwoord kwijt: een inloglink naar het eigen adres, terug naar deze pagina. */
  async function vraagInloglink() {
    if (!id || !code) return;
    setBezig(true);
    try {
      const { email } = await stuurInloglink({ data: { id, code } });
      setLinkGestuurd(true);
      toast.success(`Inloglink gestuurd naar ${email}. Open hem op dit apparaat.`);
    } catch (err) {
      toast.error(
        "Inloglink sturen mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    setBezig(false);
  }

  /** Link uit de standaardmail van Supabase: er is al een sessie, alleen nog een wachtwoord. */
  async function metSessie() {
    const { error: pwError } = await supabase.auth.updateUser({ password: wachtwoord });
    if (pwError) throw new Error("Wachtwoord instellen mislukt: " + pwError.message);
    try {
      await completeInvite({ data: { naam: naam.trim() } });
    } catch (err) {
      throw new Error(
        "Account afronden mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader className="items-center text-center">
          <Woordmerk className="mb-3 h-9" />
          <CardTitle>
            {stand.soort === "code" && stand.bedrijf
              ? `Welkom bij ${stand.bedrijf}`
              : "Uitnodiging accepteren"}
          </CardTitle>
          {(stand.soort === "code" || stand.soort === "sessie") && (
            <CardDescription>
              {stand.soort === "code"
                ? stand.bestaand
                  ? "Je bent uitgenodigd voor het team in Paaltje Systems. Je hebt al een account: log in met je eigen wachtwoord."
                  : "Je bent uitgenodigd voor het team in Paaltje Systems. Kies je naam en een wachtwoord om te beginnen."
                : "Stel je naam en wachtwoord in om te beginnen"}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {stand.soort === "laden" ? (
            <p className="text-center text-sm text-muted-foreground">Bezig met laden…</p>
          ) : stand.soort === "fout" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">{stand.uitleg}</p>
              {stand.inloggen && (
                <Button asChild className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
                  <Link to="/login">Naar inloggen</Link>
                </Button>
              )}
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void afronden();
              }}
            >
              {stand.soort === "code" && (
                <div className="space-y-2">
                  <Label htmlFor="email">Je e-mailadres</Label>
                  {/* Alleen-lezen, maar wel een echt veld: dan onthoudt een
                      wachtwoordbeheerder het goede adres bij het wachtwoord. */}
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={stand.email}
                    readOnly
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="naam">Jouw naam</Label>
                <Input
                  id="naam"
                  autoComplete="name"
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wachtwoord">
                  {bestaand ? "Je wachtwoord" : "Kies een wachtwoord"}
                </Label>
                <Input
                  id="wachtwoord"
                  type="password"
                  autoComplete={bestaand ? "current-password" : "new-password"}
                  value={wachtwoord}
                  onChange={(e) => setWachtwoord(e.target.value)}
                />
                {!bestaand && (
                  <p className="text-[12px] text-muted-foreground">Minimaal 6 tekens.</p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
                disabled={bezig}
              >
                {bezig ? "Bezig…" : bestaand ? "Inloggen en meedoen" : "Aan de slag"}
              </Button>
              {bestaand && (
                <p className="text-center text-[12px] text-muted-foreground">
                  {linkGestuurd ? (
                    "Kijk in je mail: de inloglink brengt je hier terug om een nieuw wachtwoord te kiezen."
                  ) : (
                    <>
                      Wachtwoord kwijt?{" "}
                      <button
                        type="button"
                        className="font-medium text-brand-ink underline-offset-2 hover:underline"
                        disabled={bezig}
                        onClick={() => void vraagInloglink()}
                      >
                        Stuur me een inloglink
                      </button>
                    </>
                  )}
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
