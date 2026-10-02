/**
 * Het Overzicht van het klantdossier: drie kolommen (de klant, het wassen,
 * het geld) met onderaan een balk voor overslaan, een extra opdracht en de
 * kleur op de printlijst. Alles wordt meteen bewaard (zie useDossier).
 *
 * Zolang het adres nog niet bestaat (een nieuwe klant) is het dezelfde
 * indeling, met bovenaan de straat en het huisnummer, en rechtsonder één
 * knop "Toevoegen".
 */
import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconCheck as Check,
  IconLink as Link2,
  IconPlus as Plus,
  IconX as X,
} from "@tabler/icons-react";

import { toast } from "sonner";

import { BetaalwijzeKiezer } from "@/components/betalingen/BetaalwijzeKiezer";
import { GeldloopWijzigingenVak } from "@/components/betalingen/GeldloopWijzigingenVak";
import { ContactKnoppen, DossierKop } from "@/components/dossier/DossierKop";
import {
  DossierKaart,
  DossierVeld,
  KaartLabel,
  KolomKop,
  VeldLabel,
  dossierInvoer,
  dossierLink,
} from "@/components/dossier/DossierVelden";
import { JaarVakjes } from "@/components/dossier/JaarVakjes";
import { KlantInvulLink } from "@/components/dossier/KlantInvulLink";
import { FrequentieKeuze } from "@/components/FrequentieKiezer";
import { NotitieCel } from "@/components/NotitieCel";
import { Pillen } from "@/components/Pillen";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  antwoordKlaar,
  beurtDatum,
  bronTekst,
  korteDatum,
  laatsteBetaling,
  openOmschrijving,
  volgendeBeurtMaand,
} from "@/lib/dossier";
import { KLANTTYPEN } from "@/lib/facturen";
import { netjesPostcode } from "@/lib/schoonschrift";
import {
  formatPrice,
  intervalLabels,
  isGeweest,
  komendeMaanden,
  leesDuur,
  leesRitmeWaarde,
  maandSleutel,
  maandwerkMaanden,
  ritmeLabel,
  ritmeMaanden,
  ritmeWaarde,
  tintStip,
  toonMaand,
  toonMaandKort,
  vorigeMaand,
  type Maandwerk,
} from "@/lib/klanten";
import { blijvenLiggen } from "@/lib/klussen";
import { toonDatum } from "@/lib/wasdag";
import { NIEUWE_STRAAT, volledigeNaam, type Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

/** Een knop in de onderbalk: 40px hoog, wit met een randje. */
const balkKnop =
  "inline-flex h-10 items-center rounded-full border border-border bg-card px-[14px] text-[13px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

/** De keuze "meteen" bij wassen vanaf heeft geen maand; Radix wil wel een waarde. */
const METEEN = "meteen";

const hoofdletter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "12,50" in het prijsveld; leeg als er nog geen prijs is. */
const prijsTekst = (n: number) => (n ? n.toFixed(2).replace(".", ",") : "");

function leesBedrag(tekst: string): number | null {
  const t = tekst.replace(/[€\s]/g, "").replace(",", ".");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function DossierOverzicht({ d }: { d: Dossier }) {
  return (
    <>
      <DossierKop
        d={d}
        titel="Overzicht"
        acties={!d.mobiel && d.adres ? <ContactKnoppen d={d} /> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className={cn("flex flex-col gap-[18px]", d.mobiel ? "px-4 py-4" : "px-[26px] py-[22px]")}
        >
          <Stroken d={d} />
          <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-3">
            <KolomKlant d={d} />
            <KolomWassen d={d} />
            <KolomGeld d={d} />
          </div>
        </div>
      </div>
      <Onderbalk d={d} />
    </>
  );
}

/** Wat bovenaan hoort: alleen bekijken, inactief, en wat Paaltje of de geldloper wijzigde. */
function Stroken({ d }: { d: Dossier }) {
  const a = d.adres;
  return (
    <>
      {!d.magBewerken && (
        <p className="rounded-[14px] bg-muted px-4 py-2.5 text-[13px] text-muted-foreground">
          Je kunt dit dossier bekijken, maar je rol mag de klantgegevens niet wijzigen.
        </p>
      )}
      {a?.inactief_op && (
        <p className="rounded-[14px] bg-tint-geel px-4 py-2.5 text-[13px]">
          Inactief sinds {korteDatum(a.inactief_op)} {new Date(a.inactief_op).getFullYear()}
          {a.inactief_reden === "verhuisd" ? " (verhuisd)" : a.inactief_reden ? " (gestopt)" : ""}
          {d.magBewerken && (
            <>
              {" · "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void d.weerActief()}
              >
                Weer actief maken
              </button>
            </>
          )}
        </p>
      )}
      {a && <GeldloopWijzigingenVak adresId={a.id} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// De klant
// ---------------------------------------------------------------------------

function KolomKlant({ d }: { d: Dossier }) {
  const v = d.velden;
  const uit = d.alleenLezen;
  const zakelijk = v.klanttype !== "particulier";
  const geenMail =
    !v.email.trim() && !v.email2.trim() && !v.factuur_email.trim() && Boolean(d.klant);
  // Sinds wanneer dit adres op de lijst staat. Bij een wijk die in één keer
  // is geïmporteerd is dat de dag van de import; verder weet de app het niet.
  const sinds = d.adres ? maandSleutel(new Date(d.adres.created_at)) : "";
  const klantSinds = sinds
    ? `${d.adres?.geimporteerd ? "geïmporteerd op" : "klant sinds"} ${toonMaandKort(sinds)} ${sinds.slice(0, 4)}`
    : "";
  const uitleg = KLANTTYPEN.find((k) => k.waarde === v.klanttype)?.uitleg;
  // Plaatsen die al gebruikt worden, de meest voorkomende eerst: een
  // glazenwasser werkt meestal in één stad.
  const plaatsen = useMemo(() => {
    const telling = new Map<string, number>();
    for (const p of [...d.klanten.map((k) => k.plaats), ...d.districts.map((w) => w.plaats)]) {
      const t = p.trim();
      if (t) telling.set(t, (telling.get(t) ?? 0) + 1);
    }
    return [...telling.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [d.klanten, d.districts]);
  return (
    <div className="flex min-w-0 flex-col gap-[14px]">
      <div className="flex items-baseline justify-between gap-3">
        <KolomKop>De klant</KolomKop>
        {klantSinds && (
          <span className="truncate text-[12px] text-muted-foreground">{klantSinds}</span>
        )}
      </div>
      {d.zonderAdres && <AdresKiezen d={d} />}
      <DossierKaart>
        <DossierVeld
          label="Naam"
          waarde={v.naam}
          disabled={uit}
          onBewaar={(t) => d.zetKlant({ naam: t })}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <DossierVeld
            label="Telefoon"
            type="tel"
            inputMode="tel"
            placeholder="06 …"
            waarde={v.telefoon}
            disabled={uit}
            onBewaar={(t) => d.zetKlant({ telefoon: t })}
          />
          <DossierVeld
            label="Tweede telefoon"
            type="tel"
            inputMode="tel"
            placeholder="06 …"
            waarde={v.telefoon2}
            disabled={uit}
            onBewaar={(t) => d.zetKlant({ telefoon2: t })}
          />
        </div>
        <DossierVeld
          label="E-mail"
          type="email"
          inputMode="email"
          placeholder="naam@voorbeeld.nl"
          waarde={v.email}
          disabled={uit}
          onBewaar={(t) => d.zetKlant({ email: t })}
        />
        <DossierVeld
          label="Tweede e-mail"
          type="email"
          inputMode="email"
          placeholder="naam@voorbeeld.nl"
          waarde={v.email2}
          disabled={uit}
          onBewaar={(t) => d.zetKlant({ email2: t })}
        />
        {/* Het klanttype bepaalt hoe de factuur rekent: een particulier ziet
            prijzen inclusief btw, een bedrijf of VvE exclusief. */}
        <div className="flex flex-col gap-1.5">
          <Pillen
            groot
            keuzes={KLANTTYPEN.map((k) => ({ waarde: k.waarde, label: k.label }))}
            waarde={v.klanttype}
            onChange={(w) => void d.zetKlant({ klanttype: w })}
            disabled={uit}
            label="Klanttype"
          />
          {uitleg && <p className="text-[12px] text-muted-foreground">{uitleg}</p>}
        </div>
        {geenMail && (
          <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[12.5px]">
            Nergens een e-mailadres: er kan geen aankondiging naartoe, en een factuur blijft als
            concept liggen.
          </p>
        )}
        <KlantInvulLink d={d} />
      </DossierKaart>

      {/* Zoals in het ontwerp direct onder de klant; de extra velden komen daarna. */}
      {/* In de nieuw-stand alleen als er al een klant is: die kun je dan aan
          een adres hangen dat al op de wijklijst staat. */}
      {(!d.zonderAdres || d.klantId) && <OokVanDezeKlant d={d} />}

      {zakelijk && (
        <DossierKaart>
          <KaartLabel>Zakelijke gegevens</KaartLabel>
          <DossierVeld
            label={v.klanttype === "vve" ? "Naam van de VvE" : "Bedrijfsnaam"}
            waarde={v.bedrijfsnaam}
            disabled={uit}
            onBewaar={(t) => d.zetKlant({ bedrijfsnaam: t })}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <DossierVeld
              label="KvK-nummer"
              waarde={v.kvk}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ kvk: t })}
            />
            <DossierVeld
              label="Btw-nummer"
              placeholder="NL001234567B01"
              waarde={v.btw_nummer}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ btw_nummer: t })}
            />
          </div>
          <DossierVeld
            label="Website"
            waarde={v.website}
            disabled={uit}
            onBewaar={(t) => d.zetKlant({ website: t })}
          />
        </DossierKaart>
      )}

      <DossierKaart>
        <DossierVeld
          label="Notitie bij de klant"
          waarde={v.notitie}
          disabled={uit}
          onBewaar={(t) => d.zetKlant({ notitie: t })}
        />
        <KaartLabel>Postadres</KaartLabel>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2.5">
          <DossierVeld
            label="Straat"
            waarde={v.straat}
            disabled={uit}
            list="dossier-postadres-straten"
            onTyp={d.typKlantStraat}
            onBewaar={(t) => d.zetKlant({ straat: t })}
          />
          <DossierVeld
            label="Nummer"
            waarde={v.huisnummer}
            disabled={uit}
            onBewaar={(t) => d.zetKlant({ huisnummer: t })}
          />
        </div>
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5">
          <DossierVeld
            label="Postcode"
            placeholder="1234 AB"
            waarde={v.postcode}
            disabled={uit}
            onBewaar={(t) => d.zetKlantPostcode(t)}
          />
          <DossierVeld
            label="Plaats"
            waarde={v.plaats}
            disabled={uit}
            list="dossier-plaatsen"
            onBewaar={(t) => d.zetKlant({ plaats: t })}
          />
        </div>
        {/* Wat de app zelf opzocht: geel, en terug te draaien. */}
        {d.postcodeOpgezocht && (
          <p className="flex items-center gap-3 rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
            <span className="min-w-0 flex-1">
              Postcode {d.postcodeOpgezocht} opgezocht bij het adres
            </span>
            {!uit && (
              <button
                type="button"
                className="shrink-0 font-medium underline-offset-2 hover:underline"
                onClick={d.postcodeTerug}
              >
                Ongedaan maken
              </button>
            )}
          </p>
        )}
        <datalist id="dossier-postadres-straten">
          {d.klantStraatSuggesties.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <datalist id="dossier-plaatsen">
          {plaatsen.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </DossierKaart>
    </div>
  );
}

/** Nieuw-stand: in welke straat, op welk nummer. */
function AdresKiezen({ d }: { d: Dossier }) {
  const k = d.keuze;
  const meerWijken = new Set(d.keuzeStraten.map((s) => s.district_id)).size > 1;
  const wijkNaam = (id: string) => d.districts.find((w) => w.id === id)?.name ?? "";
  const uit = d.alleenLezen;
  return (
    <DossierKaart>
      <VeldLabel label="Straat">
        <Select disabled={uit} value={k.straat} onValueChange={(w) => d.zetKeuze({ straat: w })}>
          <SelectTrigger className={cn(dossierInvoer, "flex items-center justify-between")}>
            <SelectValue placeholder="Kies een straat">
              {d.nieuweStraat
                ? "Nieuwe straat…"
                : (() => {
                    const s = d.streets.find((x) => x.id === k.straat);
                    if (!s) return undefined;
                    return meerWijken
                      ? `${volledigeNaam(s)} (${wijkNaam(s.district_id)})`
                      : volledigeNaam(s);
                  })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={NIEUWE_STRAAT}>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Plus className="size-3.5" /> Nieuwe straat…
              </span>
            </SelectItem>
            {d.keuzeStraten.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {volledigeNaam(s)}
                {/* De werknaam erachter als hij anders is: zo herken je de straat van de lijst. */}
                {s.volledige_naam.trim() &&
                  s.volledige_naam.trim().toLowerCase() !== s.name.trim().toLowerCase() && (
                    <span className="ml-1.5 text-muted-foreground">({s.name})</span>
                  )}
                {meerWijken && (
                  <span className="ml-1.5 text-muted-foreground">({wijkNaam(s.district_id)})</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </VeldLabel>
      {d.nieuweStraat && (
        <>
          <VeldLabel label="Naam van de nieuwe straat">
            <input
              className={dossierInvoer}
              list="dossier-straten"
              value={k.naam}
              disabled={uit}
              autoFocus={!d.mobiel}
              onChange={(e) => d.zetKeuze({ naam: e.target.value })}
            />
          </VeldLabel>
          <datalist id="dossier-straten">
            {d.straatSuggesties.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
            Komt in de wijk
            <Select disabled={uit} value={d.wijkId} onValueChange={(w) => d.zetKeuze({}, w)}>
              <SelectTrigger className="h-auto w-auto gap-1 border-0 px-1 py-0 text-[12px] font-medium text-foreground shadow-none focus:ring-0">
                <SelectValue placeholder="kies een wijk" />
              </SelectTrigger>
              <SelectContent>
                {d.districts.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {d.dubbeleStraat && (
            <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[12.5px]">
              In {wijkNaam(d.wijkId)} staat al {volledigeNaam(d.dubbeleStraat)}.{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => d.zetKeuze({ straat: d.dubbeleStraat!.id, naam: "" })}
              >
                Die kiezen
              </button>
            </p>
          )}
        </>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_96px_96px] gap-2.5">
        <VeldLabel label="Huisnummer">
          <input
            className={dossierInvoer}
            inputMode="numeric"
            value={k.nummer}
            disabled={uit}
            onChange={(e) => d.zetKeuze({ nummer: e.target.value })}
          />
        </VeldLabel>
        <VeldLabel label="Toevoeging">
          <input
            className={dossierInvoer}
            placeholder="A, BIS…"
            value={k.toevoeging}
            disabled={uit}
            onChange={(e) => d.zetKeuze({ toevoeging: e.target.value.toUpperCase() })}
          />
        </VeldLabel>
        <VeldLabel label="Postcode">
          <input
            className={dossierInvoer}
            placeholder="1234 AB"
            value={k.postcode}
            disabled={uit}
            onChange={(e) => d.zetKeuze({ postcode: e.target.value })}
          />
        </VeldLabel>
      </div>
      {d.bestaandAdres && (
        <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[12.5px]">
          {d.adresTekst(d.bestaandAdres)} staat al op de wijklijst
          {d.bestaandAdres.klant_id
            ? `, bij ${d.klanten.find((x) => x.id === d.bestaandAdres?.klant_id)?.naam || "een andere klant"}`
            : ""}
          . Koppel aan dat adres in plaats van er een tweede regel van te maken; prijs en frequentie
          van dat adres blijven staan.{" "}
          {d.magBewerken && (
            <button
              type="button"
              className="font-medium underline underline-offset-2 disabled:opacity-50"
              disabled={d.toevoegenBezig}
              onClick={() => void d.koppelAanBestaand(d.bestaandAdres!.id)}
            >
              Koppel aan dat adres
            </button>
          )}
        </p>
      )}
    </DossierKaart>
  );
}

/** De andere adressen van deze klant; een tik opent dat adres hier. */
function OokVanDezeKlant({ d }: { d: Dossier }) {
  const [open, setOpen] = useState(false);
  const wijkNaamVan = (streetId: string) => {
    const s = d.streets.find((x) => x.id === streetId);
    return d.districts.find((w) => w.id === s?.district_id)?.name ?? "";
  };
  const koppelbaar = d.customers.filter(
    (c) => c.id !== d.adresId && (!d.klantId || c.klant_id !== d.klantId),
  );
  return (
    <DossierKaart className="gap-1.5">
      <KaartLabel>Ook van deze klant</KaartLabel>
      {d.andereAdressen.length === 0 && (
        <div className="text-[14px] text-muted-foreground">
          {d.zonderAdres ? "Nog geen adres" : "Geen andere adressen"}
        </div>
      )}
      {d.andereAdressen.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <button
            type="button"
            className={cn(dossierLink, "min-w-0 flex-1 truncate text-[15px]")}
            onClick={() =>
              void (async () => {
                if (!d.zonderAdres || (await d.magNieuwVerlaten())) d.openAdres(c);
              })()
            }
          >
            {d.adresTekst(c)}
          </button>
          {d.magBewerken && (
            <button
              type="button"
              aria-label={`${d.adresTekst(c)} losmaken van deze klant`}
              title="Losmaken van deze klant"
              onClick={() => void d.maakLos(c)}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {d.magBewerken && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 self-start text-[13px] text-muted-foreground hover:text-foreground"
            >
              <Link2 className="size-3.5" />{" "}
              {d.zonderAdres ? "een adres van de wijklijst koppelen" : "nog een adres koppelen"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Zoek een adres…" />
              <CommandList>
                <CommandEmpty>Geen adres gevonden.</CommandEmpty>
                <CommandGroup>
                  {koppelbaar.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${d.adresTekst(c)} ${wijkNaamVan(c.street_id)} ${c.id}`}
                      onSelect={() => {
                        setOpen(false);
                        // In de nieuw-stand heeft het dossier nog geen adres:
                        // dan opent het het adres dat je net koppelde.
                        const zonderAdres = d.zonderAdres;
                        void (async () => {
                          if (zonderAdres && !(await d.magNieuwVerlaten())) return;
                          if ((await d.koppelAdres(c)) && zonderAdres) d.openAdres(c);
                        })();
                      }}
                    >
                      <span className="truncate">{d.adresTekst(c)}</span>
                      <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                        {c.klant_id
                          ? `nu van ${d.klanten.find((k) => k.id === c.klant_id)?.naam || "een andere klant"}`
                          : wijkNaamVan(c.street_id)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </DossierKaart>
  );
}

// ---------------------------------------------------------------------------
// Het wassen
// ---------------------------------------------------------------------------

/** "Mei · serre": de maanden en wat er dan bij komt. */
function maandwerkRegel(w: Maandwerk): string {
  const maanden =
    w.maanden.length === 1 && w.jaar === undefined
      ? toonMaand(`2000-${w.maanden[0]}`)
      : maandwerkMaanden(w);
  return [hoofdletter(maanden), w.notitie.trim()].filter(Boolean).join(" · ");
}

function KolomWassen({ d }: { d: Dossier }) {
  const p = d.pand;
  const uit = d.alleenLezen;
  const beurtMaanden = ritmeMaanden(p).map((m) => String(m).padStart(2, "0"));
  const lopend = p.maandwerk.filter((w) => !isGeweest(w));
  const notitieKnop = cn(dossierInvoer, "flex items-center truncate text-left hover:bg-accent/40");
  return (
    <div className="flex min-w-0 flex-col gap-[14px]">
      <KolomKop>Het wassen</KolomKop>
      <DossierKaart>
        <div className={cn("grid gap-2.5", d.prijzenZien ? "grid-cols-2" : "grid-cols-1")}>
          {d.prijzenZien && (
            <DossierVeld
              label="Prijs"
              voor="€"
              inputMode="decimal"
              placeholder="0,00"
              waarde={prijsTekst(p.price)}
              disabled={uit}
              onBewaar={(t) => {
                const n = leesBedrag(t);
                if (n === null) toast.error("Dat is geen bedrag; de prijs is niet veranderd.");
                else if (n !== p.price) void d.zetPand({ price: n });
              }}
            />
          )}
          <VeldLabel label="Frequentie">
            {uit ? (
              <span className={cn(dossierInvoer, "flex items-center truncate")}>
                {p.interval_maanden
                  ? `${intervalLabels[p.interval_maanden]}${p.interval_maanden > 1 ? ` · ${ritmeLabel(p)}` : ""}`
                  : "—"}
              </span>
            ) : (
              <span className={cn(dossierInvoer, "flex items-center [&_button]:text-[15px]")}>
                <FrequentieKeuze
                  value={p.interval_maanden ? ritmeWaarde(p) : ""}
                  placeholder="Kies een frequentie"
                  onChange={(w) => {
                    const r = leesRitmeWaarde(w);
                    if (r) void d.zetPand(r);
                  }}
                />
              </span>
            )}
          </VeldLabel>
        </div>
        <VeldLabel label="Vaste notitie">
          <NotitieCel
            value={p.note}
            quickNotes={d.quickNotes}
            onAddQuickNote={d.onAddQuickNote}
            onChange={(t) => void d.zetPand({ note: t.trim() })}
            alleenLezen={uit}
            className={notitieKnop}
          />
        </VeldLabel>
        <JaarVakjes d={d} />
      </DossierKaart>

      <DossierKaart className="gap-2">
        <KaartLabel>Extra werk per maand</KaartLabel>
        {lopend.length === 0 && (
          <div className="text-[14px] text-muted-foreground">Geen extra werk</div>
        )}
        {lopend.map((w, i) => (
          <div key={w.id ?? i} className="flex justify-between gap-3 text-[15px]">
            <span className="min-w-0 truncate">{maandwerkRegel(w)}</span>
            {d.prijzenZien && w.extra !== null && w.extra !== undefined && (
              <span className="shrink-0 tabular-nums">+ {formatPrice(w.extra)}</span>
            )}
          </div>
        ))}
        {!uit && (
          <NotitieCel
            value={p.note}
            maandwerk={p.maandwerk}
            onChangeMaandwerk={(werk, vorige) => void d.zetMaandwerk(werk, vorige)}
            beurtMaanden={beurtMaanden}
            quickNotes={d.quickNotes}
            onAddQuickNote={d.onAddQuickNote}
            onChange={(t) => void d.zetPand({ note: t.trim() })}
            knop="+ Extra werk"
            metNieuweRegel
            className="h-9 self-start rounded-full border border-dashed border-muted-foreground/40 bg-transparent px-[14px] text-[13px] hover:bg-accent"
          />
        )}
      </DossierKaart>

      {/* Zoals in het ontwerp direct onder het extra werk; de extra velden komen daarna. */}
      {!d.zonderAdres && <VolgendeBeurt d={d} />}

      <DossierKaart>
        <div className="grid grid-cols-2 gap-2.5">
          <DossierVeld
            label="Duur (minuten)"
            inputMode="numeric"
            placeholder="bijv. 25"
            waarde={p.duur_min === null || p.duur_min === undefined ? "" : String(p.duur_min)}
            disabled={uit}
            onBewaar={(t) => {
              const m = leesDuur(t);
              if (m === undefined) toast.error("Die duur kan ik niet lezen; vul minuten in.");
              else void d.zetPand({ duur_min: m, duur_zelf: m !== null });
            }}
          />
          <VeldLabel label="Wassen vanaf">
            <Select
              disabled={uit}
              value={p.start_maand || METEEN}
              onValueChange={(w) => void d.zetPand({ start_maand: w === METEEN ? "" : w })}
            >
              <SelectTrigger className={cn(dossierInvoer, "flex items-center justify-between")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={METEEN}>
                  {d.zonderAdres
                    ? "Bij de eerste beurt"
                    : p.geimporteerd
                      ? "Standaard (al klant)"
                      : "Meteen (aanmaakmaand)"}
                </SelectItem>
                <SelectItem value={vorigeMaand()}>Niet nieuw, al langer klant</SelectItem>
                {komendeMaanden().map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="capitalize">{toonMaand(m)}</span>{" "}
                    <span className="text-muted-foreground">{m.slice(0, 4)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VeldLabel>
        </div>
        <div className="flex flex-col gap-1.5">
          <KaartLabel>Eigen blok op de dag</KaartLabel>
          <Pillen
            groot
            keuzes={[
              { waarde: null as boolean | null, label: "Automatisch" },
              { waarde: true as boolean | null, label: "Altijd" },
              { waarde: false as boolean | null, label: "Nooit" },
            ]}
            waarde={p.eigen_blok}
            onChange={(w) => void d.zetPand({ eigen_blok: w })}
            disabled={uit}
            label="Eigen blok op de dag"
          />
        </div>
      </DossierKaart>

      {!d.zonderAdres && (
        <DossierKaart>
          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2.5">
            <VeldLabel label="Het pand">
              <span
                className="flex h-10 min-w-0 items-center truncate text-[15px] text-foreground"
                title={d.routeAdres}
              >
                {d.routeAdres || "—"}
              </span>
            </VeldLabel>
            {/* De postcode hoort bij het pand, niet bij de bewoner: hij staat
                op de wijklijst en de route gebruikt hem. */}
            <DossierVeld
              label="Postcode"
              placeholder="1234 AB"
              waarde={p.postcode}
              disabled={uit}
              onBewaar={(t) => void d.zetPand({ postcode: netjesPostcode(t) })}
            />
          </div>
        </DossierKaart>
      )}

      {d.openKlussen.length > 0 && (
        <DossierKaart className="gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <KaartLabel>Openstaand werk</KaartLabel>
            {d.prijzenZien && (
              <span className="text-[13px] font-semibold tabular-nums">
                {formatPrice(d.openKlussen.reduce((som, k) => som + k.prijs, 0))}
              </span>
            )}
          </div>
          {d.openKlussen.map((k) => (
            <div key={k.id} className="flex justify-between gap-3 text-[15px]">
              <span className="min-w-0 truncate">
                {k.omschrijving}
                {k.gepland_op && !blijvenLiggen(k) && (
                  <span className="text-muted-foreground"> · {toonDatum(k.gepland_op)}</span>
                )}
              </span>
              {d.prijzenZien && (
                <span className="shrink-0 tabular-nums">{formatPrice(k.prijs)}</span>
              )}
            </div>
          ))}
        </DossierKaart>
      )}
    </div>
  );
}

function VolgendeBeurt({ d }: { d: Dossier }) {
  const b = d.volgendeBeurt;
  const p = d.pand;
  let tekst: string;
  let sub = "";
  if (d.adres?.inactief_op) {
    tekst = "Geen";
    sub = "dit adres staat op inactief";
  } else if (b) {
    tekst = `${beurtDatum(b.datum)}${b.ploeg_nr ? ` · team ${b.ploeg_nr}` : ""}`;
  } else {
    const m = volgendeBeurtMaand(p, null, d.dezeMaand);
    tekst = m
      ? `${hoofdletter(toonMaand(m))}${m.slice(0, 4) !== String(d.jaar) ? ` ${m.slice(0, 4)}` : ""}`
      : "—";
    sub = "nog niet ingepland";
  }
  return (
    <DossierKaart className="flex-row items-center justify-between gap-3">
      <div className="min-w-0">
        <KaartLabel>Volgende beurt</KaartLabel>
        <div className="text-[16px] font-semibold">{tekst}</div>
        {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
      </div>
      {b && d.magPlannen && !d.adres?.inactief_op && (
        <Link
          to="/dag"
          search={{ datum: b.datum }}
          className={cn(dossierLink, "shrink-0 text-[16px]")}
          onClick={() => void d.sluit()}
        >
          naar de dag
        </Link>
      )}
    </DossierKaart>
  );
}

// ---------------------------------------------------------------------------
// Het geld
// ---------------------------------------------------------------------------

function KolomGeld({ d }: { d: Dossier }) {
  const g = d.geld;
  const metGeld = d.prijzenZien && !d.zonderAdres;
  const open = g?.open ?? 0;
  const betaald = g ? laatsteBetaling(g.gebeurtenissen) : null;
  const mail = d.laatsteMail;
  return (
    <div className="flex min-w-0 flex-col gap-[14px]">
      <KolomKop>Het geld</KolomKop>
      {metGeld && (
        <div className="flex flex-col gap-1 rounded-[18px] bg-tint-geel p-[18px]">
          <div className="text-[13px]">{open < -0.005 ? "Tegoed" : "Staat open"}</div>
          <div className="font-display text-[34px] font-semibold leading-tight tabular-nums">
            {g ? formatPrice(Math.abs(open)) : "…"}
          </div>
          <div className="text-[13px]">
            {!g
              ? " "
              : open > 0.005
                ? openOmschrijving(g.delen)
                : open < -0.005
                  ? "gaat af van de volgende beurten"
                  : "alles is betaald"}
          </div>
        </div>
      )}
      <DossierKaart className="gap-2.5">
        <KaartLabel>Betalen</KaartLabel>
        <BetaalwijzeKiezer
          groot
          waarde={d.pand.betaalmethode}
          wijk={d.wijk?.betaalmethode ?? "contant"}
          disabled={d.alleenLezen}
          onChange={(m) => void d.zetPand({ betaalmethode: m })}
        />
      </DossierKaart>
      {metGeld && (
        <DossierKaart className="gap-2">
          <KaartLabel>Laatst betaald</KaartLabel>
          {betaald ? (
            <div className="flex justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">
                {korteDatum(betaald.op)} · {bronTekst(betaald.bron)}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(betaald.bedrag)}</span>
            </div>
          ) : (
            <div className="text-[14px] text-muted-foreground">{g ? "Nog niets betaald" : "…"}</div>
          )}
          <button
            type="button"
            className={cn(dossierLink, "self-start text-[13px]")}
            onClick={() => d.naarTab("geld")}
          >
            geldkaart en alle betalingen
          </button>
        </DossierKaart>
      )}
      {d.magMailLezen && d.klant && (
        <DossierKaart className="gap-1.5">
          <KaartLabel>Laatste mail</KaartLabel>
          <div className="truncate text-[14px]">
            {mail ? (
              `${korteDatum(mail.ontvangen_op)} · ${mail.onderwerp || "(geen onderwerp)"}`
            ) : (
              <span className="text-muted-foreground">Nog geen mail</span>
            )}
          </div>
          <button
            type="button"
            className={cn(dossierLink, "self-start text-[13px]")}
            onClick={() => d.naarTab("berichten")}
          >
            {antwoordKlaar(mail) ? "Paaltje heeft een antwoord klaar" : "alle mail en klachten"}
          </button>
        </DossierKaart>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// De onderbalk
// ---------------------------------------------------------------------------

function Onderbalk({ d }: { d: Dossier }) {
  const p = d.pand;
  const maanden = komendeMaanden();
  const komende = maanden[0]!;
  const mag = d.magPlanOfBewerken && !d.toevoegenBezig;
  /** Streepje bij de jaarwissel, anders lopen december en januari in elkaar. */
  const jaarwissel = (m: string, i: number) => i > 0 && m.endsWith("-01");
  // De bedoeling (aan of uit) volgt uit wat je ziet; zie zetOverslaan.
  const wissel = (m: string) =>
    void d.zetOverslaan(p.overslaan.includes(m) ? { uit: [m] } : { aan: [m] });

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card py-3",
        d.mobiel ? "px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "px-[26px]",
      )}
    >
      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={balkKnop} disabled={!mag}>
              Overslaan…
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuItem onSelect={() => wissel(komende)}>
              {p.overslaan.includes(komende) ? (
                <span className="capitalize">{toonMaand(komende)} toch doen</span>
              ) : (
                <>
                  Overslaan
                  <span className="ml-auto text-xs capitalize text-muted-foreground">
                    {toonMaand(komende)}
                  </span>
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Overslaan in…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {maanden.map((m, i) => (
                  <Fragment key={m}>
                    {jaarwissel(m, i) && <DropdownMenuSeparator />}
                    <DropdownMenuCheckboxItem
                      checked={p.overslaan.includes(m)}
                      onSelect={(e) => {
                        // Openhouden: meestal vink je er meer dan één aan.
                        e.preventDefault();
                        wissel(m);
                      }}
                    >
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </DropdownMenuCheckboxItem>
                  </Fragment>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Overslaan t/m…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {maanden.map((m, i) => (
                  <Fragment key={m}>
                    {jaarwissel(m, i) && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onSelect={() => void d.zetOverslaan({ aan: maanden.filter((x) => x <= m) })}
                    >
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {p.overslaan.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void d.zetOverslaan({ uit: p.overslaan })}>
                  Niets meer overslaan ({p.overslaan.length})
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          className={balkKnop}
          disabled={d.zonderAdres || !d.magBewerken}
          title={d.zonderAdres ? "Kan pas als het adres er is" : undefined}
          onClick={() => d.setDialoog("klus")}
        >
          Extra opdracht…
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={balkKnop} disabled={!mag}>
              Kleur op printlijst
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel>Kleur op printlijst</DropdownMenuLabel>
            {d.markeringen.length === 0 && (
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                Nog geen kleuren — maak ze bij Instellingen
              </DropdownMenuLabel>
            )}
            {d.markeringen.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() =>
                  void d.zetPand({ markering: p.markering === m.sleutel ? "" : m.sleutel })
                }
              >
                <span className={`size-3 rounded-full ring-1 ring-inset ${tintStip[m.tint]}`} />
                {m.naam}
                {p.markering === m.sleutel && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
            {p.markering && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void d.zetPand({ markering: "" })}>
                  Kleur weghalen
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {d.zonderAdres ? (
        <button
          type="button"
          disabled={!d.magBewerken || d.toevoegenBezig}
          onClick={() => void d.toevoegen()}
          className="inline-flex h-10 items-center rounded-full bg-primary px-[18px] text-[14px] font-semibold text-primary-foreground transition-[filter] hover:brightness-95 disabled:pointer-events-none disabled:opacity-50"
        >
          {d.toevoegenBezig ? "Bezig…" : d.bestaandAdres ? "Koppel aan dat adres" : "Toevoegen"}
        </button>
      ) : (
        <div className="text-[13px] text-muted-foreground">Alles wordt meteen bewaard</div>
      )}
    </div>
  );
}
