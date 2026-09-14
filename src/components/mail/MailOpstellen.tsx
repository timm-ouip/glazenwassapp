/**
 * Een mail schrijven: een nieuwe, of een antwoord op een mail uit het postvak.
 *
 * Gaat weg vanaf je eigen adres en komt in je Verzonden-map, net als in een
 * gewoon mailprogramma. Aankondigingen naar een hele wasdag horen hier niet:
 * die gaan via "Wasdag aankondigen".
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, SquarePen } from "lucide-react";
import { toast } from "sonner";

import {
  geldigAdres,
  leesAdressen,
  MAX_MAILTEKST,
  MogelijkVerstuurdFout,
  verstuurMail,
} from "@/lib/mailacties";
import { useBevestig } from "@/components/Bevestig";
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PopupBody, PopupKader, PopupKop, PopupVoet, popupInvoer, PopupVeld } from "@/components/Popup";

export interface Opzet {
  aan: string;
  onderwerp: string;
  tekst: string;
  /** Het bericht waarop dit een antwoord is. */
  antwoordOp?: string;
}

const UITLEG = "Gaat weg vanaf je eigen mailadres en komt in Verzonden.";

export function MailOpstellen({
  open,
  opzet,
  onSluit,
}: {
  open: boolean;
  opzet: Opzet | null;
  onSluit: () => void;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [aan, setAan] = useState("");
  const [cc, setCc] = useState("");
  const [toonCc, setToonCc] = useState(false);
  const [onderwerp, setOnderwerp] = useState("");
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);

  // Elke keer dat het venster opengaat, beginnen met wat er klaargezet is.
  useEffect(() => {
    if (!open) return;
    setAan(opzet?.aan ?? "");
    setCc("");
    setToonCc(false);
    setOnderwerp(opzet?.onderwerp ?? "");
    setTekst(opzet?.tekst ?? "");
  }, [open, opzet]);

  const isAntwoord = !!opzet?.antwoordOp;
  const teLang = tekst.length > MAX_MAILTEKST;

  /** Is er iets getypt dat nog niet in de opzet stond? */
  const gewijzigd =
    aan !== (opzet?.aan ?? "") ||
    cc !== "" ||
    onderwerp !== (opzet?.onderwerp ?? "") ||
    tekst !== (opzet?.tekst ?? "");

  // Een per ongeluk ingedrukte Escape mag geen half antwoord kosten.
  async function probeerSluiten() {
    if (bezig) return;
    if (gewijzigd) {
      const ja = await bevestig({
        titel: "Mail weggooien?",
        tekst: "Wat je getypt hebt, wordt niet bewaard.",
        bevestigLabel: "Weggooien",
        gevaarlijk: true,
      });
      if (!ja) return;
    }
    onSluit();
  }

  async function verstuur(e: React.FormEvent) {
    e.preventDefault();
    const aanLijst = leesAdressen(aan);
    const ccLijst = toonCc ? leesAdressen(cc) : [];
    const fout = [...aanLijst, ...ccLijst].find((a) => !geldigAdres(a.email));
    if (aanLijst.length === 0) return void toast.error("Aan wie moet de mail?");
    if (fout) return void toast.error(`"${fout.email}" is geen geldig mailadres.`);
    if (!tekst.trim()) return void toast.error("De mail is nog leeg.");
    if (teLang) return void toast.error("De mail is te lang. Haal een deel van het citaat weg.");

    setBezig(true);
    try {
      const uit = await verstuurMail({
        aan: aanLijst,
        cc: ccLijst,
        onderwerp: onderwerp.trim(),
        tekst,
        ...(opzet?.antwoordOp ? { antwoordOp: opzet.antwoordOp } : {}),
      });
      if (uit.kopieFout) toast.warning(uit.kopieFout);
      else toast.success("Verstuurd.");
      void qc.invalidateQueries({ queryKey: ["berichten"] });
      void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      onSluit();
    } catch (err) {
      if (err instanceof MogelijkVerstuurdFout) {
        // Niet openlaten met een uitnodigende verstuurknop: dan krijgt de klant
        // hem misschien twee keer.
        toast.warning(err.message, { duration: 12_000 });
        void qc.invalidateQueries({ queryKey: ["berichten"] });
        onSluit();
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && void probeerSluiten()}>
      <PopupKader className="sm:max-w-2xl" aria-describedby="mail-opstellen-uitleg">
        <DialogDescription id="mail-opstellen-uitleg" className="sr-only">
          {UITLEG}
        </DialogDescription>
        <form onSubmit={(e) => void verstuur(e)} className="flex max-h-[90vh] flex-col">
          <PopupKop
            icoon={<SquarePen className="size-5" />}
            titel={isAntwoord ? "Beantwoorden" : "Nieuwe mail"}
            subtitel={UITLEG}
          />
          <PopupBody className="gap-2.5">
            <PopupVeld icoon={<span className="block w-[4.5rem] text-[12.5px]">Aan</span>}>
              <Input
                aria-label="Aan"
                value={aan}
                onChange={(e) => setAan(e.target.value)}
                placeholder="naam@voorbeeld.nl"
                className={popupInvoer}
                autoFocus={!isAntwoord}
              />
            </PopupVeld>
            {toonCc ? (
              <PopupVeld icoon={<span className="block w-[4.5rem] text-[12.5px]">Cc</span>}>
                <Input
                  aria-label="Cc"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  className={popupInvoer}
                />
              </PopupVeld>
            ) : (
              <button
                type="button"
                onClick={() => setToonCc(true)}
                className="self-start px-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                + Cc
              </button>
            )}
            <PopupVeld icoon={<span className="block w-[4.5rem] text-[12.5px]">Onderwerp</span>}>
              <Input
                aria-label="Onderwerp"
                value={onderwerp}
                onChange={(e) => setOnderwerp(e.target.value)}
                maxLength={300}
                className={popupInvoer}
              />
            </PopupVeld>
            <Textarea
              aria-label="Tekst van de mail"
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              rows={14}
              autoFocus={isAntwoord}
              className="min-h-[240px] rounded-xl text-[14px] leading-relaxed"
              onFocus={(e) => {
                // Bij een antwoord staat de oude mail eronder; begin bovenaan.
                if (isAntwoord && e.currentTarget.selectionStart === e.currentTarget.value.length) {
                  e.currentTarget.setSelectionRange(0, 0);
                }
              }}
            />
            {teLang && (
              <p className="text-[12px] text-tint-rood-ink">
                De mail is te lang om te versturen. Haal een deel van het citaat onderaan weg.
              </p>
            )}
          </PopupBody>
          <PopupVoet>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={bezig}
              onClick={() => void probeerSluiten()}
            >
              Annuleren
            </Button>
            <Button type="submit" className="rounded-full" disabled={bezig || teLang}>
              {bezig ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {bezig ? "Versturen…" : "Versturen"}
            </Button>
          </PopupVoet>
        </form>
      </PopupKader>
    </Dialog>
  );
}
