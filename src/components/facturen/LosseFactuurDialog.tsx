/**
 * Een factuur met de hand, buiten de planning om.
 *
 * Niet alles wat je in rekening brengt loopt via een wasdag: een offerte die
 * doorgaat, een eenmalige klus voor iemand die verder geen vaste klant is,
 * iets wat je achteraf alsnog moet factureren.
 *
 * Wat hier ontstaat is een gewoon concept. Het gaat daarna precies dezelfde
 * weg als alle andere facturen -- zelfde nummering, zelfde briefpapier,
 * zelfde betaallink en herinneringen -- dus je verstuurt hem gewoon uit de
 * lijst. Alleen de herkomst is anders.
 *
 * Per regel een aantal, een eenheid en een prijs per stuk ("3 x dakkapel à
 * € 5"), zelf kiezen of je inclusief of exclusief btw typt en welk tarief,
 * en bovenaan wat een nette factuur verder nodig heeft: waar hij over gaat,
 * het kenmerk van de klant en een eigen betaaltermijn.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle as Let,
  IconDiscount as Korting,
  IconMapPin as Pin,
  IconPlus as Plus,
  IconReceipt as Bon,
  IconSearch as Zoek,
  IconTrash as Trash2,
  IconUser as User,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  PopupBlok,
  PopupBody,
  PopupKader,
  PopupKop,
  PopupPaar,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import { cn } from "@/lib/utils";
import { fetchKlanten, formatPrice, type Klant } from "@/lib/klanten";
import {
  BTW_TARIEVEN,
  EENHEDEN,
  fetchFactuurStandaard,
  fetchKlantAdressen,
  klanttypeLabel,
  maakLosseFactuur,
  type LosseRegel,
} from "@/lib/facturen";
import { toonDatum, vandaag } from "@/lib/wasdag";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Aangeroepen als er een concept klaarstaat, zodat de lijst bijwerkt. */
  onKlaar: () => void;
}

/** Een regel zoals hij in het scherm staat: alles nog als getypte tekst. */
interface Invoer {
  omschrijving: string;
  aantal: string;
  eenheid: string;
  prijs: string;
  /** Leeg = het standaardtarief van het bedrijf. */
  btw: string;
  /** Een kortingsregel: je typt het bedrag gewoon positief, eraf gaat het toch. */
  korting?: boolean;
}

const NIEUWE_REGEL: Invoer = { omschrijving: "", aantal: "1", eenheid: "x", prijs: "", btw: "" };

const TERMIJNEN = [0, 7, 14, 21, 30, 60];

/** "1.234,50", "1234.5" en "15" worden allemaal een getal; onzin wordt NaN. */
function getal(tekst: string): number {
  let t = tekst.trim().replace(/\s|€/g, "");
  if (!t) return NaN;
  // Staan er zowel punten als komma's in, dan zijn de punten duizendtallen.
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "");
  return Number(t.replace(",", "."));
}

/** Op centen, zoals Postgres `round` het doet: een halve cent weg van nul,
 *  ook bij een korting. */
const rond = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;

/** Alles wat je over een klant kunt typen om hem te vinden, in één zin. */
function zoektekst(k: Klant, adressen: string[]): string {
  return [
    k.naam,
    k.bedrijfsnaam,
    k.email,
    k.factuur_email,
    [k.straat, k.huisnummer].join(" "),
    k.postcode,
    k.plaats,
    [k.factuur_straat, k.factuur_huisnummer].join(" "),
    k.factuur_postcode,
    ...adressen,
  ]
    .join(" ")
    .toLowerCase();
}

/** Het adres dat we onder een zoekresultaat laten zien. */
function adresVan(k: Klant, adressen: string[]): string {
  const eigen = [k.straat, k.huisnummer].filter((d) => d?.trim()).join(" ");
  return eigen || adressen[0] || "";
}

