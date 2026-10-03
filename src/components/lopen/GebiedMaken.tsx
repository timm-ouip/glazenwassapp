/**
 * Een gebied maken om te lopen, of de straten van een gebied aanpassen.
 *
 * Bij een wijk kies je de straten uit die wijk (met hun officiële naam); een
 * los gebied krijgt een eigen naam en plaats. Met "+ Straat zoeken" komt er
 * een straat bij die niet in de wijklijst staat. Daarna haalt hij de adressen
 * uit de BAG, straat voor straat, en bewaart ze.
 *
 * Kent de Locatieserver een straatnaam niet (een afkorting uit de wijklijst),
 * dan bewaart hij nog niets: hij zegt welke straat, met voorstellen voor de
 * officiële naam. Wat al was opgehaald onthoudt hij voor de volgende poging.
 *
 * Straten aanpassen: een straat erbij haalt alleen die straat op; een straat
 * eraf haalt alleen de koppelingen weg (wat je noteerde blijft bewaard).
 *
 * Op de computer kan een nieuw gebied ook "Op de kaart": omcirkelen in plaats
 * van straten kiezen (Kaart.tsx, pas geladen als je dat kiest). Zo'n
 * veelhoek aanpassen kan nog niet; dan maak je een nieuw gebied.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconMap as Kaart,
  IconMapPin as MapPin,
  IconPlus as Plus,
  IconSearch as Search,
  IconTypography as Letters,
  IconWalk as Walk,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Pillen } from "@/components/Pillen";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import type { BagAdres } from "@/lib/bag";
import { fetchDistricts, fetchStreets } from "@/lib/klanten";
import {
  LOOP_TELLINGEN,
  LOOP_VOORSTELLEN,
  bagPlaats,
  foutTekst,
  haalGebiedAdressen,
  haalStraatUitGebied,
  haalVeelhoekGebied,
  maakGebied,
  officieleNaam,
  schrijfGebied,
  wijkstraatVoor,
  wijzigGebied,
  type LoopGebied,
  type OphaalStraat,
} from "@/lib/lopen";
import { zoekStraten, zoekWoonplaatsen } from "@/lib/postcode";

type Soort = "wijk" | "los";
type Manier = "straten" | "kaart";

const KaartTekenen = lazy(() => import("@/components/lopen/Kaart"));

/** Een straat in de vinklijst. */
interface Keuze {
  /** De wijkstraat-id, of "x:" + de naam voor een gezochte straat. */
  sleutel: string;
  /** De officiële naam: daarmee wordt opgehaald. */
  naam: string;
  /** De werknaam uit de wijklijst, als die anders is. */
  werknaam: string;
  street_id: string | null;
}

