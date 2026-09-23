import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Merkvlak } from "@/components/Merk";
import { MERKPLATEN, WOORDMERK_DONKER, WOORDMERK_LICHT } from "@/lib/merk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Inloggen — Paaltje Systems" }],
    // De merkplaat wordt pas in de browser gekozen, dus zonder dit begint hij
    // pas te laden als de pagina al staat — en dan kijk je even naar een
    // effen kleurvlak zonder naam. Zo staan alle drie de platen en allebei de
    // woordmerken er al (samen zo'n zeventig kilobyte), en is de plaat er
    // meteen. Dit hangt aan deze pagina, niet aan de hele app: wie ingelogd
    // is komt hier nooit.
    links: [
      ...MERKPLATEN.map((p) => ({ rel: "preload", as: "image", href: p.plaat })),
      { rel: "preload", as: "image", href: WOORDMERK_DONKER },
      { rel: "preload", as: "image", href: WOORDMERK_LICHT },
    ],
  }),
  component: LoginPagina,
});

const ONTHOUDEN_SLEUTEL = "glazenwas.laatste-email";

function bewaardeEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ONTHOUDEN_SLEUTEL) ?? "";
  } catch {
    return "";
  }
}

function LoginPagina() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);

  // Pas na het hydrateren invullen: op de server bestaat localStorage niet.
  useEffect(() => {
    const onthouden = bewaardeEmail();
    if (onthouden) setEmail(onthouden);
  }, []);

  async function inloggen() {
    if (!email.trim() || !wachtwoord) {
      toast.error("Vul je e-mailadres en wachtwoord in.");
      return;
    }
    setBezig(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: wachtwoord,
    });
    setBezig(false);
    if (error) {
      toast.error("Inloggen mislukt: " + error.message);
      return;
    }
    try {
      window.localStorage.setItem(ONTHOUDEN_SLEUTEL, email.trim());
    } catch {
      // Privémodus of geen opslag beschikbaar: dan onthouden we niets.
    }
    void navigate({ to: "/home" });
  }

  return (
    <Merkvlak>
      <Card className="shadow-tegel">
        <CardHeader className="items-center text-center">
          <CardTitle>Inloggen</CardTitle>
          <CardDescription>Log in met je medewerkersaccount</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void inloggen();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">E-mailadres</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wachtwoord">Wachtwoord</Label>
              <Input
                id="wachtwoord"
                name="password"
                type="password"
                autoComplete="current-password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-foreground text-background hover:bg-foreground/90"
              disabled={bezig}
            >
              {bezig ? "Bezig…" : "Inloggen"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Nog geen bedrijfsaccount?{" "}
            <Link to="/signup" className="font-semibold underline-offset-2 hover:underline">
              Bedrijf aanmaken
            </Link>
          </p>
        </CardContent>
      </Card>
    </Merkvlak>
  );
}
