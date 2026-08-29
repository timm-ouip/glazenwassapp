import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Droplets } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Inloggen — Klantenlijst glazenwasser" }] }),
  component: LoginPagina,
});

function LoginPagina() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);

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
    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
            <Droplets className="size-5" />
          </div>
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
                autoComplete="current-password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
              disabled={bezig}
            >
              {bezig ? "Bezig…" : "Inloggen"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Nog geen bedrijfsaccount?{" "}
            <Link to="/signup" className="font-medium text-brand-ink hover:underline">
              Bedrijf aanmaken
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
