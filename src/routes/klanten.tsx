import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BetaalIcoon } from "@/components/betalingen/BetaalIcoon";
import { effectieveMethode, type Betaalmethode } from "@/lib/betalingen";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconChevronRight as ChevronRight,
  IconCornerDownRight as CornerDownRight,
  IconMail as Mail,
  IconBrandWhatsapp as WhatsApp,
  IconPlus as Plus,
  IconEdit as SquarePen,
  IconTrash as Trash2,
  IconUser as User,
  IconUsers as Users,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { Cijferkaarten } from "@/components/Cijferkaarten";
import { KlantMenu } from "@/components/KlantMenu";
import { Overgeslagen } from "@/components/Overgeslagen";
import { WassenVanaf } from "@/components/WassenVanaf";
import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import { WijkKiezer } from "@/components/WijkKiezer";
import { PostcodesOphalen } from "@/components/PostcodesOphalen";
import { InlineCel } from "@/components/InlineCel";
import { ZoekBalk } from "@/components/ZoekBalk";
import { HoekadresDialog } from "@/components/HoekadresDialog";
import { KlusDialog } from "@/components/KlusDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useBevestig } from "@/components/Bevestig";
import { pushUndo, undoKnop } from "@/lib/undo";
import { nieuweKlus, verwijderKlus } from "@/lib/klussen";
import { useActieveWijk } from "@/lib/wijkgeheugen";
import { useStabiel } from "@/hooks/use-stabiel";
import { useIsMobile } from "@/hooks/use-mobile";
import { telefoonSleutel } from "@/lib/whatsapp";
import {
  addQuickNote,
  adresVanRegel,
  bewaarKlant,
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchQuickNotes,
  fetchMarkeringen,
  fetchStreets,
  formatNumber,
  formatPrice,
  isHoekadres,
  ritmeOmschrijving,
  klantAdres,
  koppelKlant,
  legWeg,
  haalTerug,
  patchCustomer,
  persistPostcodes,
  sortCustomers,
  updateKlant,
  type Customer,
  type District,
  type Klant,
  type KlantVelden,
  type MarkeringRij,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";
import { InactieveAdressen } from "@/components/InactieveAdressen";
import { StopDialog } from "@/components/StopDialog";
import {
  draaiStoppenTerug,
  fetchInactieveAdressen,
  geplandeDagen,
  haalVanPlanning,
  zetInactief,
  zetPlanningTerug,
  type StopReden,
} from "@/lib/stoppen";

interface KlantenSearch {
  wijk?: string;
  /** Opent het dossier van deze klant — zo landt de link vanaf de wijkenpagina goed. */
  klant?: string;
  /** Opent het dossier van dit adres, ook als er nog geen klant aan hangt:
   *  zo landt een zoekresultaat op Home. */
  adres?: string;
  /** Opent meteen een leeg dossier voor een nieuwe klant (de knop op Home). */
  nieuw?: "klant";
}

export const Route = createFileRoute("/klanten")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): KlantenSearch => {
    const uit: KlantenSearch = {};
    if (typeof search["wijk"] === "string" && search["wijk"]) uit.wijk = search["wijk"];
    if (typeof search["klant"] === "string" && search["klant"]) uit.klant = search["klant"];
    if (typeof search["adres"] === "string" && search["adres"]) uit.adres = search["adres"];
    if (search["nieuw"] === "klant") uit.nieuw = "klant";
    return uit;
  },
  head: () => ({
    meta: [
      { title: "Klanten — Wooshy" },
      {
        name: "description",
        content:
          "De mensen achter de adressen: naam, e-mail, telefoonnummer en postcode, direct in de lijst in te vullen naast elk huisnummer van je wijk.",
      },
    ],
  }),
  component: Klanten,
});

/**
 * Een regel in de lijst: een adres uit de wijklijst, met de klant erbij als
 * die bekend is. Adressen zonder klant staan er dus ook in.
 *
 * Een klant die aan geen enkel adres hangt hoort bij géén wijk, en staat
 * daarom niet in deze lijst maar in een eigen blok eronder — anders lijkt
 * een klant uit Testwijk ineens ook in Madestein te wonen.
 */
type Regel = {
  id: string;
  customer: Customer;
  street: Street;
  klant: Klant | null;
  /** Contant of overmaken: van het adres zelf, anders van de wijk. */
  methode: Betaalmethode;
};

/**
 * Het adres zoals het op de post staat.
 *
 * Een hoekadres hoort aan een andere straat; dát is het adres van deze klant,
 * ook al staat hij op de wijklijst onder de straat die je loopt.
 */
function adresTekst(r: Regel) {
  const naam =
    r.customer.hoek_straat_volledig.trim() || r.street.volledige_naam.trim() || r.street.name;
  return `${naam} ${formatNumber(r.customer)}`;
}

/** Contactvelden van de klant, rechtstreeks in de lijst te typen. */
const KOLOMMEN = [
  { veld: "naam", kop: "naam", breed: "w-44" },
  { veld: "email", kop: "e-mail", breed: "w-56" },
  { veld: "telefoon", kop: "telefoon", breed: "w-36" },
] as const satisfies readonly { veld: keyof KlantVelden; kop: string; breed: string }[];

/**
 * Het vlaggetje bij een adres waarvan de klant zelf zijn gegevens heeft
 * doorgegeven. Klik erop en het gaat weg: "gezien".
 *
 * Dit is de werklijst achter de aanmeldpagina. Bij zo'n adres stond nog geen
 * naam, en bij een adres dat via het postvak is toegevoegd staat de prijs er
 * nu pas op — dus dit is het rijtje dat je nog even wilt nakijken.
 */
