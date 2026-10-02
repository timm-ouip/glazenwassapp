/**
 * Het klantdossier: alles van één adres en de klant erachter, in een groot
 * venster. Links het menu (Overzicht, Mail en klachten, Geld, Facturen,
 * Geschiedenis, en apart "Klant stopt…"); rechts het tabblad. Op de telefoon
 * is het menu het eerste scherm en opent een tik het tabblad op volle
 * breedte, in een blad dat van onderen omhoog schuift en weg te vegen is.
 *
 * Alles wordt meteen bewaard (zie src/lib/useDossier.ts). Zonder adres is dit
 * de nieuw-stand: dezelfde indeling, leeg, met één knop "Toevoegen".
 *
 * Elk tabblad is een eigen onderdeel in src/components/dossier/ en tekent
 * zijn eigen kop; deze schil kiest alleen welk tabblad er staat.
 */
import { lazy, Suspense, useMemo } from "react";

import { DagBetalen } from "@/components/betalingen/DagBetalen";
import { DossierBerichten } from "@/components/dossier/DossierBerichten";
import { DossierFacturen } from "@/components/dossier/DossierFacturen";
import { DossierGeldTab } from "@/components/dossier/DossierGeld";
import { DossierGeschiedenis } from "@/components/dossier/DossierGeschiedenis";
import { DossierMenu, DossierMenuTelefoon } from "@/components/dossier/DossierMenu";
import { DossierOverzicht } from "@/components/dossier/DossierOverzicht";
import { KlusDialog } from "@/components/KlusDialog";
import { PopupKader } from "@/components/Popup";
import { StopDialog } from "@/components/StopDialog";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Customer, District, Klant, QuickNote, Street } from "@/lib/klanten";
import { useDossier, type NieuwAdres } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

export type { NieuwAdres } from "@/lib/useDossier";

// Pas laden als je op Mailen tikt: dit trekt het mailprogramma mee.
const MailOpstellen = lazy(() =>
  import("@/components/mail/MailOpstellen").then((m) => ({ default: m.MailOpstellen })),
);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  klant: Klant | null;
  /** De adresregel waar dit dossier over gaat. Ontbreekt hij, dan is het
   *  dossier in de nieuw-stand: kies een straat en een nummer, en Toevoegen. */
  voorstelCustomer?: Customer | null;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
  onAddQuickNote: (label: string) => void;
  /** De wijk die de pagina toont; daar belandt een nieuw adres in. */
  standaardWijkId?: string | null | undefined;
  /** Het dossier als leeg formulier voor een nieuw adres (zie {@link NieuwAdres}). */
  nieuw?: NieuwAdres | undefined;
  /** Na het bewaren; bij een nieuw adres met het id van dat adres. */
  onSaved: (adresId?: string) => void;
}

export function KlantgegevensDialog(props: Props) {
  const d = useDossier(props);
  const { klant, adres } = d;

  // Eén vaste opzet zolang het schermpje open is: een nieuwe bij elke render
  // zou wissen wat je in de mail typt.
  const mailOpen = d.dialoog === "mail";
  const mailOpzet = useMemo(
    () =>
      mailOpen && klant
        ? {
            aan: klant.naam ? `"${klant.naam.replace(/"/g, "")}" <${d.email}>` : d.email,
            onderwerp: "",
            tekst: "",
            klantId: klant.id,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mailOpen, klant?.id],
  );

  const tabblad = (
    <>
      {d.tab === "overzicht" && <DossierOverzicht d={d} />}
      {d.tab === "berichten" && <DossierBerichten d={d} />}
      {d.tab === "geld" && <DossierGeldTab d={d} />}
      {d.tab === "facturen" && <DossierFacturen d={d} />}
      {d.tab === "geschiedenis" && <DossierGeschiedenis d={d} />}
    </>
  );

  return (
    <Dialog
      open={props.open}
      // Sluiten (kruisje, Escape, ernaast tikken, omlaag vegen) gaat altijd
      // via het dossier: dat wacht tot alles bewaard is.
      onOpenChange={(o) => (o ? props.onOpenChange(true) : void d.sluit())}
    >
      <PopupKader
        blad={d.mobiel}
        onSluit={() => void d.sluit()}
        aria-describedby={undefined}
        // Escape in een veld zet dat veld terug; pas de volgende Escape sluit.
        onEscapeKeyDown={(e) => {
          if ((document.activeElement as HTMLElement | null)?.closest("[data-dossierveld]")) {
            e.preventDefault();
          }
        }}
        className={cn(
          "bg-background [&>button:last-child]:hidden",
          d.mobiel
            ? "h-[92dvh] max-h-[92dvh]"
            : "h-[min(840px,92dvh)] max-h-[92dvh] w-[calc(100vw-2rem)] leading-[normal] max-w-[1380px] flex-row rounded-[24px] sm:max-w-[1380px] sm:rounded-[24px]",
        )}
      >
        <DialogTitle className="sr-only">{d.titel}</DialogTitle>
        <DialogDescription className="sr-only">
          Het dossier van dit adres en de klant erachter
        </DialogDescription>
        {d.mobiel ? (
          d.stap === "menu" ? (
            <DossierMenuTelefoon d={d} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{tabblad}</div>
          )
        ) : (
          // Op de computer alles op 90%, zoals Cmd − in de browser: zo past het
          // Overzicht zonder scrollen (Timmie, 02-10-2026). Alleen de inhoud;
          // het venster zelf blijft even groot. De inhoud krijgt 1/0,9 aan
          // ruimte en wordt dan geschaald tot precies passend. Een schaal en
          // geen CSS-zoom: met zoom meet Safari de plek van een knop anders,
          // en dan klappen keuzemenu's naast hun knop open.
          <div className="flex h-[calc(100%/0.9)] w-[calc(100%/0.9)] shrink-0 origin-top-left scale-90 flex-row">
            <DossierMenu d={d} />
            <div className="flex min-w-0 flex-1 flex-col">{tabblad}</div>
          </div>
        )}
      </PopupKader>

      {mailOpzet && (
        <Suspense fallback={null}>
          <MailOpstellen open opzet={mailOpzet} onSluit={() => d.setDialoog(null)} />
        </Suspense>
      )}
      <DagBetalen
        open={d.dialoog === "betalen"}
        onOpenChange={(o) => !o && d.setDialoog(null)}
        customer={adres}
        adresTekst={d.titel}
        straat={d.adresStraat?.name}
        naam={klant?.naam}
        wijk={d.wijk}
        vandaag={d.opRouteVandaag}
        // Het venster komt al uit het dossier.
        metDossier={false}
      />
      <KlusDialog
        open={d.dialoog === "klus"}
        onOpenChange={(o) => !o && d.setDialoog(null)}
        customer={adres}
        klus={null}
        onOpslaan={(customerId, omschrijving, prijs) =>
          void d.maakKlus(customerId, omschrijving, prijs)
        }
      />
      <StopDialog
        open={d.dialoog === "stop"}
        onOpenChange={(o) => !o && d.setDialoog(null)}
        titel={klant ? "Klant stopt" : "Adres weghalen"}
        metKlant={Boolean(klant)}
        omschrijving={d.titel}
        telDagen={d.telDagen}
        adressen={adres ? [adres.id] : undefined}
        onBevestig={(reden, planningWeg) => d.stop(reden, planningWeg)}
      />
    </Dialog>
  );
}
