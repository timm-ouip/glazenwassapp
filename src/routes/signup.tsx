import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Droplets } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createCompanyAndOwner } from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Bedrijf aanmaken — Klantenlijst glazenwasser" }] }),
  component: SignupPagina,
});

function SignupPagina() {
  const navigate = useNavigate();
  const { refreshEmployee } = useAuth();
  const [bedrijfsnaam, setBedrijfsnaam] = useState("");
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);

  async function aanmaken() {
    if (!bedrijfsnaam.trim() || !naam.trim() || !email.trim() || wachtwoord.length < 6) {
      toast.error("Vul alle velden in (wachtwoord: minimaal 6 tekens).");
      return;
    }
    setBezig(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password: wachtwoord,
    });
    if (signUpError) {
      setBezig(false);
      toast.error("Registreren mislukt: " + signUpError.message);
      return;
    }

    // signUp logt de gebruiker meteen in (sessie is meteen actief) zodat de
    // server-functie hieronder — die de sessie nodig heeft — meteen werkt.
    try {
      await createCompanyAndOwner({ data: { companyName: bedrijfsnaam.trim(), naam: naam.trim() } });
    } catch (err) {
      setBezig(false);
      toast.error("Bedrijf aanmaken mislukt: " + (err instanceof Error ? err.message : String(err)));
      return;
    }

    await refreshEmployee();
    setBezig(false);
    toast.success(`Welkom, ${bedrijfsnaam.trim()}!`);
    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
            <Droplets className="size-5" />
          </div>
          <CardTitle>Bedrijf aanmaken</CardTitle>
          <CardDescription>Je eigen, afgeschermde dashboard voor je bedrijf</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void aanmaken();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="bedrijfsnaam">Bedrijfsnaam</Label>
              <Input id="bedrijfsnaam" value={bedrijfsnaam} onChange={(e) => setBedrijfsnaam(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="naam">Jouw naam</Label>
              <Input id="naam" value={naam} onChange={(e) => setNaam(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mailadres</Label>
              <Input
                id="email"
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
                type="password"
                autoComplete="new-password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={bezig}
            >
              {bezig ? "Bezig…" : "Bedrijf aanmaken"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Al een account?{" "}
            <Link to="/login" className="font-medium text-brand hover:underline">
              Inloggen
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
