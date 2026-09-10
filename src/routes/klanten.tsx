import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, Mail, Plus, SquarePen, Trash2, User, Users } from "lucide-react";
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
import { pushUndo, undoLaatste } from "@/lib/undo";
import { nieuweKlus, verwijderKlus } from "@/lib/klussen";
import { useActieveWijk } from "@/lib/wijkgeheugen";
import { useStabiel } from "@/hooks/use-stabiel";
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

interface KlantenSearch {
  wijk?: string;
  /** Opent het dossier van deze klant — zo landt de link vanaf de wijkenpagina goed. */
  klant?: string;
}

export const Route = createFileRoute("/klanten")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): KlantenSearch => {
    const uit: KlantenSearch = {};
    if (typeof search["wijk"] === "string" && search["wijk"]) uit.wijk = search["wijk"];
    if (typeof search["klant"] === "string" && search["klant"]) uit.klant = search["klant"];
    return uit;
  },
  head: () => ({
    meta: [
      { title: "Klanten — namen, e-mail, telefoon en adres" },
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
type Regel = { id: string; customer: Customer; street: Street; klant: Klant | null };

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
  onVerwijder,
  onVeld,
  onPostcode,
  markeringen,
}: {
  regel: Regel;
  plaats: string;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onDossier: (r: Regel) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
  onVerwijder: (r: Regel) => void;
  onVeld: (r: Regel, veld: keyof KlantVelden, waarde: string) => void;
  onPostcode: (c: Customer, waarde: string) => void;
  markeringen: MarkeringRij[];
}) {
  const adres = adresTekst(r);

  return (
    <KlantMenu
      customer={r.customer}
      onPatch={(patch) => onPatch(r.customer, patch)}
      onDossier={() => onDossier(r)}
      onHoekadres={() => onHoekadres(r.customer)}
      onKlus={() => onKlus(r.customer)}
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
            <WassenVanaf customer={r.customer} onPatch={(patch) => onPatch(r.customer, patch)} />
          </span>
        </td>
        {KOLOMMEN.map((k) => (
          <td key={k.veld} className="px-2 py-1">
            <InlineCel
              value={r.klant?.[k.veld] ?? ""}
              placeholder="—"
              onCommit={(v) => onVeld(r, k.veld, v)}
            />
          </td>
        ))}
        <td className="px-2 py-1">
          <InlineCel
            value={r.customer.postcode}
            placeholder="—"
            onCommit={(v) => onPostcode(r.customer, v)}
          />
        </td>
        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{plaats || "—"}</td>
        <td
          className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted-foreground"
          title={ritmeOmschrijving(r.customer)}
        >
          {r.customer.price ? formatPrice(r.customer.price) : "—"}
        </td>
        <td className="px-2 py-1">
          <button
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:bg-destructive/10 hover:!text-destructive"
            aria-label={`${adres} verwijderen`}
            title="Adres verwijderen"
            onClick={() => onVerwijder(r)}
          >
            <Trash2 className="size-4" />
          </button>
        </td>
      </tr>
    </KlantMenu>
  );
});

