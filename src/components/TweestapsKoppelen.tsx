import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IconCopy as Copy } from "@tabler/icons-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Wat Supabase teruggeeft bij het aanmaken: de QR-code en dezelfde sleutel als tekst. */
type Nieuw = { id: string; qr: string; sleutel: string; uri: string };

/** Alleen cijfers, en niet meer dan zes: de app laat "123 456" zien. */
function alsCode(invoer: string): string {
  return invoer.replace(/\D/g, "").slice(0, 6);
}

/** Het vakje voor de 6 cijfers, hetzelfde bij instellen en bij inloggen. */
export function CodeVeld({
  id,
  waarde,
  onChange,
  autoFocus,
}: {
  id: string;
  waarde: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      autoFocus={autoFocus}
      className="text-center font-mono text-lg tracking-[0.3em]"
      value={waarde}
      onChange={(e) => onChange(alsCode(e.target.value))}
    />
  );
}

/**
 * Een authenticator-app (Google Authenticator, Microsoft Authenticator, de
 * Wachtwoorden-app van de iPhone…) koppelen aan dit account.
 *
 * Supabase maakt een geheime sleutel; die gaat via de QR-code naar de app.
 * Daarna rekenen de app en Supabase uit die sleutel en de klok elke 30
 * seconden dezelfde 6 cijfers uit. Pas als die ene keer klopt, telt de
 * koppeling: een half gescande code sluit je dus nooit buiten.
 */
export function TweestapsKoppelen({
  naam,
  onKlaar,
}: {
  /** Naam van dit toestel; per account moet die uniek zijn. */
  naam: string;
  onKlaar: () => void;
}) {
  const [nieuw, setNieuw] = useState<Nieuw | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [bezig, setBezig] = useState(false);
  // In de ontwikkelmodus draait een effect twee keer; zonder dit kwamen er
  // twee half gekoppelde apps met dezelfde naam, en weigert Supabase de tweede.
  const gestart = useRef(false);

  useEffect(() => {
    if (gestart.current) return;
    gestart.current = true;
    void (async () => {
      // Een eerdere poging die nooit bevestigd is (pagina dicht, andere
      // telefoon gepakt) eerst weg, anders botst de naam.
      const { data: lijst } = await supabase.auth.mfa.listFactors();
      for (const f of lijst?.all ?? []) {
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: naam,
        issuer: "Paaltje Systems",
      });
      if (error || !data) {
        setFout(error?.message ?? "Er ging iets mis.");
        return;
      }
      setNieuw({
        id: data.id,
        qr: data.totp.qr_code,
        sleutel: data.totp.secret,
        uri: data.totp.uri,
      });
    })();
  }, [naam]);

  async function bevestig() {
    if (!nieuw) return;
    if (code.length !== 6) {
      toast.error("Vul de 6 cijfers uit de app in.");
      return;
    }
    setBezig(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: nieuw.id, code });
    setBezig(false);
    if (error) {
      setCode("");
      toast.error("Deze code klopt niet. Neem de code die de app nú laat zien.");
      return;
    }
    toast.success("Gekoppeld. Voortaan vraagt de app bij het inloggen om deze code.");
    onKlaar();
  }

  if (fout) {
    return <p className="text-sm text-destructive">Koppelen lukt nu niet: {fout}</p>;
  }
  if (!nieuw) {
    return <p className="text-sm text-muted-foreground">Even een QR-code maken…</p>;
  }

  // In groepjes van vier: makkelijker over te typen zonder je te vergissen.
  const leesbaar = nieuw.sleutel.match(/.{1,4}/g)?.join(" ") ?? nieuw.sleutel;

  return (
    <ol className="space-y-5 text-sm">
      <li>
        <p className="font-semibold">1. Zet een authenticator-app op je telefoon</p>
        <p className="mt-0.5 text-muted-foreground">
          Bijvoorbeeld Google Authenticator of Microsoft Authenticator (gratis in de App Store en
          Google Play). Op een iPhone kan het ook met de Wachtwoorden-app.
        </p>
      </li>
      <li>
        <p className="font-semibold">2. Scan deze QR-code met die app</p>
        <div className="mt-2 flex justify-center">
          {/* Wit vlak eromheen: op een donker thema is een QR-code anders niet te scannen. */}
          <img
            src={nieuw.qr}
            alt="QR-code om de app te koppelen"
            className="size-44 rounded-xl bg-white p-2"
          />
        </div>
        <p className="mt-2 text-muted-foreground">
          Zit je nu op je telefoon zelf?{" "}
          <a
            href={nieuw.uri}
            className="font-semibold text-foreground underline underline-offset-2"
          >
            Open in je authenticator-app
          </a>
          , of typ deze sleutel over:
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[12.5px]">
            {leesbaar}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Sleutel kopiëren"
            onClick={() => {
              void navigator.clipboard
                .writeText(nieuw.sleutel)
                .then(() => toast.success("Sleutel gekopieerd"))
                .catch(() => toast.error("Kopiëren lukte niet; typ hem over."));
            }}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Tip: scan de QR-code meteen ook met een tweede toestel, zoals een tablet of een oude
          telefoon. Dat is je reserve als je telefoon kwijtraakt.
        </p>
      </li>
      <li>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void bevestig();
          }}
        >
          <Label htmlFor="koppelcode" className="font-semibold">
            3. Vul de 6 cijfers in die de app nu laat zien
          </Label>
          <CodeVeld id="koppelcode" waarde={code} onChange={setCode} />
          <Button
            type="submit"
            className="w-full bg-foreground text-background hover:bg-foreground/90"
            disabled={bezig}
          >
            {bezig ? "Bezig…" : "Koppelen"}
          </Button>
        </form>
      </li>
    </ol>
  );
}