function Aangemeld({
  customer,
  onPatch,
  alleenLezen = false,
}: {
  customer: Customer;
  onPatch: (patch: Partial<Customer>) => void;
  alleenLezen?: boolean;
}) {
  if (!customer.aangemeld_op) return null;
  const wanneer = new Date(customer.aangemeld_op).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
  });
  if (alleenLezen) {
    return (
      <span
        title={`Zelf doorgegeven op ${wanneer}`}
        className="shrink-0 rounded-full bg-tint-groen px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-tint-groen-ink"
      >
        Aangemeld
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Zelf doorgegeven op ${wanneer} — klik om het vlaggetje weg te halen`}
      className="shrink-0 rounded-full bg-tint-groen px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-tint-groen-ink hover:opacity-80"
      onClick={(e) => {
        e.stopPropagation();
        onPatch({ aangemeld_op: null });
      }}
    >
      Aangemeld
    </button>
  );
}

/**
 * Eén regel in de klantenlijst.
 *
 * Apart component en gememoïseerd, want een wijk telt er honderden en bij elke
 * toetsaanslag in de zoekbalk tekende de browser ze voorheen allemaal opnieuw.
 * De handlers komen als vaste functies binnen (zie useStabiel); het binden aan
 * déze regel gebeurt hier, onder de memo-grens, dus dat kost niets.
 */
const KlantRegel = memo(function KlantRegel({
  regel: r,
  plaats,
  onPatch,
  onDossier,
  onHoekadres,
  onKlus,
  onStoppen,
  onVerwijder,
  onVeld,
  onPostcode,
  markeringen,
  magKlanten,
  magPlannen,
  prijzenZien,
}: {
  regel: Regel;
  plaats: string;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onDossier: (r: Regel) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
  onStoppen: (r: Regel) => void;
  onVerwijder: (r: Regel) => void;
  onVeld: (r: Regel, veld: keyof KlantVelden, waarde: string) => void;
  onPostcode: (c: Customer, waarde: string) => void;
  markeringen: MarkeringRij[];
  /** Naam, mail, telefoon en postcode wijzigen, stoppen en weggooien. */
  magKlanten: boolean;
  /** Kleur, overslaan en de startmaand: dat mag ook wie plant. */
  magPlannen: boolean;
  prijzenZien: boolean;
}) {
  const adres = adresTekst(r);

  return (
    <KlantMenu
      customer={r.customer}
      onPatch={(patch) => onPatch(r.customer, patch)}
      onDossier={() => onDossier(r)}
      onHoekadres={() => onHoekadres(r.customer)}
      onKlus={magPlannen || magKlanten ? () => onKlus(r.customer) : undefined}
      onStoppen={magKlanten ? () => onStoppen(r) : undefined}
      alleenLezen={!magPlannen && !magKlanten}
      markeringen={markeringen}
    >
      <tr className="group border-b border-border/60 last:border-b-0 hover:bg-accent/30">
        {/* Het dossier openen staat vooraan, vóór het adres: dat is
            de knop waarvoor je hier komt, dus die hoort niet weg te
            vallen tot je er met de muis overheen gaat. */}
        <td className="px-2 py-1">
          <button
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Dossier van ${r.klant?.naam || adres}`}
            title="Dossier openen"
            onClick={() => onDossier(r)}
          >
            <User className="size-4" />
          </button>
        </td>
        <td className="whitespace-nowrap px-2 py-1 font-medium">
          <span className="flex items-center gap-1.5">
            {isHoekadres(r.customer) && (
              <CornerDownRight
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="hoekadres"
              />
            )}
            {adres}
            {r.customer.hoek_straat && (
              <span className="text-[10px] uppercase text-muted-foreground">
                {r.customer.hoek_straat}
              </span>
            )}
            <Overgeslagen customer={r.customer} />
            <Aangemeld
              customer={r.customer}
              onPatch={(patch) => onPatch(r.customer, patch)}
              alleenLezen={!magKlanten}
            />
            <WassenVanaf
              customer={r.customer}
              onPatch={(patch) => onPatch(r.customer, patch)}
              alleenLezen={!magPlannen && !magKlanten}
            />
          </span>
        </td>
        {KOLOMMEN.map((k) => (
          <td key={k.veld} className="px-2 py-1">
            <InlineCel
              value={r.klant?.[k.veld] ?? ""}
              placeholder="—"
              onCommit={(v) => onVeld(r, k.veld, v)}
              alleenLezen={!magKlanten}
            />
          </td>
        ))}
        <td className="px-2 py-1">
          <InlineCel
            value={r.customer.postcode}
            placeholder="—"
            onCommit={(v) => onPostcode(r.customer, v)}
            alleenLezen={!magKlanten}
          />
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{plaats || "—"}</td>
        {prijzenZien && (
          <td
            className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted-foreground"
            title={ritmeOmschrijving(r.customer)}
          >
            {r.customer.price ? formatPrice(r.customer.price) : "—"}
          </td>
        )}
        {/* Contant of overmaken, achter de prijs: zo staan ze recht onder
            elkaar en blijft de adreskolom rustig. */}
        <td className="px-1 py-1">
          <BetaalIcoon methode={r.methode} className="align-middle" />
        </td>
        <td className="px-2 py-1">
          {magKlanten && (
            <button
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:bg-destructive/10 hover:!text-destructive"
              aria-label={`${adres}: stoppen of verwijderen`}
              title="Stoppen of verwijderen"
              onClick={() => onVerwijder(r)}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </td>
      </tr>
    </KlantMenu>
  );
});

/** Een WhatsApp-link voor dit nummer, of null als het geen bruikbaar nummer
 *  is. Nederlandse nummers gaan naar +31; een buitenlands nummer moet met +
 *  of 00 beginnen. */
function whatsAppLink(nummer: string | undefined): string | null {
  if (!nummer?.trim()) return null;
  // "+31 (0)6 1234 5678" en "+31 06…": de 0 na het landnummer hoort er niet.
  const opgeschoond = nummer
    .replace(/\(0\)/g, "")
    .trim()
    .replace(/^(\+|00)\s*31[\s-]*0/, "$131");
  const nl = telefoonSleutel(opgeschoond);
  if (nl) return `https://wa.me/31${nl.slice(1)}`;
  const kaal = opgeschoond;
  const cijfers = kaal.replace(/\D/g, "");
  if (kaal.startsWith("+") && cijfers.length >= 8) return `https://wa.me/${cijfers}`;
  if (cijfers.startsWith("00") && cijfers.length >= 10) return `https://wa.me/${cijfers.slice(2)}`;
  return null;
}

/** Hoe ver een regel opzij schuift om de twee knoppen te tonen. */
const KNOPPEN_BREEDTE = 128;

/**
 * Eén adres in de lijst op de telefoon. Tik opent het dossier; veeg naar
 * links en WhatsApp en mail komen tevoorschijn. Lang indrukken opent
 * hetzelfde menu als rechts klikken op de computer.
 */
