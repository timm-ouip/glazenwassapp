import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Merkvlak } from "@/components/Merk";
import { CodeVeld, TweestapsKoppelen } from "@/components/TweestapsKoppelen";
import { signOut, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * Na het wachtwoord komt iedereen hier: wie al een authenticator-app heeft
 * gekoppeld vult de code in, wie dat nog niet heeft koppelt er eerst een.
 * Zonder die stap geeft de database niets terug (migratie tweestaps_verplicht).
 */
export const Route = createFileRoute("/tweestaps")({
  head: () => ({ meta: [{ title: "Inlogcode — Paaltje Systems" }] }),
  component: TweestapsPagina,
});

function TweestapsPagina() {
  const navigate = useNavigate();
  const { session, tweestaps, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/login" });
    else if (tweestaps === "ok") void navigate({ to: "/home" });
  }, [loading, session, tweestaps, navigate]);

  return (
    <Merkvlak>
      <Card className="shadow-tegel">
        <CardHeader className="items-center text-center">
          <CardTitle>{tweestaps === "instellen" ? "Inlogcode instellen" : "Inlogcode"}</CardTitle>
          <CardDescription>
            {tweestaps === "instellen"
              ? "Naast je wachtwoord log je voortaan in met een code uit een app op je telefoon. Zo kan niemand binnen met alleen je wachtwoord."
              : "Vul de 6 cijfers in die je authenticator-app nu laat zien."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tweestaps === "invullen" && <CodeInvullen />}
          {/* Na het koppelen komt er vanzelf een nieuwe sessie langs, en dan
              stuurt het effect hierboven je door. */}
          {tweestaps === "instellen" && <TweestapsKoppelen naam="Telefoon" onKlaar={() => {}} />}
          <p className="mt-5 text-center text-sm text-muted-foreground">
            {session?.user.email && <>Ingelogd als {session.user.email}. </>}
            <button
              type="button"
              className="font-semibold underline-offset-2 hover:underline"
              onClick={() => void signOut().then(() => navigate({ to: "/login" }))}
            >
              Uitloggen
            </button>
          </p>
        </CardContent>
      </Card>
    </Merkvlak>
  );
}

function CodeInvullen() {
  const [code, setCode] = useState("");
  const [bezig, setBezig] = useState(false);

  async function controleer() {
    if (code.length !== 6) {
      toast.error("Vul de 6 cijfers uit de app in.");
      return;
    }
    setBezig(true);
    // Met een reservetoestel zijn er meer apps gekoppeld, elk met een eigen
    // code. We proberen ze allemaal; je hoeft niet te kiezen welke je pakte.
    const { data } = await supabase.auth.mfa.listFactors();
    let gelukt = false;
    for (const f of data?.totp ?? []) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
      if (!error) {
        gelukt = true;
        break;
      }
    }
    setBezig(false);
    if (!gelukt) {
      setCode("");
      toast.error("Deze code klopt niet. Neem de code die de app nú laat zien.");
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void controleer();
      }}
    >
      <Label htmlFor="inlogcode">Code uit de app</Label>
      <CodeVeld id="inlogcode" waarde={code} onChange={setCode} autoFocus />
      <Button
        type="submit"
        className="w-full bg-foreground text-background hover:bg-foreground/90"
        disabled={bezig}
      >
        {bezig ? "Bezig…" : "Inloggen"}
      </Button>
      <p className="text-center text-[12.5px] text-muted-foreground">
        Telefoon kwijt of nieuw? Vraag de eigenaar om je code te resetten; daarna stel je hem
        opnieuw in.
      </p>
    </form>
  );
}
