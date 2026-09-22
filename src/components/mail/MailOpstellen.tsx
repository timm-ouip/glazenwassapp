/**
 * Een mail schrijven: een nieuwe, of een antwoord op een mail uit het postvak.
 *
 * Gaat weg vanaf je eigen adres en komt in je Verzonden-map, net als in een
 * gewoon mailprogramma. Aankondigingen naar een hele wasdag horen hier niet:
 * die gaan via "Wasdag aankondigen".
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconChevronDown as ChevronDown,
  IconClock as Clock,
  IconLoader2 as Loader2,
  IconPaperclip as Paperclip,
  IconSend as Send,
  IconEdit as SquarePen,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  geldigAdres,
  leesAdressen,
  MAX_MAILTEKST,
  MogelijkVerstuurdFout,
  planMail,
  verstuurMail,
  type NieuweBijlage,
} from "@/lib/mailacties";
import { MomentKiezer, toonMoment } from "@/components/mail/MomentKiezer";
import { useBevestig } from "@/components/Bevestig";
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PopupBody,
  PopupKader,
  PopupKop,
  PopupVoet,
  popupInvoer,
  PopupVeld,
} from "@/components/Popup";

export interface Opzet {
  aan: string;
  onderwerp: string;
  tekst: string;
  /** Het bericht waarop dit een antwoord is. */
  antwoordOp?: string;
  /** Vanuit een dossier: de mail komt bij deze klant. */
  klantId?: string;
  /** Al ingevuld Cc-vak, bijvoorbeeld bij allen beantwoorden. */
  cc?: string;
  /** Een opmerking boven het formulier. */
  opmerking?: string;
  /** Doorsturen: de bijlagen van deze mail gaan mee. */
  bijlagenVan?: string;
  /** De namen daarvan, om te laten zien. */
  bijlagenNamen?: string[];
}

/** Samen hooguit zoveel; de server weigert meer. */
const MAX_BIJLAGEN_BYTES = 15_000_000;