const gelijk = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function GebiedMaken({
  open,
  onOpenChange,
  gebied = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bestaand gebied: dan pas je de straten aan. Leeg: een nieuw gebied. */
  gebied?: LoopGebied | null;
}) {
  const qc = useQueryClient();
  const wijken = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts, enabled: open });
  const alleStraten = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, enabled: open });

  const [soort, setSoort] = useState<Soort>("wijk");
  const [wijkId, setWijkId] = useState("");
  const [naam, setNaam] = useState("");
  const [losPlaats, setLosPlaats] = useState("");
  const [plaatsVoorstellen, setPlaatsVoorstellen] = useState<string[]>([]);
  const [keuzes, setKeuzes] = useState<Keuze[]>([]);
  const [aan, setAan] = useState<Set<string>>(new Set());
  const [zoek, setZoek] = useState("");
  const [zoekVoorstellen, setZoekVoorstellen] = useState<string[] | null>(null);
  /** Per keuze die de Locatieserver niet kende: de voorstellen. */
  const [nietGevonden, setNietGevonden] = useState<Map<string, string[]>>(new Map());
  const [voortgang, setVoortgang] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [manier, setManier] = useState<Manier>("straten");
  /** De omcirkelde ring in [lon, lat], na Klaar op de kaart. */
  const [ring, setRing] = useState<[number, number][] | null>(null);
  const telefoon = useIsMobile();
  const opKaart = manier === "kaart" && !telefoon && !gebied;
  // Verdwijnt de kaart (Straten gekozen, venster smaller), dan ook de lijn:
  // een nieuwe kaart begint leeg.
  useEffect(() => {
    if (!opKaart) setRing(null);
  }, [opKaart]);
  const onthoud = useRef(new Map<string, BagAdres[]>());
  const afbreken = useRef<AbortController | null>(null);

  const wijk = (wijken.data ?? []).find((w) => w.id === wijkId) ?? null;
  const plaats = soort === "wijk" ? (wijk?.plaats ?? "") : losPlaats;
  const wijkStraten = useMemo(
    () => (alleStraten.data ?? []).filter((s) => s.district_id === wijkId),
    [alleStraten.data, wijkId],
  );

  // Bij elke keer openen opnieuw beginnen.
  useEffect(() => {
    if (!open) {
      afbreken.current?.abort();
      return;
    }
    setSoort(gebied ? (gebied.district_id ? "wijk" : "los") : "wijk");
    setWijkId(gebied?.district_id ?? "");
    setNaam(gebied?.naam ?? "");
    setLosPlaats(gebied?.plaats ?? "");
    setKeuzes([]);
    setAan(new Set());
    setZoek("");
    setZoekVoorstellen(null);
    setNietGevonden(new Map());
    setVoortgang("");
    setFout(null);
    setManier("straten");
    setRing(null);
    onthoud.current = new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // De vinklijst: de straten van de wijk, en bij een bestaand gebied de
  // straten die er al in zitten (aangevinkt).
  useEffect(() => {
    if (!open) return;
    if (soort === "wijk" && wijkId && !alleStraten.data) return;
    const lijst: Keuze[] =
      soort === "wijk"
        ? wijkStraten.map((s) => ({
            sleutel: s.id,
            naam: officieleNaam(s),
            werknaam: s.volledige_naam.trim() && !gelijk(s.name, s.volledige_naam) ? s.name : "",
            street_id: s.id,
          }))
        : [];
    const vinkjes = new Set<string>();
    if (gebied && (gebied.district_id ?? "") === (soort === "wijk" ? wijkId : "")) {
      for (const n of gebied.straten) {
        const ws = soort === "wijk" ? wijkstraatVoor(n, wijkStraten) : null;
        if (ws) {
          vinkjes.add(ws.id);
          // Opgehaald onder een andere (officiële) naam dan de wijklijst zegt.
          const k = lijst.find((x) => x.sleutel === ws.id);
          if (k && !gelijk(k.naam, n)) k.naam = n;
        } else {
          const sleutel = `x:${n.toLowerCase()}`;
          lijst.push({ sleutel, naam: n, werknaam: "", street_id: null });
          vinkjes.add(sleutel);
        }
      }
    }
    setKeuzes(lijst);
    setAan(vinkjes);
    setNietGevonden(new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, soort, wijkId, wijkStraten]);

  // Een nieuw gebied bij een wijk heet standaard naar de wijk.
  useEffect(() => {
    if (!gebied && soort === "wijk" && wijk) setNaam(wijk.name);
  }, [gebied, soort, wijk]);

  // Woonplaatsen voorstellen bij een los gebied.
  useEffect(() => {
    if (!open || soort !== "los" || losPlaats.trim().length < 2) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekWoonplaatsen(losPlaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setPlaatsVoorstellen(namen);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, soort, losPlaats]);

  // Straten zoeken in de plaats.
  useEffect(() => {
    if (!open || zoek.trim().length < 2 || !plaats.trim()) {
      setZoekVoorstellen(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(zoek, bagPlaats(plaats), ac.signal).then((namen) => {
        if (!ac.signal.aborted) setZoekVoorstellen(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, zoek, plaats]);

  function vink(sleutel: string, waarde: boolean) {
    setAan((oud) => {
      const nieuw = new Set(oud);
      if (waarde) nieuw.add(sleutel);
      else nieuw.delete(sleutel);
      return nieuw;
    });
  }

  function voegToe(straatNaam: string) {
    const ws = soort === "wijk" ? wijkstraatVoor(straatNaam, wijkStraten) : null;
    const bestaand = keuzes.find((k) => (ws ? k.sleutel === ws.id : gelijk(k.naam, straatNaam)));
    if (bestaand) {
      vink(bestaand.sleutel, true);
    } else {
      const sleutel = `x:${straatNaam.toLowerCase()}`;
      setKeuzes((oud) => [...oud, { sleutel, naam: straatNaam, werknaam: "", street_id: null }]);
      vink(sleutel, true);
    }
    setZoek("");
    setZoekVoorstellen(null);
  }

  /** Een niet-gevonden straat krijgt de officiële naam uit de voorstellen. */
  function kiesOfficieel(sleutel: string, officieel: string) {
    setKeuzes((oud) => oud.map((k) => (k.sleutel === sleutel ? { ...k, naam: officieel } : k)));
    setNietGevonden((oud) => {
      const nieuw = new Map(oud);
      nieuw.delete(sleutel);
      return nieuw;
    });
  }

  const gekozen = keuzes.filter((k) => aan.has(k.sleutel));

  async function maakOpKaart() {
    setFout(null);
    if (!naam.trim()) return setFout("Geef het gebied een naam.");
    if (soort === "wijk" && !wijk) return setFout("Kies een wijk.");
    if (!ring) return setFout("Omcirkel het gebied op de kaart en kies Klaar.");

    const ac = new AbortController();
    afbreken.current = ac;
    setBezig(true);
    try {
      const { rijen, straten } = await haalVeelhoekGebied(
        ring,
        soort === "wijk" ? wijkStraten : [],
        { onVoortgang: setVoortgang, signal: ac.signal },
      );
      if (rijen.length === 0) return setFout("Binnen deze lijn liggen geen adressen.");
      const id = await maakGebied({
        naam,
        district_id: soort === "wijk" ? wijkId : null,
        // Zonder plaats bij de wijk: die van de adressen zelf.
        plaats: plaats.trim() || rijen[0]!.woonplaats,
        straten,
        veelhoek: ring,
      });
      try {
        const aantal = await schrijfGebied(id, rijen, { onVoortgang: setVoortgang });
        toast.success(`${naam.trim()}: ${aantal} ${aantal === 1 ? "adres" : "adressen"}`);
      } catch (e) {
        toast.error(
          `${naam.trim()} is nog niet compleet: ${foutTekst(e)} Kies in de lijst "Opnieuw ophalen".`,
        );
      }
      onOpenChange(false);
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
      setVoortgang("");
      afbreken.current = null;
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
      void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
    }
  }

  async function opslaan() {
    if (opKaart) return maakOpKaart();
    setFout(null);
    if (!naam.trim()) return setFout("Geef het gebied een naam.");
    if (soort === "wijk" && !wijk) return setFout("Kies een wijk.");
    if (!plaats.trim()) {
      return setFout(
        soort === "wijk"
          ? "Deze wijk heeft nog geen plaats. Vul die eerst in bij de wijkinstellingen."
          : "Vul de plaats in.",
      );
    }
    if (gekozen.length === 0) return setFout("Vink minstens één straat aan.");

    // Bij aanpassen: alleen wat erbij komt ophalen, wat eraf gaat weghalen.
    const oud = gebied?.straten ?? [];
    const erbij = gebied ? gekozen.filter((k) => !oud.some((n) => gelijk(n, k.naam))) : gekozen;
    const eraf = gebied ? oud.filter((n) => !gekozen.some((k) => gelijk(k.naam, n))) : [];

    const ac = new AbortController();
    afbreken.current = ac;
    setBezig(true);
    try {
      const ophalen: OphaalStraat[] = erbij.map((k) => ({ naam: k.naam, street_id: k.street_id }));
      const { rijen, nietGevonden: weg } = await haalGebiedAdressen(ophalen, plaats, {
        onVoortgang: setVoortgang,
        signal: ac.signal,
        onthoud: onthoud.current,
        stopBijNietGevonden: true,
      });

      if (weg.length > 0) {
        // Nog niets bewaren: eerst de goede namen.
        setVoortgang("Voorstellen zoeken…");
        const voorstellen = new Map<string, string[]>();
        for (const n of weg) {
          const k = erbij.find((x) => gelijk(x.naam, n));
          if (!k) continue;
          const namen = await zoekStraten(k.werknaam || n, bagPlaats(plaats), ac.signal);
          voorstellen.set(
            k.sleutel,
            (namen ?? []).filter((x) => !gelijk(x, n)),
          );
        }
        setNietGevonden(voorstellen);
        return;
      }

      const namen = gekozen.map((k) => k.naam);
      if (!gebied) {
        const id = await maakGebied({
          naam,
          district_id: soort === "wijk" ? wijkId : null,
          plaats,
          straten: namen,
        });
        try {
          const aantal = await schrijfGebied(id, rijen, { onVoortgang: setVoortgang });
          toast.success(`${naam.trim()}: ${aantal} ${aantal === 1 ? "adres" : "adressen"}`);
        } catch (e) {
          // Het gebied staat er al; dubbel maken helpt niet. In de lijst staat
          // het als "Onvolledig", met Opnieuw ophalen.
          toast.error(
            `${naam.trim()} is nog niet compleet: ${foutTekst(e)} Kies in de lijst "Opnieuw ophalen".`,
          );
        }
        onOpenChange(false);
        return;
      }

      for (const n of eraf) {
        setVoortgang(`${n} weghalen…`);
        await haalStraatUitGebied(gebied.gebied_id, n);
      }
      // De straatlijst vóór het bewaren: valt dat halverwege weg, dan haalt
      // "Opnieuw ophalen" de goede straten op en niet de oude.
      await wijzigGebied(gebied.gebied_id, { naam: naam.trim(), straten: namen });
      if (rijen.length > 0) {
        await schrijfGebied(gebied.gebied_id, rijen, {
          afmaken: !gebied.onvolledig,
          onVoortgang: setVoortgang,
        });
      }
      toast.success(`${naam.trim()} aangepast`);
      onOpenChange(false);
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
      setVoortgang("");
      afbreken.current = null;
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
      void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
    }
  }

  const alleAan = keuzes.length > 0 && keuzes.every((k) => aan.has(k.sleutel));

  return (
    <Dialog open={open} onOpenChange={(o) => !bezig && onOpenChange(o)}>
      <PopupKader className={opKaart ? "sm:max-w-3xl" : "sm:max-w-lg"}>
        <PopupKop
          icoon={<Walk className="size-[22px]" />}
          titel={gebied ? "Straten aanpassen" : "Nieuw gebied"}
          subtitel={gebied ? gebied.naam : "Waar ga je langs de deur?"}
        />
        <PopupBody>
          {!gebied && (
            <Pillen<Soort>
              label="Soort gebied"
              keuzes={[
                { waarde: "wijk", label: "Bij een wijk" },
                { waarde: "los", label: "Los gebied" },
              ]}
              waarde={soort}
              onChange={setSoort}
              disabled={bezig}
            />
          )}

          {soort === "wijk" && !gebied && (
            <PopupBlok label="Wijk">
              <PopupVeld icoon={<Kaart className="size-4" />}>
                <Select value={wijkId} onValueChange={setWijkId} disabled={bezig}>
                  <SelectTrigger
                    className="h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0"
                    aria-label="Wijk"
                  >
                    <SelectValue placeholder="Kies een wijk…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(wijken.data ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                        {w.plaats ? ` · ${w.plaats}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PopupVeld>
            </PopupBlok>
          )}

          <PopupBlok label="Naam van het gebied">
            <PopupVeld icoon={<Letters className="size-4" />}>
              <Input
                className={popupInvoer}
                placeholder="bijv. Bloemenbuurt"
                value={naam}
                maxLength={100}
                disabled={bezig}
                onChange={(e) => setNaam(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>

          {soort === "los" && (
            <PopupBlok label="Plaats">
              <PopupVeld icoon={<MapPin className="size-4" />}>
                <Input
                  list="loop-plaatsen"
                  className={popupInvoer}
                  placeholder="bijv. 's-Gravenhage"
                  value={losPlaats}
                  disabled={bezig || !!gebied}
                  onChange={(e) => setLosPlaats(e.target.value)}
                />
              </PopupVeld>
              <datalist id="loop-plaatsen">
                {plaatsVoorstellen.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </PopupBlok>
          )}

          {!gebied && (soort === "los" || wijk) && (
            <PopupBlok label="Adressen kiezen">
              {telefoon ? (
                <PopupHint>Omcirkelen kan op de computer.</PopupHint>
              ) : (
                <Pillen<Manier>
                  label="Adressen kiezen"
                  keuzes={[
                    { waarde: "straten", label: "Straten" },
                    { waarde: "kaart", label: "Op de kaart" },
                  ]}
                  waarde={manier}
                  onChange={setManier}
                  disabled={bezig}
                />
              )}
            </PopupBlok>
          )}

          {opKaart && (soort === "los" || wijk) && (
            <PopupBlok label="Op de kaart">
              <Suspense fallback={<PopupHint>Kaart laden…</PopupHint>}>
                <KaartTekenen
                  plaats={bagPlaats(plaats)}
                  straat={wijkStraten[0] ? officieleNaam(wijkStraten[0]) : ""}
                  disabled={bezig}
                  onChange={setRing}
                />
              </Suspense>
            </PopupBlok>
          )}

          {!opKaart && (soort === "los" || wijk) && (
            <PopupBlok
              label="Straten"
              terzijde={gekozen.length > 0 ? `${gekozen.length} gekozen` : undefined}
            >
              {soort === "wijk" && keuzes.length > 0 && (
                <button
                  type="button"
                  disabled={bezig}
                  className="self-start text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() =>
                    setAan(alleAan ? new Set() : new Set(keuzes.map((k) => k.sleutel)))
                  }
                >
                  {alleAan ? "Alles uitvinken" : "Alles aanvinken"}
                </button>
              )}
              {soort === "wijk" && alleStraten.isLoading && <PopupHint>Straten laden…</PopupHint>}
              {keuzes.length === 0 && !alleStraten.isLoading && (
                <PopupHint>
                  {soort === "wijk"
                    ? "Deze wijk heeft nog geen straten. Zoek ze hieronder."
                    : "Zoek hieronder de straten van dit gebied."}
                </PopupHint>
              )}
              <ul className="flex flex-col">
                {keuzes.map((k) => {
                  const voorstellen = nietGevonden.get(k.sleutel);
                  return (
                    <li key={k.sleutel} className="border-b border-border/60 last:border-b-0">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
                        <Checkbox
                          checked={aan.has(k.sleutel)}
                          disabled={bezig}
                          onCheckedChange={(v) => vink(k.sleutel, v === true)}
                          className="size-5"
                        />
                        <span className="min-w-0 flex-1 truncate text-[14px]">
                          {k.naam}
                          {k.werknaam && (
                            <span className="ml-1.5 text-[12px] text-muted-foreground">
                              ({k.werknaam})
                            </span>
                          )}
                        </span>
                      </label>
                      {voorstellen && (
                        <div className="mb-2 rounded-xl bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
                          Niet gevonden: {k.naam}. Kies de officiële naam
                          {voorstellen.length === 0 ? " met Straat zoeken hieronder." : ":"}
                          {voorstellen.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {voorstellen.map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => kiesOfficieel(k.sleutel, v)}
                                  className="min-h-9 rounded-full bg-background/80 px-3 text-[12.5px] font-medium text-foreground hover:bg-background"
                                >
                                  {v}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <PopupVeld icoon={<Search className="size-4" />}>
                <Input
                  className={popupInvoer}
                  placeholder={plaats ? "+ Straat zoeken" : "Eerst een plaats"}
                  value={zoek}
                  disabled={bezig || !plaats}
                  onChange={(e) => setZoek(e.target.value)}
                  aria-label="Straat zoeken"
                />
              </PopupVeld>
              {zoekVoorstellen && (
                <div className="flex flex-col">
                  {zoekVoorstellen.length === 0 ? (
                    <PopupHint>Geen straat gevonden in {plaats}.</PopupHint>
                  ) : (
                    zoekVoorstellen.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => voegToe(v)}
                        className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-[14px] hover:bg-accent"
                      >
                        <Plus className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{v}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </PopupBlok>
          )}

          {voortgang && (
            <p aria-live="polite" className="text-[13px] text-muted-foreground">
              {voortgang}
            </p>
          )}
          {fout && (
            <p
              role="alert"
              className="rounded-xl bg-tint-rood px-3 py-2 text-[13px] text-tint-rood-ink"
            >
              {fout}
            </p>
          )}
        </PopupBody>
        <PopupVoet>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => {
              if (bezig) afbreken.current?.abort();
              else onOpenChange(false);
            }}
          >
            {bezig ? "Stoppen" : "Annuleren"}
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void opslaan()}>
            {bezig ? "Bezig…" : gebied ? "Opslaan" : "Maken en ophalen"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