const KlantRegelMobiel = memo(function KlantRegelMobiel({
  regel: r,
  open,
  onOpen,
  onSluitAndere,
  onDossier,
  onMail,
  magMail,
  onPatch,
  onHoekadres,
  onKlus,
  onStoppen,
  markeringen,
  magKlanten,
  magPlannen,
  prijzenZien,
}: {
  regel: Regel;
  open: boolean;
  onOpen: (id: string | null) => void;
  /** Sluit een andere regel die nog opengeveegd staat. */
  onSluitAndere: (id: string) => void;
  onDossier: (r: Regel) => void;
  /** Opent het dossier meteen bij de berichten van deze klant. */
  onMail: (r: Regel) => void;
  /** Mag je mail lezen? Anders valt de knop terug op je eigen mailapp. */
  magMail: boolean;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
  onStoppen: (r: Regel) => void;
  markeringen: MarkeringRij[];
  magKlanten: boolean;
  magPlannen: boolean;
  prijzenZien: boolean;
}) {
  const adres = adresTekst(r);
  const naam = r.klant?.naam.trim() ?? "";
  const whatsApp = whatsAppLink(r.klant?.telefoon) ?? whatsAppLink(r.klant?.telefoon2);
  const mail = r.klant?.email.trim() || r.klant?.email2.trim() || "";
  // Alleen met een klant is er een mailgeschiedenis om te openen.
  const mailInApp = magMail && !!r.klant;
  const start = useRef<{ x: number; y: number; opzij: boolean } | null>(null);
  const [schuif, setSchuif] = useState<number | null>(null);
  /** Een veeg eindigt soms nog met een klik; die mag het dossier niet openen. */
  const netGeveegd = useRef(false);
  const verschoven = schuif ?? (open ? -KNOPPEN_BREEDTE : 0);

  return (
    <div className="relative overflow-hidden border-b border-border/60 last:border-b-0">
      {/* Achter de regel: de twee knoppen die het vegen onthult. */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: KNOPPEN_BREEDTE }}>
        <a
          href={whatsApp ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!whatsApp}
          tabIndex={open ? 0 : -1}
          onClick={(e) => {
            if (!whatsApp) {
              e.preventDefault();
              toast("Geen telefoonnummer bekend. Vul het in het dossier in.");
            }
            onOpen(null);
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            whatsApp ? "bg-tint-groen text-tint-groen-ink" : "bg-muted text-muted-foreground/60"
          }`}
        >
          <WhatsApp className="size-5" /> WhatsApp
        </a>
        <a
          // Het mailcontact met deze klant in Wooshy zelf: de berichten in
          // het dossier, waar je ook meteen een nieuwe mail schrijft. Zonder
          // recht op mail je eigen mailapp.
          href={!mailInApp && mail ? `mailto:${mail}` : undefined}
          aria-disabled={!mailInApp && !mail}
          tabIndex={open ? 0 : -1}
          onClick={(e) => {
            onOpen(null);
            if (mailInApp) {
              e.preventDefault();
              onMail(r);
            } else if (!mail) {
              e.preventDefault();
              toast(
                r.klant
                  ? "Geen e-mailadres bekend. Vul het in het dossier in."
                  : "Nog geen klant op dit adres. Open het dossier om er een te maken.",
              );
            }
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            mailInApp || mail
              ? "bg-accent text-accent-foreground"
              : "bg-muted text-muted-foreground/60"
          }`}
        >
          <Mail className="size-5" /> Mail
        </a>
      </div>

      <KlantMenu
        customer={r.customer}
        onPatch={(patch) => onPatch(r.customer, patch)}
        onDossier={() => onDossier(r)}
        onHoekadres={() => onHoekadres(r.customer)}
        onKlus={magPlannen || magKlanten ? () => onKlus(r.customer) : undefined}
        onStoppen={magKlanten ? () => onStoppen(r) : undefined}
        alleenLezen={!magPlannen && !magKlanten}
        markeringen={markeringen}
      >
        <button
          type="button"
          className={`relative flex w-full touch-pan-y select-none items-center gap-3 bg-card px-3 py-2.5 text-left [-webkit-touch-callout:none] ${
            schuif === null ? "transition-transform duration-200" : ""
          }`}
          style={{ transform: `translateX(${verschoven}px)` }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) start.current = { x: t.clientX, y: t.clientY, opzij: false };
            netGeveegd.current = false;
            onSluitAndere(r.id);
          }}
          onTouchMove={(e) => {
            const s = start.current;
            const t = e.touches[0];
            if (!s || !t) return;
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;
            // Pas opzij schuiven als het duidelijk een veeg opzij is, anders
            // ben je gewoon aan het scrollen.
            if (!s.opzij && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) s.opzij = true;
            if (!s.opzij) return;
            const basis = open ? -KNOPPEN_BREEDTE : 0;
            setSchuif(Math.max(-KNOPPEN_BREEDTE, Math.min(0, basis + dx)));
          }}
          onTouchEnd={() => {
            const s = start.current;
            start.current = null;
            if (s?.opzij && schuif !== null) {
              netGeveegd.current = true;
              onOpen(schuif < -KNOPPEN_BREEDTE / 2 ? r.id : null);
            }
            setSchuif(null);
          }}
          // Onderbroken door de telefoon (een melding, een randgebaar): terug
          // naar waar hij stond, niet half opzij blijven hangen.
          onTouchCancel={() => {
            start.current = null;
            setSchuif(null);
          }}
          onClick={() => {
            if (netGeveegd.current) {
              netGeveegd.current = false;
              return;
            }
            // Een open regel sluit eerst.
            if (open) onOpen(null);
            else onDossier(r);
          }}
        >
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${
              naam ? "bg-tint-blauw text-tint-blauw-ink" : "bg-surface text-muted-foreground"
            }`}
          >
            {formatNumber(r.customer)}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center gap-1.5 truncate text-[15px] font-medium">
              {isHoekadres(r.customer) && (
                <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{adres}</span>
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
              {naam || <span className="italic">nog geen naam</span>}
              {prijzenZien && r.customer.price ? ` · ${formatPrice(r.customer.price)}` : ""}
            </span>
          </span>
          <BetaalIcoon methode={r.methode} />
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
        </button>
      </KlantMenu>
    </div>
  );
});

/**
 * De klantenlijst op de telefoon: per straat een kopje dat blijft plakken,
 * en rechts een rij letters om naar een straat te springen.
 */
function KlantenLijstMobiel({
  regels,
  ...rest
}: {
  regels: Regel[];
} & Omit<Parameters<typeof KlantRegelMobiel>[0], "regel" | "open" | "onOpen" | "onSluitAndere">) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sluitAndere = useCallback(
    (id: string) => setOpenId((was) => (was && was !== id ? null : was)),
    [],
  );
  // Ga je scrollen, dan klapt een opengeveegde regel weer dicht.
  useEffect(() => {
    if (!openId) return;
    const dicht = () => setOpenId(null);
    window.addEventListener("scroll", dicht, { passive: true, once: true });
    return () => window.removeEventListener("scroll", dicht);
  }, [openId]);

  const groepen = useMemo(() => {
    const uit: { street: Street; regels: Regel[] }[] = [];
    for (const r of regels) {
      const laatste = uit[uit.length - 1];
      if (laatste && laatste.street.id === r.street.id) laatste.regels.push(r);
      else uit.push({ street: r.street, regels: [r] });
    }
    return uit;
  }, [regels]);

  // Per beginletter de eerste straat die ermee begint, op alfabet.
  const letters = useMemo(() => {
    const eerste = new Map<string, string>();
    for (const g of groepen) {
      // Dezelfde naam als in het kopje, zodat de letter klopt met wat je ziet.
      const letter = (g.street.volledige_naam.trim() || g.street.name)
        .trim()
        .charAt(0)
        .toUpperCase();
      if (letter && !eerste.has(letter)) eerste.set(letter, g.street.id);
    }
    return [...eerste].sort((a, b) => a[0].localeCompare(b[0], "nl"));
  }, [groepen]);

  function springNaar(straatId: string) {
    document.getElementById(`straat-${straatId}`)?.scrollIntoView({ block: "start" });
  }

  return (
    <div className="relative pr-5">
      {/* overflow-clip en niet -hidden: anders plakken de straatkopjes niet. */}
      <div className="overflow-clip rounded-[18px] border border-border bg-card shadow-card">
        {groepen.map((g) => (
          <section key={g.street.id}>
            <h2
              id={`straat-${g.street.id}`}
              className="sticky top-[var(--plakrand)] z-[5] scroll-mt-[var(--plakrand)] border-b border-border/60 bg-surface/95 px-3 py-1.5 text-[12px] font-semibold text-muted-foreground backdrop-blur"
            >
              {g.street.volledige_naam.trim() || g.street.name}
              <span className="ml-1.5 font-normal tabular-nums">· {g.regels.length}</span>
            </h2>
            {g.regels.map((r) => (
              <KlantRegelMobiel
                key={r.id}
                regel={r}
                open={openId === r.id}
                onOpen={setOpenId}
                onSluitAndere={sluitAndere}
                {...rest}
              />
            ))}
          </section>
        ))}
      </div>
      {letters.length > 1 && (
        <nav
          aria-label="Naar een straat springen"
          className="fixed right-0.5 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center"
        >
          {letters.map(([letter, id]) => (
            <button
              key={letter}
              type="button"
              onClick={() => springNaar(id)}
              className="px-1.5 py-[1px] text-[11px] font-semibold leading-tight text-brand-ink"
            >
              {letter}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function Klanten() {
  useRequireAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bevestig = useBevestig();
  const { wijk, klant: klantUitUrl, adres: adresUitUrl, nieuw: nieuwUitUrl } = Route.useSearch();
  // Wat je hier mag, per recht. De database dwingt het af; dit zorgt dat er
  // geen velden of knoppen staan die toch niets opslaan.
  const magKlanten = useRecht("klanten_bewerken");
  const magPlannen = useRecht("planning");
  const magMail = useRecht("mail_lezen");
  const prijzenZien = useRecht("prijzen_zien");

  const [zoektermen, setZoektermen] = useState<string[]>([]);
  const mobiel = useIsMobile();
  // Telefoon en computer hebben elk hun eigen zoekbalk; wissel je, dan
  // begint de nieuwe leeg en hoort de lijst dat ook te doen.
  useEffect(() => {
    setZoektermen([]);
  }, [mobiel]);
  const [alleenLeeg, setAlleenLeeg] = useState(false);
  const [toonInactief, setToonInactief] = useState(false);
  const [stop, setStop] = useState<{ open: boolean; regel: Regel | null }>({
    open: false,
    regel: null,
  });
  const [dossier, setDossier] = useState<{
    open: boolean;
    klant: Klant | null;
    customer: Customer | null;
  }>({
    open: false,
    klant: null,
    customer: null,
  });
  const [hoek, setHoek] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [klus, setKlus] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });

  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const klantenQuery = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const inactiefQuery = useQuery({
    queryKey: ["customers-inactief"],
    queryFn: fetchInactieveAdressen,
  });
  const quickNotesQuery = useQuery({ queryKey: ["quick_notes"], queryFn: fetchQuickNotes });
  const markeringQuery = useQuery({ queryKey: ["markeringen"], queryFn: fetchMarkeringen });

  // Alle vijf met een vaste identiteit, ook zolang een query nog laadt. Ze
  // zijn de invoer van `regels`, en daaruit komt het regel-object dat elke
  // KlantRegel meekrijgt. Een verse lege array hier betekent bij elke render
  // nieuwe regels, en dan kan `memo` op de rij niets uitrichten.
  const districts: District[] = useMemo(() => districtsQuery.data ?? [], [districtsQuery.data]);
  const streets: Street[] = useMemo(() => streetsQuery.data ?? [], [streetsQuery.data]);
  const customers: Customer[] = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);
  const klanten: Klant[] = useMemo(() => klantenQuery.data ?? [], [klantenQuery.data]);
  const quickNotes: QuickNote[] = useMemo(() => quickNotesQuery.data ?? [], [quickNotesQuery.data]);
  // Vaste identiteit, net als de rest: elke regel krijgt deze lijst mee.
  const markeringen = useMemo(() => markeringQuery.data ?? [], [markeringQuery.data]);

  // De wijk waar je mee bezig bent blijft staan, ook na een paginawissel of
  // een nieuwe inlog. Een ?klant= in de URL blijft daarbij behouden, anders
  // sluit de omleiding het dossier voor het geopend is. Hetzelfde voor
  // ?adres= en ?nieuw= vanaf Home.
  const actieveWijk = useActieveWijk(
    districts,
    wijk,
    (id) =>
      void navigate({
        to: "/klanten",
        search: {
          wijk: id,
          ...(klantUitUrl ? { klant: klantUitUrl } : {}),
          ...(adresUitUrl ? { adres: adresUitUrl } : {}),
          ...(nieuwUitUrl ? { nieuw: nieuwUitUrl } : {}),
        },
        replace: true,
      }),
  );
  const wijkVanNu = districts.find((d) => d.id === actieveWijk) ?? undefined;

  // Een ?klant= in de URL opent meteen het dossier — zo landt de link vanaf
  // de wijkenpagina goed. Daarna halen we hem uit de URL, anders kun je het
  // dossier niet sluiten en opnieuw openen.
  useEffect(() => {
    // Wachten op de adressen en straten, anders opent hij zonder adres.
    if (!klantUitUrl || !customersQuery.isSuccess || !streetsQuery.isSuccess) return;
    const gevonden = klanten.find((k) => k.id === klantUitUrl);
    if (!gevonden) return;
    // Het dossier gaat over een adres. Zonder adres zoekt opslaan het op uit
    // straat en huisnummer en zet er het lege formulier overheen. Het adres
    // dat bij de klant zelf hoort gaat voor; anders zijn eerste.
    const eigen = customers.filter((c) => c.klant_id === gevonden.id);
    const straatNamen = (c: Customer) => {
      const s = streets.find((x) => x.id === c.street_id);
      // Een hoekadres hoort voor de post bij de andere straat.
      return [s?.name, s?.volledige_naam, c.hoek_straat_volledig].map((n) =>
        (n ?? "").trim().toLowerCase(),
      );
    };
    const postadres = eigen.find(
      (c) =>
        straatNamen(c).includes(gevonden.straat.trim().toLowerCase()) &&
        `${c.house_number}${c.addition ?? ""}`.toLowerCase() ===
          gevonden.huisnummer.replace(/\s/g, "").toLowerCase(),
    );
    setDossier({ open: true, klant: gevonden, customer: postadres ?? eigen[0] ?? null });
    void navigate({
      to: "/klanten",
      search: actieveWijk ? { wijk: actieveWijk } : {},
      replace: true,
    });
  }, [
    klantUitUrl,
    klanten,
    customers,
    streets,
    customersQuery.isSuccess,
    streetsQuery.isSuccess,
    actieveWijk,
    navigate,
  ]);

  // Vanaf Home: ?adres= opent het dossier van dat adres (met zijn klant, als
  // die er is), ?nieuw=klant een leeg dossier. Daarna uit de URL, net als
  // hierboven, zodat sluiten en opnieuw openen gewoon werkt.
  useEffect(() => {
    if (!adresUitUrl && !nieuwUitUrl) return;
    if (adresUitUrl) {
      if (!customersQuery.isSuccess || !klantenQuery.isSuccess) return;
      const pand = customers.find((c) => c.id === adresUitUrl);
      if (pand) {
        const eigenaar = pand.klant_id ? klanten.find((k) => k.id === pand.klant_id) : undefined;
        setDossier({ open: true, klant: eigenaar ?? null, customer: pand });
      }
    } else {
      setDossier({ open: true, klant: null, customer: null });
    }
    void navigate({
      to: "/klanten",
      search: actieveWijk ? { wijk: actieveWijk } : {},
      replace: true,
    });
  }, [
    adresUitUrl,
    nieuwUitUrl,
    customers,
    klanten,
    customersQuery.isSuccess,
    klantenQuery.isSuccess,
    actieveWijk,
    navigate,
  ]);

  // Alle adressen van de wijk, in dezelfde volgorde als op de wijkenpagina,
  // plus de klanten die nergens aan hangen.
  const regels: Regel[] = useMemo(() => {
    const klantOp = new Map(klanten.map((k) => [k.id, k]));
    const eigenStraten = streets
      .filter((s) => s.district_id === actieveWijk)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const wijk = districts.find((d) => d.id === actieveWijk);
    const uit: Regel[] = [];
    for (const street of eigenStraten) {
      const eigen = sortCustomers(customers.filter((c) => c.street_id === street.id));
      for (const customer of eigen) {
        uit.push({
          id: customer.id,
          customer,
          street,
          klant: customer.klant_id ? (klantOp.get(customer.klant_id) ?? null) : null,
          methode: effectieveMethode(customer, wijk),
        });
      }
    }
    return uit;
  }, [customers, streets, klanten, actieveWijk, districts]);

  /**
   * Klanten die op geen enkele wijklijst staan. Dat is niet alleen "geen pand
   * gekoppeld": ook een klant wiens wijk is weggegooid hoort hier, anders is
   * hij nergens meer te vinden.
   */
  const losseKlanten = useMemo(() => {
    const zichtbareWijken = new Set(districts.map((d) => d.id));
    const straatInWijk = new Set(
      streets.filter((s) => zichtbareWijken.has(s.district_id)).map((s) => s.id),
    );
    const opWijklijst = new Set(
      customers.filter((c) => c.klant_id && straatInWijk.has(c.street_id)).map((c) => c.klant_id),
    );
    // Een klant die gestopt is heeft geen actief adres meer, maar hoort niet
    // bij "nog zonder wijk": zijn adres staat bij Inactief.
    const inactief = new Set((inactiefQuery.data ?? []).map((a) => a.klant_id).filter(Boolean));
    return klanten.filter((k) => !opWijklijst.has(k.id) && !inactief.has(k.id));
  }, [customers, streets, districts, klanten, inactiefQuery.data]);

  const zoektermenKlein = zoektermen.map((t) => t.toLowerCase());

  // Eén treffer is genoeg: met twee straten in de balk wil je ze allebei zien,
  // niet alleen wat op allebei past.
  function pastZoek(velden: (string | undefined)[]) {
    if (!zoektermenKlein.length) return true;
    const tekst = velden.filter(Boolean).join(" ").toLowerCase();
    return zoektermenKlein.some((t) => tekst.includes(t));
  }

  const zichtbaar = useMemo(() => {
    return regels.filter((r) => {
      if (alleenLeeg && r.klant?.naam.trim()) return false;
      const k = r.klant;
      return pastZoek([
        adresTekst(r),
        k?.naam,
        k?.email,
        k?.email2,
        k?.telefoon,
        k?.telefoon2,
        r.customer.postcode,
      ]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regels, zoektermen, alleenLeeg]);

  const zichtbareLos = useMemo(() => {
    return losseKlanten.filter((k) => {
      if (alleenLeeg && k.naam.trim()) return false;
      return pastZoek([
        k.naam,
        k.email,
        k.email2,
        k.telefoon,
        k.telefoon2,
        k.postcode,
        k.straat,
        k.plaats,
      ]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [losseKlanten, zoektermen, alleenLeeg]);

  /**
   * Niet de hele wijk in één keer op het scherm: dat zijn er honderden, en
   * de browser is er seconden mee bezig terwijl je er maar een handvol van
   * ziet. We beginnen met 25 en tonen er 25 bij zodra je onderaan komt.
   *
   * Dit gaat alleen over wat er getekend wordt. Zoeken en filteren gebeurt
   * onverkort over de hele wijk, dus je vindt nog steeds een adres dat
   * driehonderd regels verderop staat.
   */
  const [aantalZichtbaar, setAantalZichtbaar] = useState(25);
  const meerRef = useRef<HTMLTableRowElement | null>(null);
  const getoond = zichtbaar.slice(0, aantalZichtbaar);
  const erIsMeer = aantalZichtbaar < zichtbaar.length;

  // Een nieuw zoekresultaat begint weer bovenaan; blijven staan op een oud,
  // groter aantal zou betekenen dat je honderden regels tekent van iets waar
  // je net vanaf de eerste regel naar kijkt.
  useEffect(() => {
    setAantalZichtbaar(25);
  }, [zoektermen, alleenLeeg, actieveWijk]);

  // Het lege regeltje onderaan de tabel is de aanleiding: komt dat in beeld,
  // dan komen er 25 bij. `aantalZichtbaar` staat in de lijst hieronder zodat
  // er een nieuwe waarnemer komt na elke uitbreiding — is het regeltje dan
  // nog steeds in beeld (een hoog scherm, een korte aanvulling), dan gaat het
  // meteen door tot het scherm vol is.
  useEffect(() => {
    const el = meerRef.current;
    if (!el) return;
    const waarnemer = new IntersectionObserver(
      (regels) => {
        if (regels.some((r) => r.isIntersecting)) setAantalZichtbaar((n) => n + 25);
      },
      // Iets eerder dan de onderrand, zodat de volgende 25 er al staan
      // tegen de tijd dat je ze nodig hebt.
      { rootMargin: "300px" },
    );
    waarnemer.observe(el);
    return () => waarnemer.disconnect();
  }, [aantalZichtbaar, zichtbaar.length]);

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["klanten"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["customers-inactief"] });
  }

  /** Een klant laat stoppen: het adres gaat naar Inactief, met alles bewaard. */
  async function stopRegel(r: Regel, reden: StopReden, planningWeg: boolean) {
    const adres = adresTekst(r);
    const u = await zetInactief([r.customer.id], reden, planningWeg);
    herlaad();
    if (u.adressen.length === 0) {
      toast.info(`${adres} was al inactief of weg.`);
      return;
    }
    pushUndo({
      label: `Stoppen ${adres}`,
      undo: async () => {
        await draaiStoppenTerug(u);
        herlaad();
      },
    });
    toast(`${adres} staat nu bij Inactief`, {
      duration: 12000,
      action: undoKnop(),
    });
  }

  /**
   * Eén veld opslaan vanuit de lijst. Heeft de regel nog geen klant, dan
   * ontstaat die nu — met het adres uit de wijklijst er meteen bij, zodat de
   * postcode zichzelf kan opzoeken. Zo blijven er geen lege klanten achter
   * van rijen waar niemand ooit iets in typte.
   */
  async function zetVeld(r: Regel, veld: keyof KlantVelden, waarde: string) {
    const oud = r.klant?.[veld] ?? "";
    if (waarde.trim() === oud.trim()) return;

    try {
      if (r.klant) {
        await zetKlantVeld(r.klant.id, veld, waarde, oud);
        return;
      }

      const adres = adresVanRegel(r.customer, r.street, wijkVanNu);
      const nieuw = await bewaarKlant(null, {
        naam: "",
        email: "",
        email2: "",
        telefoon: "",
        telefoon2: "",
        notitie: "",
        postcode: r.customer.postcode,
        straat: adres.straat,
        huisnummer: adres.huisnummer,
        plaats: adres.plaats,
        [veld]: waarde,
      } as KlantVelden);
      await koppelKlant([r.customer.id], nieuw.id);
      herlaad();

      pushUndo({
        label: `Klantgegevens bij ${adresTekst(r)}`,
        undo: async () => {
          await koppelKlant([r.customer.id], null);
          herlaad();
        },
      });

      // De postcode van het pand staat op de adresregel en wordt met de knop
      // "Postcodes" voor de hele wijk tegelijk opgehaald; hier hoeft niets.
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    }
  }

  /** Eén veld van een bestaande klant, met ongedaan-maken erbij. */
  async function zetKlantVeld(id: string, veld: keyof KlantVelden, waarde: string, oud: string) {
    await updateKlant(id, { [veld]: waarde });
    pushUndo({
      label: `${KOLOMMEN.find((k) => k.veld === veld)?.kop.toLowerCase() ?? veld} wijzigen`,
      undo: async () => {
        await updateKlant(id, { [veld]: oud });
        herlaad();
      },
    });
    herlaad();
  }

  /**
   * Een adres van de lijst halen. Het gaat om het adres zelf: dat verdwijnt
   * uit de wijklijst én uit de klantenlijst, met de klantgegevens erbij. De
   * naam is bijzaak — het adres is waar de ronde om draait.
   *
   * Wegleggen is omkeerbaar: alles staat daarna in de geschiedenis, en de
   * melding heeft een ongedaan-knop.
   */
  /** Kleur, overslaan en startmaand van een adres — uit het menu op de regel. */
  async function patchAdres(c: Customer, patch: Partial<Customer>) {
    try {
      await patchCustomer(c.id, patch);
    } catch (err) {
      toast.error("Opslaan mislukt: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function verwijderRegel(
    customer: Customer | null,
    klant: Klant | null,
    adres: string,
    vraag = true,
    planningWeg = false,
  ) {
    // Vanuit het stopschermpje is "Verwijderen" al de keuze; dan niet nog eens vragen.
    const ja =
      !vraag ||
      (await bevestig({
        titel: `${adres} verwijderen?`,
        tekst: customer
          ? "Het adres verdwijnt uit de wijklijst en uit de klantenlijst, met de klantgegevens erbij. Alles gaat naar de geschiedenis; je kunt het daar terughalen."
          : "De klantgegevens gaan naar de geschiedenis; je kunt ze daar terughalen.",
        gevaarlijk: true,
      }));
    if (!ja) return;

    // Bij een klant met meerdere panden gaat alleen dit adres weg; de klant
    // zelf blijft dan staan bij zijn andere panden.
    const anderePanden = klant
      ? customers.filter((c) => c.klant_id === klant.id && c.id !== customer?.id)
      : [];
    const klantGaatMee = Boolean(klant) && anderePanden.length === 0;

    let kenmerken: string[] = [];
    let adresWeg = false;
    // Zonder het recht op de planning kan dat deel niet; het verwijderen zelf
    // wel. Dan blijft de planning staan, en dat zeggen we.
    if (planningWeg && !magPlannen) {
      toast.info("De planning bleef staan: je rol mag de planning niet aanpassen.");
    }
    try {
      if (customer && planningWeg && magPlannen) kenmerken = await haalVanPlanning([customer.id]);
      if (customer) await legWeg("customers", [customer.id]);
      adresWeg = true;
      if (klant && klantGaatMee) await legWeg("klanten", [klant.id]);
      herlaad();

      pushUndo({
        label: `Verwijderen ${adres}`,
        undo: async () => {
          if (customer) await haalTerug("customers", [customer.id]);
          if (klant && klantGaatMee) await haalTerug("klanten", [klant.id]);
          // Na het adres: een weggegooid adres komt niet terug op de planning.
          await zetPlanningTerug(kenmerken);
          herlaad();
        },
      });

      const dagen = kenmerken.length;
      toast(
        `${adres} verwijderd${dagen ? ` en van ${dagen} ${dagen === 1 ? "dag" : "dagen"} op de planning gehaald` : ""}`,
        {
          duration: 12000,
          action: undoKnop(),
        },
      );
    } catch (e) {
      // Eerst het adres terug: een weggegooid adres komt niet terug op een
      // dag in de toekomst, en dan waren die dagen voorgoed weg.
      if (adresWeg && customer) await haalTerug("customers", [customer.id]).catch(() => {});
      await zetPlanningTerug(kenmerken).catch(() => {});
      herlaad();
      toast.error("Verwijderen mislukt: " + (e as Error).message);
    }
  }

  /** Postcode hoort bij het pand; daar hoeft geen klant voor te bestaan. */
  async function zetPostcode(c: Customer, waarde: string) {
    if (waarde.trim() === c.postcode.trim()) return;
    const oud = c.postcode;
    try {
      await persistPostcodes([{ id: c.id, postcode: waarde.trim() }]);
      herlaad();
      pushUndo({
        label: "Postcode wijzigen",
        undo: async () => {
          await persistPostcodes([{ id: c.id, postcode: oud }]);
          herlaad();
        },
      });
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    }
  }

  // Vaste identiteit voor alles wat een regel meekrijgt. Zonder dit ziet
  // `memo` op KlantRegel bij elke toetsaanslag nieuwe functies en tekent de
  // browser de hele lijst opnieuw; zie useStabiel.
  const opPatch = useStabiel((c: Customer, patch: Partial<Customer>) => void patchAdres(c, patch));
  const opDossier = useStabiel((r: Regel) =>
    setDossier({ open: true, klant: r.klant, customer: r.customer }),
  );
  // Naar de berichtenpagina van deze klant: mail en WhatsApp als gesprek,
  // groot genoeg om te lezen, in plaats van het tabblad in de popup.
  const opMail = useStabiel((r: Regel) => {
    if (r.klant) void navigate({ to: "/berichten", search: { klant: r.klant.id } });
  });
  const opHoekadres = useStabiel((c: Customer) => setHoek({ open: true, customer: c }));
  const opKlus = useStabiel((c: Customer) => setKlus({ open: true, customer: c }));
  const opStoppen = useStabiel((r: Regel) => setStop({ open: true, regel: r }));

  /** Zie de wijkenpagina: een opdracht komt zonder dag binnen. */
  async function maakKlus(customerId: string, omschrijving: string, prijs: number) {
    let id: string;
    try {
      id = await nieuweKlus(customerId, omschrijving, prijs);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Opdracht ${omschrijving}`,
      undo: async () => {
        await verwijderKlus(id);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
    toast.success(`Opdracht genoteerd: ${omschrijving}`);
  }
  // Het prullenbakje bij een adres vraagt eerst waarom: verhuisd, gestopt, of echt weg.
  const opVerwijder = useStabiel((r: Regel) => setStop({ open: true, regel: r }));
  const opVeld = useStabiel(
    (r: Regel, veld: keyof KlantVelden, waarde: string) => void zetVeld(r, veld, waarde),
  );
  const opPostcode = useStabiel((c: Customer, waarde: string) => void zetPostcode(c, waarde));

  const metNaam = regels.filter((r) => r.klant?.naam.trim()).length;
  const bereikbaar = regels.filter((r) => r.klant?.email.trim() || r.klant?.telefoon.trim()).length;

  return (
    <AppLayout
      // Dezelfde opbouw als op de wijkenpagina: de wijkkiezer is de titel.
      titel={
        <WijkKiezer
          variant="titel"
          districts={districts}
          activeId={actieveWijk}
          onSelect={(id) => void navigate({ to: "/klanten", search: { wijk: id } })}
          onChanged={() => qc.invalidateQueries({ queryKey: ["districts"] })}
        />
      }
      actiePositie="onder"
      kruimel="Overzicht / Klanten"
      onderschrift={
        actieveWijk
          ? // Het aantal adressen staat al in de gekleurde tegel.
            wijkVanNu?.plaats && wijkVanNu.plaats !== wijkVanNu.name
            ? wijkVanNu.plaats
            : undefined
          : "Kies een wijk om zijn klanten te zien."
      }
      // Op de telefoon staan zoeken en "+" onderin, bij je duim.
      onderbalk={
        mobiel ? (
          <div className="flex items-center gap-2">
            <ZoekBalk
              placeholder="Zoek adres of naam"
              onTermen={setZoektermen}
              className="w-0 flex-1 shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
            />
            {magKlanten && (
              <Button
                size="icon"
                className="size-11 shrink-0 rounded-full shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
                onClick={() => setDossier({ open: true, klant: null, customer: null })}
                aria-label="Klant toevoegen"
              >
                <Plus className="size-5" />
              </Button>
            )}
          </div>
        ) : undefined
      }
      acties={
        mobiel ? (
          magKlanten && (
            <PostcodesOphalen
              streets={streets.filter((s) => s.district_id === actieveWijk)}
              customers={customers}
              plaats={wijkVanNu?.plaats ?? ""}
              onSaved={herlaad}
            />
          )
        ) : (
          <>
            <ZoekBalk placeholder="Zoek adres of naam" onTermen={setZoektermen} />
            {magKlanten && (
              <>
                <PostcodesOphalen
                  streets={streets.filter((s) => s.district_id === actieveWijk)}
                  customers={customers}
                  plaats={wijkVanNu?.plaats ?? ""}
                  onSaved={herlaad}
                />
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => setDossier({ open: true, klant: null, customer: null })}
                >
                  <Plus className="size-4" /> Klant
                </Button>
              </>
            )}
          </>
        )
      }
      kop={
        <Cijferkaarten
          cijfers={[
            {
              label: "Adressen in deze wijk",
              waarde: String(regels.length),
              onder: "op de klantenlijst",
              icon: Users,
              kleur: "blauw",
            },
            {
              label: "Met naam",
              waarde: String(metNaam),
              onder: `${regels.length - metNaam} nog naamloos`,
              icon: SquarePen,
              kleur: "amber",
            },
            {
              label: "Bereikbaar",
              waarde: String(bereikbaar),
              onder: "mail of telefoon bekend",
              icon: Mail,
              kleur: "groen",
            },
          ]}
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="leeg" checked={alleenLeeg} onCheckedChange={setAlleenLeeg} />
            <Label htmlFor="leeg" className="text-[13px]">
              Alleen nog in te vullen
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="inactief" checked={toonInactief} onCheckedChange={setToonInactief} />
            <Label htmlFor="inactief" className="text-[13px]">
              Inactief
            </Label>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {zichtbaar.length} van {regels.length} regels
          </span>
        </div>

        {!wijkVanNu?.plaats.trim() && (
          <p className="rounded-[12px] border border-border bg-tint-amber/40 px-4 py-2.5 text-[13px]">
            Deze wijk heeft nog geen plaats. Vul die in via het potlood naast de wijk — dan zoeken
            de postcodes zichzelf op.
          </p>
        )}

        {toonInactief ? (
          <InactieveAdressen
            adressen={inactiefQuery.data ?? []}
            straten={streets.filter((s) => s.district_id === actieveWijk)}
            klanten={klanten}
            laden={inactiefQuery.isLoading}
            onGewijzigd={herlaad}
          />
        ) : zichtbaar.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
            <p className="font-display text-lg font-semibold">
              {regels.length === 0 ? "Nog geen adressen in deze wijk" : "Niets gevonden"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {regels.length === 0
                ? "Voeg eerst straten en huisnummers toe op de wijkenpagina; ze verschijnen hier vanzelf."
                : alleenLeeg
                  ? "Alles in deze wijk heeft al een naam."
                  : "Pas je zoekopdracht aan."}
            </p>
          </div>
        ) : mobiel ? (
          <KlantenLijstMobiel
            regels={zichtbaar}
            onDossier={opDossier}
            onMail={opMail}
            magMail={magMail}
            onPatch={opPatch}
            onHoekadres={opHoekadres}
            onKlus={opKlus}
            onStoppen={opStoppen}
            markeringen={markeringen}
            magKlanten={magKlanten}
            magPlannen={magPlannen}
            prijzenZien={prijzenZien}
          />
        ) : (
          <div className="overflow-x-auto rounded-[18px] border border-border bg-card shadow-card">
            <table className="w-full min-w-[64rem] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-card-header text-left text-[11px] font-medium text-muted-foreground/80">
                  <th className="w-9 px-2 py-2.5" />
                  <th className="px-2 py-2.5">adres</th>
                  {KOLOMMEN.map((k) => (
                    <th key={k.veld} className={`px-2 py-2.5 ${k.breed}`}>
                      {k.kop}
                    </th>
                  ))}
                  <th className="w-24 px-2 py-2.5">postcode</th>
                  <th className="w-28 px-2 py-2.5">plaats</th>
                  {prijzenZien && <th className="w-24 px-2 py-2.5">prijs</th>}
                  <th className="w-6 px-1 py-2.5" />
                  <th className="w-9 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {getoond.map((r) => (
                  <KlantRegel
                    key={r.id}
                    regel={r}
                    plaats={wijkVanNu?.plaats ?? ""}
                    onPatch={opPatch}
                    onDossier={opDossier}
                    onHoekadres={opHoekadres}
                    onKlus={opKlus}
                    onStoppen={opStoppen}
                    onVerwijder={opVerwijder}
                    onVeld={opVeld}
                    onPostcode={opPostcode}
                    markeringen={markeringen}
                    magKlanten={magKlanten}
                    magPlannen={magPlannen}
                    prijzenZien={prijzenZien}
                  />
                ))}
                {/* Geen inhoud, alleen een plek om te zien dat je onderaan
                    bent. Staat er niet als de lijst al helemaal getoond is. */}
                {erIsMeer && (
                  <tr ref={meerRef} aria-hidden="true">
                    <td colSpan={KOLOMMEN.length + (prijzenZien ? 7 : 6)} className="h-8" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Klanten zonder adres op een wijklijst. Ze horen bij geen enkele
            wijk, dus ze staan apart in plaats van bij de wijk van dat moment. */}
        {!toonInactief && zichtbareLos.length > 0 && (
          <div className="space-y-2 pt-2">
            <div>
              <h2 className="font-display text-[15px] font-semibold">Nog zonder wijk</h2>
              <p className="text-[13px] text-muted-foreground">
                Deze klanten hangen aan geen enkel adres, en horen dus bij geen wijk. Open het
                dossier en koppel een pand — of vul straat en huisnummer in, dan wordt het adres
                zelf in de wijklijst aangemaakt.
              </p>
            </div>
            {mobiel ? (
              <div className="overflow-hidden rounded-[18px] border border-dashed border-border bg-card">
                {zichtbareLos.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setDossier({ open: true, klant: k, customer: null })}
                    className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted-foreground">
                      <User className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[15px] font-medium">
                        {klantAdres(k) || <span className="italic">geen adres</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                        {k.naam || "nog geen naam"}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[18px] border border-dashed border-border bg-card">
                <table className="w-full min-w-[52rem] text-[13px]">
                  <tbody>
                    {zichtbareLos.map((k) => (
                      <tr
                        key={k.id}
                        className="group border-b border-border/60 last:border-b-0 hover:bg-accent/30"
                      >
                        <td className="w-9 px-2 py-1">
                          <button
                            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={`Dossier van ${k.naam || "naamloze klant"}`}
                            title="Dossier openen"
                            onClick={() => setDossier({ open: true, klant: k, customer: null })}
                          >
                            <User className="size-4" />
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                          {klantAdres(k) || "geen adres"}
                        </td>
                        {KOLOMMEN.map((kol) => (
                          <td key={kol.veld} className={`px-2 py-1 ${kol.breed}`}>
                            <InlineCel
                              value={k[kol.veld]}
                              placeholder="—"
                              alleenLezen={!magKlanten}
                              onCommit={(v) =>
                                void zetKlantVeld(k.id, kol.veld, v, k[kol.veld]).catch((e) =>
                                  toast.error("Opslaan mislukt: " + (e as Error).message),
                                )
                              }
                            />
                          </td>
                        ))}
                        <td className="w-9 px-2 py-1">
                          {magKlanten && (
                            <button
                              className="flex size-7 items-center justify-center rounded-full text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:bg-destructive/10 hover:!text-destructive"
                              aria-label={`Klant ${k.naam || "zonder naam"} verwijderen`}
                              title="Klant verwijderen"
                              onClick={() =>
                                void verwijderRegel(null, k, `Klant "${k.naam || "zonder naam"}"`)
                              }
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <StopDialog
        open={stop.open}
        onOpenChange={(open) => setStop((s) => ({ ...s, open }))}
        titel={
          stop.regel?.klant?.naam
            ? `${stop.regel.klant.naam} stopt`
            : stop.regel?.klant
              ? "Klant stopt"
              : "Adres weghalen"
        }
        metKlant={Boolean(stop.regel?.klant)}
        omschrijving={stop.regel ? adresTekst(stop.regel) : ""}
        telDagen={() => geplandeDagen(stop.regel ? [stop.regel.customer.id] : [])}
        onBevestig={(reden, planningWeg) =>
          stop.regel ? stopRegel(stop.regel, reden, planningWeg) : Promise.resolve()
        }
        onVerwijder={(planningWeg) =>
          stop.regel
            ? verwijderRegel(
                stop.regel.customer,
                stop.regel.klant,
                adresTekst(stop.regel),
                false,
                planningWeg,
              )
            : Promise.resolve()
        }
      />
      <KlusDialog
        open={klus.open}
        onOpenChange={(open) => setKlus((k) => ({ ...k, open }))}
        customer={klus.customer}
        klus={null}
        onOpslaan={(customerId, omschrijving, prijs) =>
          void maakKlus(customerId, omschrijving, prijs)
        }
      />
      <HoekadresDialog
        open={hoek.open}
        onOpenChange={(open) => setHoek((h) => ({ ...h, open }))}
        customer={hoek.customer}
        straten={streets.filter((s) => s.district_id === actieveWijk)}
        onOpslaan={(patch) => hoek.customer && void patchAdres(hoek.customer, patch)}
      />
      <KlantgegevensDialog
        open={dossier.open}
        onOpenChange={(open) => setDossier((s) => ({ ...s, open }))}
        klant={dossier.klant}
        voorstelCustomer={dossier.customer}
        districts={districts}
        streets={streets}
        customers={customers}
        klanten={klanten}
        quickNotes={quickNotes}
        onAddQuickNote={(label) => {
          void addQuickNote(label).then(() => qc.invalidateQueries({ queryKey: ["quick_notes"] }));
        }}
        standaardWijkId={actieveWijk}
        onSaved={herlaad}
      />
    </AppLayout>
  );
}