export function LosseFactuurDialog({ open, onOpenChange, onKlaar }: Props) {
  const [zoek, setZoek] = useState("");
  const [klant, setKlant] = useState<Klant | null>(null);
  const [regels, setRegels] = useState<Invoer[]>([{ ...NIEUWE_REGEL }]);
  const [datum, setDatum] = useState(vandaag());
  /** Leeg = volgt het klanttype, tot je zelf kiest. */
  const [inclusiefGekozen, setInclusiefGekozen] = useState<boolean | null>(null);
  const [termijn, setTermijn] = useState<string>("");
  const [onderwerp, setOnderwerp] = useState("");
  const [kenmerk, setKenmerk] = useState("");
  const [opmerking, setOpmerking] = useState("");
  const [bezig, setBezig] = useState(false);

  const klanten = useQuery({
    queryKey: ["klanten"],
    queryFn: fetchKlanten,
    enabled: open && !klant,
    staleTime: 5 * 60_000,
  });
  const adressen = useQuery({
    queryKey: ["klant-adressen"],
    queryFn: fetchKlantAdressen,
    enabled: open && !klant,
    staleTime: 5 * 60_000,
  });
  const standaard = useQuery({
    queryKey: ["factuur-standaard"],
    queryFn: fetchFactuurStandaard,
    enabled: open,
  });

  const standaardProcent = standaard.data?.btwProcent ?? 21;
  const inclusief = inclusiefGekozen ?? (klant?.klanttype ?? "particulier") === "particulier";
  const klantTermijn = klant?.betalingstermijn_dagen ?? standaard.data?.termijn ?? 14;
  const dagen = termijn === "" ? klantTermijn : Number(termijn);

  const treffers = useMemo(() => {
    const woorden = zoek.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (zoek.trim().length < 2) return [];
    const perKlant = adressen.data ?? new Map<string, string[]>();
    return (klanten.data ?? [])
      .filter((k) => {
        const tekst = zoektekst(k, perKlant.get(k.id) ?? []);
        const zonderSpaties = tekst.replace(/\s/g, "");
        // Elk woord moet ergens voorkomen; een postcode mag met of zonder spatie.
        return woorden.every((w) => tekst.includes(w) || zonderSpaties.includes(w));
      })
      .slice(0, 8)
      .map((k) => ({ klant: k, adres: adresVan(k, perKlant.get(k.id) ?? []) }));
  }, [zoek, klanten.data, adressen.data]);

  /** Elke regel doorgerekend, precies zoals de database het straks doet. */
  const berekend = useMemo(
    () =>
      regels.map((r) => {
        // Het aantal bewaart twee cijfers achter de komma; dus zo rekenen we ook.
        const aantal = rond(r.aantal.trim() === "" ? 1 : getal(r.aantal));
        const ingetypt = getal(r.prijs);
        const prijs = r.korting ? -Math.abs(ingetypt) : ingetypt;
        const procent = r.btw === "" ? standaardProcent : Number(r.btw);
        const geldig = !Number.isNaN(aantal) && aantal !== 0 && !Number.isNaN(prijs);
        const totaal = geldig ? rond(aantal * rond(prijs)) : 0;
        const excl = inclusief ? rond(totaal / (1 + procent / 100)) : totaal;
        const btw = rond((excl * procent) / 100);
        return { aantal, prijs, procent, geldig, totaal, excl, btw, incl: rond(excl + btw) };
      }),
    [regels, inclusief, standaardProcent],
  );

  const totalen = useMemo(() => {
    const perTarief = new Map<number, { over: number; btw: number }>();
    let excl = 0;
    let incl = 0;
    for (const b of berekend) {
      if (!b.geldig) continue;
      excl += b.excl;
      incl += b.incl;
      const t = perTarief.get(b.procent) ?? { over: 0, btw: 0 };
      t.over += b.excl;
      t.btw += b.btw;
      perTarief.set(b.procent, t);
    }
    return {
      excl: rond(excl),
      incl: rond(incl),
      tarieven: [...perTarief.entries()].sort((a, b) => b[0] - a[0]),
    };
  }, [berekend]);

  const vervaldatum = useMemo(() => {
    const d = new Date(`${datum}T12:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + dagen);
    return d.toISOString().slice(0, 10);
  }, [datum, dagen]);

  const mailadres = klant ? klant.factuur_email?.trim() || klant.email?.trim() || "" : "";
  const factuuradres = klant
    ? [
        [
          klant.factuur_straat?.trim() || klant.straat,
          klant.factuur_straat?.trim() ? klant.factuur_huisnummer : klant.huisnummer,
        ]
          .filter((d) => d?.trim())
          .join(" "),
        [
          klant.factuur_postcode?.trim() || klant.postcode,
          klant.factuur_plaats?.trim() || klant.plaats,
        ]
          .filter((d) => d?.trim())
          .join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  function zetRegel(i: number, veld: keyof Invoer, waarde: string) {
    setRegels((v) => v.map((x, j) => (j === i ? { ...x, [veld]: waarde } : x)));
  }

  function sluit() {
    setZoek("");
    setKlant(null);
    setRegels([{ ...NIEUWE_REGEL }]);
    setDatum(vandaag());
    setInclusiefGekozen(null);
    setTermijn("");
    setOnderwerp("");
    setKenmerk("");
    setOpmerking("");
    onOpenChange(false);
  }

  async function maak() {
    if (!klant) {
      toast.error("Kies eerst een klant.");
      return;
    }
    const uit: LosseRegel[] = [];
    for (const [i, r] of regels.entries()) {
      const b = berekend[i]!;
      if (!r.omschrijving.trim() && !r.prijs.trim()) continue;
      if (!r.omschrijving.trim()) {
        toast.error("Elke regel heeft een omschrijving nodig.");
        return;
      }
      if (Number.isNaN(b.prijs)) {
        toast.error(`Die prijs begrijp ik niet: "${r.prijs}".`);
        return;
      }
      if (Number.isNaN(b.aantal) || b.aantal === 0 || Math.abs(b.aantal) >= 100_000_000) {
        toast.error(`Dat aantal begrijp ik niet: "${r.aantal}".`);
        return;
      }
      uit.push({
        datum,
        omschrijving: r.omschrijving,
        notitie: "",
        aantal: b.aantal,
        eenheid: r.eenheid,
        stukprijs: rond(b.prijs),
        btw_procent: b.procent,
      });
    }
    if (uit.length === 0) {
      toast.error("Vul minstens één regel in.");
      return;
    }

    setBezig(true);
    try {
      await maakLosseFactuur(klant.id, uit, {
        inclusief,
        onderwerp,
        kenmerk,
        opmerking,
        termijn: termijn === "" ? null : Number(termijn),
      });
      toast.success("Het concept staat klaar. Nakijken en dan versturen.");
      onKlaar();
      sluit();
    } catch (e) {
      toast.error("Niet gelukt: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  const keuzelijst =
    "h-auto w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm outline-none";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : sluit())}>
      <PopupKader className="sm:max-w-2xl">
        <PopupKop
          icoon={<Bon className="size-[22px]" />}
          titel="Losse factuur"
          subtitel="Buiten de planning om"
        />
        <PopupBody>
          {/* --- Voor wie ------------------------------------------------ */}
          <PopupBlok label="Voor wie">
            {klant ? (
              <div className="rounded-xl border border-input bg-background/70 px-3.5 py-3 text-[13.5px]">
                <div className="flex items-start gap-2.5">
                  <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {klant.bedrijfsnaam?.trim() || klant.naam}
                      <span className="font-normal text-muted-foreground">
                        {" · "}
                        {klanttypeLabel(klant.klanttype)}
                      </span>
                    </div>
                    {klant.bedrijfsnaam?.trim() && (
                      <div className="text-muted-foreground">t.a.v. {klant.naam}</div>
                    )}
                    <div className="text-muted-foreground">
                      {factuuradres || "Geen adres bekend"}
                    </div>
                    {mailadres ? (
                      <div className="text-muted-foreground">{mailadres}</div>
                    ) : (
                      <div className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
                        <Let className="size-3.5" />
                        Geen e-mailadres: versturen lukt pas als je er een invult bij de klant.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs underline underline-offset-2"
                    onClick={() => setKlant(null)}
                  >
                    anders
                  </button>
                </div>
              </div>
            ) : (
              <>
                <PopupVeld icoon={<Zoek className="size-4" />}>
                  <input
                    autoFocus
                    className={cn(popupInvoer, "w-full outline-none")}
                    placeholder="Zoek op naam, adres, postcode of e-mail"
                    value={zoek}
                    onChange={(e) => setZoek(e.target.value)}
                  />
                </PopupVeld>
                {zoek.trim().length >= 2 && (klanten.isLoading || adressen.isLoading) && (
                  <p className="px-1 text-[12.5px] text-muted-foreground">
                    Even de klanten ophalen…
                  </p>
                )}
                {zoek.trim().length >= 2 &&
                  !klanten.isLoading &&
                  !adressen.isLoading &&
                  treffers.length === 0 && (
                    <p className="px-1 text-[12.5px] text-muted-foreground">
                      Niemand gevonden met "{zoek.trim()}".
                    </p>
                  )}
                {treffers.length > 0 && (
                  <ul className="max-h-52 divide-y divide-border/60 overflow-y-auto rounded-xl border border-input">
                    {treffers.map(({ klant: k, adres }) => (
                      <li key={k.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-[13.5px] hover:bg-accent"
                          onClick={() => {
                            setKlant(k);
                            setZoek("");
                          }}
                        >
                          {k.bedrijfsnaam?.trim() || k.naam}
                          <span className="text-muted-foreground">
                            {" · "}
                            {klanttypeLabel(k.klanttype)}
                          </span>
                          {adres && (
                            <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                              <Pin className="size-3" />
                              {adres}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </PopupBlok>

          {/* --- Datum en termijn ----------------------------------------- */}
          <PopupPaar>
            <PopupBlok
              label="Factuurdatum"
              info="De maand waarin deze omzet meetelt. Ook de datum op de regels."
            >
              <PopupVeld>
                <input
                  type="date"
                  className={cn(popupInvoer, "w-full outline-none")}
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                />
              </PopupVeld>
            </PopupBlok>
            <PopupBlok
              label="Betaaltermijn"
              terzijde={vervaldatum ? `vervalt ${toonDatum(vervaldatum)}` : undefined}
            >
              <PopupVeld>
                <select
                  className={keuzelijst}
                  value={termijn}
                  onChange={(e) => setTermijn(e.target.value)}
                >
                  <option value="">Standaard ({klantTermijn} dagen)</option>
                  {TERMIJNEN.map((d) => (
                    <option key={d} value={String(d)}>
                      {d === 0 ? "Direct" : `${d} dagen`}
                    </option>
                  ))}
                </select>
              </PopupVeld>
            </PopupBlok>
          </PopupPaar>

          {/* --- Betreft en kenmerk --------------------------------------- */}
          <PopupPaar>
            <PopupBlok label="Betreft" info="Komt vetgedrukt boven de regels op de factuur.">
              <PopupVeld>
                <input
                  className={cn(popupInvoer, "w-full outline-none")}
                  placeholder="Bijvoorbeeld: dakgoten en dakkapellen"
                  maxLength={200}
                  value={onderwerp}
                  onChange={(e) => setOnderwerp(e.target.value)}
                />
              </PopupVeld>
            </PopupBlok>
            <PopupBlok
              label="Kenmerk klant"
              info="Het inkoop- of ordernummer dat een bedrijf of VvE op de factuur wil zien. Mag leeg."
            >
              <PopupVeld>
                <input
                  className={cn(popupInvoer, "w-full outline-none")}
                  placeholder="Optioneel"
                  maxLength={100}
                  value={kenmerk}
                  onChange={(e) => setKenmerk(e.target.value)}
                />
              </PopupVeld>
            </PopupBlok>
          </PopupPaar>

          {/* --- Regels --------------------------------------------------- */}
          <PopupBlok
            label="Regels"
            terzijde={
              <span className="inline-flex rounded-full bg-muted p-0.5 text-[12px] font-medium">
                {[true, false].map((waarde) => (
                  <button
                    key={String(waarde)}
                    type="button"
                    aria-pressed={inclusief === waarde}
                    onClick={() => setInclusiefGekozen(waarde)}
                    className={cn(
                      "rounded-full px-2.5 py-1 transition-colors",
                      inclusief === waarde
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {waarde ? "Prijzen incl. btw" : "excl. btw"}
                  </button>
                ))}
              </span>
            }
          >
            <div className="space-y-2">
              {regels.map((r, i) => {
                const b = berekend[i]!;
                return (
                  <div
                    key={i}
                    className="space-y-2 rounded-xl border border-input bg-background/70 p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-[13.5px] outline-none focus:border-ring"
                        placeholder="Omschrijving, bijvoorbeeld: dakkapel gewassen"
                        maxLength={200}
                        value={r.omschrijving}
                        onChange={(e) => zetRegel(i, "omschrijving", e.target.value)}
                      />
                      {regels.length > 1 && (
                        <button
                          type="button"
                          aria-label="Regel weghalen"
                          className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                          onClick={() => setRegels((v) => v.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <input
                        inputMode="decimal"
                        aria-label="Aantal"
                        className="h-9 w-16 rounded-lg border border-input bg-card px-2 text-right tabular-nums outline-none focus:border-ring"
                        value={r.aantal}
                        onChange={(e) => zetRegel(i, "aantal", e.target.value)}
                      />
                      <select
                        aria-label="Eenheid"
                        className="h-9 w-[76px] cursor-pointer rounded-lg border border-input bg-card px-2 outline-none focus:border-ring"
                        value={r.eenheid}
                        onChange={(e) => zetRegel(i, "eenheid", e.target.value)}
                      >
                        {EENHEDEN.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                        <option value="">—</option>
                      </select>
                      <span className="text-muted-foreground">à</span>
                      <div className="flex h-9 w-28 items-center rounded-lg border border-input bg-card px-2 focus-within:border-ring">
                        <span className="text-muted-foreground">{r.korting ? "−€" : "€"}</span>
                        <input
                          inputMode="decimal"
                          aria-label="Prijs per stuk"
                          className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
                          placeholder="0,00"
                          value={r.prijs}
                          onChange={(e) => zetRegel(i, "prijs", e.target.value)}
                        />
                      </div>
                      <select
                        aria-label="Btw-tarief"
                        className="h-9 cursor-pointer rounded-lg border border-input bg-card px-2 outline-none focus:border-ring"
                        value={r.btw === "" ? String(standaardProcent) : r.btw}
                        onChange={(e) => zetRegel(i, "btw", e.target.value)}
                      >
                        {[...new Set([standaardProcent, ...BTW_TARIEVEN])].map((p) => (
                          <option key={p} value={String(p)}>
                            {p}% btw
                          </option>
                        ))}
                      </select>
                      <span
                        className={cn(
                          "ml-auto font-medium tabular-nums",
                          !b.geldig && r.prijs.trim() && "text-destructive",
                        )}
                      >
                        {r.prijs.trim() && !b.geldig ? "?" : `= ${formatPrice(b.totaal)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setRegels((v) => [...v, { ...NIEUWE_REGEL }])}
              >
                <Plus className="size-3.5" />
                Regel erbij
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  setRegels((v) => [
                    ...v,
                    { ...NIEUWE_REGEL, omschrijving: "Korting", eenheid: "", korting: true },
                  ])
                }
              >
                <Korting className="size-3.5" />
                Korting
              </Button>
            </div>
          </PopupBlok>

          {/* --- Totalen -------------------------------------------------- */}
          {totalen.tarieven.length > 0 && (
            <div className="ml-auto w-full max-w-xs space-y-1 rounded-[10px] border border-border p-3 text-[13px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotaal excl. btw</span>
                <span className="tabular-nums">{formatPrice(totalen.excl)}</span>
              </div>
              {totalen.tarieven.map(([procent, t]) => (
                <div key={procent} className="flex justify-between text-muted-foreground">
                  <span>
                    Btw {procent}%
                    {totalen.tarieven.length > 1 && ` over ${formatPrice(t.over)}`}
                  </span>
                  <span className="tabular-nums">{formatPrice(t.btw)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border/70 pt-1 font-medium">
                <span>Te betalen</span>
                <span className="tabular-nums">{formatPrice(totalen.incl)}</span>
              </div>
            </div>
          )}

          {/* --- Opmerking ------------------------------------------------ */}
          <PopupBlok label="Opmerking" info="Komt onder de regels op de factuur. Mag leeg.">
            <textarea
              rows={2}
              maxLength={1000}
              className="w-full resize-y rounded-xl border border-input bg-background/70 px-3 py-2.5 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/25"
              placeholder="Bijvoorbeeld: bedankt voor de opdracht, of een afspraak over de betaling"
              value={opmerking}
              onChange={(e) => setOpmerking(e.target.value)}
            />
          </PopupBlok>
        </PopupBody>
        <PopupVoet
          links={
            <span className="text-[12px] text-muted-foreground">
              Er gaat nog niets weg: dit wordt een concept.
            </span>
          }
        >
          <Button variant="ghost" className="rounded-full" onClick={sluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void maak()}>
            Concept maken
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