function naarBase64(bestand: File): Promise<string> {
  return new Promise((ok, nee) => {
    const lezer = new FileReader();
    lezer.onload = () => ok(String(lezer.result).split(",")[1] ?? "");
    lezer.onerror = () => nee(new Error(`${bestand.name} kon niet gelezen worden.`));
    lezer.readAsDataURL(bestand);
  });
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
  const [bijlagen, setBijlagen] = useState<(NieuweBijlage & { grootte: number })[]>([]);
  const [meeVan, setMeeVan] = useState<string[]>([]);

  // Elke keer dat het venster opengaat, beginnen met wat er klaargezet is.
  useEffect(() => {
    if (!open) return;
    setAan(opzet?.aan ?? "");
    setCc(opzet?.cc ?? "");
    setToonCc(!!opzet?.cc);
    setOnderwerp(opzet?.onderwerp ?? "");
    setTekst(opzet?.tekst ?? "");
    setBijlagen([]);
    setMeeVan(opzet?.bijlagenNamen ?? []);
  }, [open, opzet]);

  async function voegToe(lijst: FileList | null) {
    if (!lijst?.length) return;
    const nieuw = [...bijlagen];
    for (const bestand of Array.from(lijst)) {
      const totaal = nieuw.reduce((som, b) => som + b.grootte, 0) + bestand.size;
      if (totaal > MAX_BIJLAGEN_BYTES) {
        toast.error("Samen mogen de bijlagen hooguit 15 MB zijn.");
        break;
      }
      try {
        nieuw.push({
          naam: bestand.name,
          type: bestand.type || "application/octet-stream",
          inhoud: await naarBase64(bestand),
          grootte: bestand.size,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    }
    if (nieuw.length > 10) toast.error("Hooguit 10 bijlagen per mail; de rest is niet toegevoegd.");
    setBijlagen(nieuw.slice(0, 10));
  }

  const isAntwoord = !!opzet?.antwoordOp;
  const isDoorsturen = !isAntwoord && /^fwd:/i.test(opzet?.onderwerp ?? "") && !opzet?.aan;
  const teLang = tekst.length > MAX_MAILTEKST;

  /** Is er iets getypt dat nog niet in de opzet stond? */
  const gewijzigd =
    aan !== (opzet?.aan ?? "") ||
    cc !== (opzet?.cc ?? "") ||
    onderwerp !== (opzet?.onderwerp ?? "") ||
    tekst !== (opzet?.tekst ?? "") ||
    bijlagen.length > 0;

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

  async function verstuur(e: React.FormEvent | null, later?: Date) {
    e?.preventDefault();
    const aanLijst = leesAdressen(aan);
    const ccLijst = toonCc ? leesAdressen(cc) : [];
    const fout = [...aanLijst, ...ccLijst].find((a) => !geldigAdres(a.email));
    if (aanLijst.length === 0) return void toast.error("Aan wie moet de mail?");
    if (fout) return void toast.error(`"${fout.email}" is geen geldig mailadres.`);
    if (!tekst.trim()) return void toast.error("De mail is nog leeg.");
    if (teLang) return void toast.error("De mail is te lang. Haal een deel van het citaat weg.");

    setBezig(true);
    const mail = {
      aan: aanLijst,
      cc: ccLijst,
      onderwerp: onderwerp.trim(),
      tekst,
      ...(opzet?.antwoordOp ? { antwoordOp: opzet.antwoordOp } : {}),
      ...(opzet?.klantId ? { klantId: opzet.klantId } : {}),
      ...(opzet?.bijlagenVan && meeVan.length > 0 ? { bijlagenVan: opzet.bijlagenVan } : {}),
      ...(bijlagen.length
        ? { bijlagen: bijlagen.map(({ naam, type, inhoud }) => ({ naam, type, inhoud })) }
        : {}),
    };
    try {
      if (later) {
        await planMail(mail, later);
        toast.success(`Gaat weg ${toonMoment(later)}. Staat in "Gepland".`);
        void qc.invalidateQueries({ queryKey: ["gepland"] });
        onSluit();
        return;
      }
      const uit = await verstuurMail(mail);
      if (uit.kopieFout) toast.warning(uit.kopieFout);
      else toast.success("Verstuurd.");
      void qc.invalidateQueries({ queryKey: ["berichten"] });
      void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      void qc.invalidateQueries({ queryKey: ["dossier-mail"] });
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
            titel={
              isAntwoord
                ? opzet?.cc
                  ? "Allen beantwoorden"
                  : "Beantwoorden"
                : isDoorsturen
                  ? "Doorsturen"
                  : "Nieuwe mail"
            }
            subtitel={UITLEG}
          />
          <PopupBody className="gap-2.5">
            {opzet?.opmerking && (
              <p className="rounded-[10px] bg-tint-geel px-3 py-1.5 text-[12px] text-tint-geel-ink">
                {opzet.opmerking}
              </p>
            )}
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
            {(meeVan.length > 0 || bijlagen.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {meeVan.map((naam, i) => (
                  <span
                    key={`mee-${naam}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[12px]"
                    title="Gaat mee uit de oude mail"
                  >
                    <Paperclip className="size-3 text-muted-foreground" />
                    <span className="max-w-[180px] truncate">{naam}</span>
                  </span>
                ))}
                {meeVan.length > 0 && (
                  <button
                    type="button"
                    className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setMeeVan([])}
                  >
                    niet meesturen
                  </button>
                )}
                {bijlagen.map((b, i) => (
                  <span
                    key={`${b.naam}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[12px]"
                  >
                    <Paperclip className="size-3 text-muted-foreground" />
                    <span className="max-w-[180px] truncate">{b.naam}</span>
                    <button
                      type="button"
                      aria-label={`${b.naam} weghalen`}
                      onClick={() => setBijlagen((l) => l.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {teLang && (
              <p className="text-[12px] text-tint-rood-ink">
                De mail is te lang om te versturen. Haal een deel van het citaat onderaan weg.
              </p>
            )}
          </PopupBody>
          <PopupVoet>
            <label className="mr-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <Paperclip className="size-4" /> Bijlage
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={bezig}
                onChange={(e) => {
                  void voegToe(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={bezig}
              onClick={() => void probeerSluiten()}
            >
              Annuleren
            </Button>
            <div className="flex">
              <Button
                type="submit"
                className="rounded-l-full rounded-r-none fel:rounded-r-none"
                disabled={bezig || teLang}
              >
                {bezig ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {bezig ? "Bezig…" : "Versturen"}
              </Button>
              <MomentKiezer
                titel="Later versturen"
                onKies={(moment) => void verstuur(null, moment)}
                trigger={
                  <Button
                    type="button"
                    className="rounded-l-none rounded-r-full border-l border-primary-foreground/20 px-2 fel:rounded-l-none"
                    disabled={bezig || teLang}
                    aria-label="Later versturen"
                    title="Later versturen"
                  >
                    <Clock className="size-3.5" />
                    <ChevronDown className="size-3" />
                  </Button>
                }
              />
            </div>
          </PopupVoet>
        </form>
      </PopupKader>
    </Dialog>
  );
}
