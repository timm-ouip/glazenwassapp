import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Droplets } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { completeInvite } from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/uitnodiging")({
  head: () => ({ meta: [{ title: "Uitnodiging accepteren — Klantenlijst glazenwasser" }] }),
  component: UitnodigingPagina,
});

function UitnodigingPagina() {
  const navigate = useNavigate();
  const { refreshEmployee } = useAuth();
  const [klaar, setKlaar] = useState(false);
  const [geldig, setGeldig] = useState<boolean | null>(null);
  const [naam, setNaam] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    // De Supabase-client herkent de uitnodigingstoken automatisch in de URL
    // en zet die om in een (tijdelijke) sessie zodra de pagina laadt.
    supabase.auth.getSession().then(({ data }) => {
      setGeldig(!!data.session);
      setKlaar(true);
    });
  }, []);

  async function afronden() {
    if (!naam.trim() || wachtwoord.length < 6) {
      toast.error("Vul je naam in en kies een wachtwoord van minimaal 6 tekens.");
      return;
    }
    setBezig(true);
    const { error: pwError } = await supabase.auth.updateUser({ password: wachtwoord });
    if (pwError) {
      setBezig(false);
      toast.error("Wachtwoord instellen mislukt: " + pwError.message);
      return;
    }
    try {
      await completeInvite({ data: { naam: naam.trim() } });
    } catch (err) {
      setBezig(false);
      toast.error("Account afronden mislukt: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    await refreshEmployee();
    setBezig(false);
    toast.success("Welkom bij het team!");
    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
            <Droplets className="size-5" />
          </div>
          <CardTitle>Uitnodiging accepteren</CardTitle>
          <CardDescription>Stel je naam en wachtwoord in om te beginnen</CardDescription>
        </CardHeader>
        <CardContent>
          {!klaar ? (
            <p className="text-center text-sm text-muted-foreground">Bezig met laden…</p>
          ) : !geldig ? (
            <p className="text-center text-sm text-muted-foreground">
              Deze uitnodigingslink is ongeldig of verlopen. Vraag de eigenaar om een nieuwe uitnodiging.
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void afronden();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="naam">Jouw naam</Label>
                <Input id="naam" value={naam} onChange={(e) => setNaam(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wachtwoord">Kies een wachtwoord</Label>
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
                {bezig ? "Bezig…" : "Aan de slag"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