function Klanten() {
  useRequireAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bevestig = useBevestig();
  const { wijk, klant: klantUitUrl } = Route.useSearch();

  const [zoektermen, setZoektermen] = useState<string[]>([]);
  const [alleenLeeg, setAlleenLeeg] = useState(false);
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
  // sluit de omleiding het dossier voor het geopend is.
  const actieveWijk = useActieveWijk(
    districts,
    wijk,
    (id) =>
      void navigate({
        to: "/klanten",
        search: klantUitUrl ? { wijk: id, klant: klantUitUrl } : { wijk: id },
        replace: true,
      }),
  );
  const wijkVanNu = districts.find((d) => d.id === actieveWijk) ?? undefined;

  // Een ?klant= in de URL opent meteen het dossier — zo landt de link vanaf
  // de wijkenpagina goed. Daarna halen we hem uit de URL, anders kun je het
  // dossier niet sluiten en opnieuw openen.
  useEffect(() => {
    if (!klantUitUrl) return;
    const gevonden = klanten.find((k) => k.id === klantUitUrl);
    if (!gevonden) return;
    setDossier({ open: true, klant: gevonden, customer: null });
    void navigate({
      to: "/klanten",
      search: actieveWijk ? { wijk: actieveWijk } : {},
      replace: true,
    });
  }, [klantUitUrl, klanten, actieveWijk, navigate]);

  // Alle adressen van de wijk, in dezelfde volgorde als op de wijkenpagina,
  // plus de klanten die nergens aan hangen.
  const regels: Regel[] = useMemo(() => {
    const klantOp = new Map(klanten.map((k) => [k.id, k]));
    const eigenStraten = streets
      .filter((s) => s.district_id === actieveWijk)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const uit: Regel[] = [];
    for (const street of eigenStraten) {
      const eigen = sortCustomers(customers.filter((c) => c.street_id === street.id));
      for (const customer of eigen) {
        uit.push({
          id: customer.id,
          customer,
          street,
          klant: customer.klant_id ? (klantOp.get(customer.klant_id) ?? null) : null,
        });
      }
    }
    return uit;
  }, [customers, streets, klanten, actieveWijk]);

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
    return klanten.filter((k) => !opWijklijst.has(k.id));
  }, [customers, streets, districts, klanten]);

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
      return pastZoek([adresTekst(r), k?.naam, k?.email, k?.telefoon, r.customer.postcode]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regels, zoektermen, alleenLeeg]);

  const zichtbareLos = useMemo(() => {
    return losseKlanten.filter((k) => {
      if (alleenLeeg && k.naam.trim()) return false;
      return pastZoek([k.naam, k.email, k.telefoon, k.postcode, k.straat, k.plaats]);
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
        telefoon: "",
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

  async function verwijderRegel(customer: Customer | null, klant: Klant | null, adres: string) {
    const ja = await bevestig({
      titel: `${adres} verwijderen?`,
      tekst: customer
        ? "Het adres verdwijnt uit de wijklijst en uit de klantenlijst, met de klantgegevens erbij. Alles gaat naar de geschiedenis; je kunt het daar terughalen."
        : "De klantgegevens gaan naar de geschiedenis; je kunt ze daar terughalen.",
      gevaarlijk: true,
    });
    if (!ja) return;

    // Bij een klant met meerdere panden gaat alleen dit adres weg; de klant
    // zelf blijft dan staan bij zijn andere panden.
    const anderePanden = klant
      ? customers.filter((c) => c.klant_id === klant.id && c.id !== customer?.id)
      : [];
    const klantGaatMee = Boolean(klant) && anderePanden.length === 0;

    try {
      if (customer) await legWeg("customers", [customer.id]);
      if (klant && klantGaatMee) await legWeg("klanten", [klant.id]);
      herlaad();

      pushUndo({
        label: `Verwijderen ${adres}`,
        undo: async () => {
          if (customer) await haalTerug("customers", [customer.id]);
          if (klant && klantGaatMee) await haalTerug("klanten", [klant.id]);
          herlaad();
        },
      });

      toast(`${adres} verwijderd`, {
        duration: 12000,
        action: {
          label: "Ongedaan maken",
          onClick: () => {
            void undoLaatste().then((label) => {
              if (label) toast.success("Teruggedraaid: " + label);
            });
          },
        },
      });
    } catch (e) {
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
  const opHoekadres = useStabiel((c: Customer) => setHoek({ open: true, customer: c }));
  const opKlus = useStabiel((c: Customer) => setKlus({ open: true, customer: c }));

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
  const opVerwijder = useStabiel(
    (r: Regel) => void verwijderRegel(r.customer, r.klant, adresTekst(r)),
  );
  const opVeld = useStabiel(
    (r: Regel, veld: keyof KlantVelden, waarde: string) => void zetVeld(r, veld, waarde),
  );
  const opPostcode = useStabiel((c: Customer, waarde: string) => void zetPostcode(c, waarde));

  const metNaam = regels.filter((r) => r.klant?.naam.trim()).length;
  const bereikbaar = regels.filter((r) => r.klant?.email.trim() || r.klant?.telefoon.trim()).length;

  return (
    <AppLayout
      // "Klanten" staat al in het kruimelpad erboven; de titel is de wijk.
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
      acties={
        <>
          <ZoekBalk placeholder="Zoek adres of naam" onTermen={setZoektermen} />
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

        {zichtbaar.length === 0 ? (
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
                  <th className="w-24 px-2 py-2.5">POSTCODE</th>
                  <th className="w-28 px-2 py-2.5">PLAATS</th>
                  <th className="w-24 px-2 py-2.5">PRIJS</th>
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
                    onVerwijder={opVerwijder}
                    onVeld={opVeld}
                    onPostcode={opPostcode}
                    markeringen={markeringen}
                  />
                ))}
                {/* Geen inhoud, alleen een plek om te zien dat je onderaan
                    bent. Staat er niet als de lijst al helemaal getoond is. */}
                {erIsMeer && (
                  <tr ref={meerRef} aria-hidden="true">
                    <td colSpan={KOLOMMEN.length + 6} className="h-8" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Klanten zonder adres op een wijklijst. Ze horen bij geen enkele
            wijk, dus ze staan apart in plaats van bij de wijk van dat moment. */}
        {zichtbareLos.length > 0 && (
          <div className="space-y-2 pt-2">
            <div>
              <h2 className="font-display text-[15px] font-semibold">Nog zonder wijk</h2>
              <p className="text-[13px] text-muted-foreground">
                Deze klanten hangen aan geen enkel adres, en horen dus bij geen wijk. Open het
                dossier en koppel een pand — of vul straat en huisnummer in, dan wordt het adres
                zelf in de wijklijst aangemaakt.
              </p>
            </div>
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
                            onCommit={(v) =>
                              void zetKlantVeld(k.id, kol.veld, v, k[kol.veld]).catch((e) =>
                                toast.error("Opslaan mislukt: " + (e as Error).message),
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="w-9 px-2 py-1">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

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
