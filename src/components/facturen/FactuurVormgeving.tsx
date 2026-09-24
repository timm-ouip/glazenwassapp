/**
 * Hoe de factuur eruitziet: eigen briefpapier en wat erop komt.
 *
 * Het voorbeeld rechts is geen tekening van een factuur, maar een echte
 * factuur-PDF die de server op dezelfde manier maakt als de facturen die de
 * deur uit gaan -- met verzonnen gegevens, zonder nummer, en er wordt niets
 * bewaard. Een voorbeeld dat in de browser nagebouwd zou zijn, gaat op den
 * duur afwijken van het papier dat de klant krijgt, en dan kijk je naar een
 * leugen.
 *
 * De maten zijn millimeters: zo kun je een uitdraai naast je briefpapier
 * leggen en het met een liniaal nameten.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconTrash as Trash2, IconUpload as Upload } from "@tabler/icons-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  bewaarFactuurVorm,
  BRIEFPAPIER_SOORTEN,
  fetchFactuurVorm,
  STANDAARD_VORM,
  uploadBriefpapier,
  verwijderBriefpapier,
  voorbeeldFactuur,
  type FactuurVorm,
} from "@/lib/facturen";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Kleuren die op wit papier leesbaar blijven; zwart is "geen kleur". */
const KLEUREN = [
  { waarde: "", naam: "Zwart" },
  { waarde: "#1d4ed8", naam: "Blauw" },
  { waarde: "#0f766e", naam: "Groen" },
  { waarde: "#b45309", naam: "Oranje" },
  { waarde: "#9f1239", naam: "Rood" },
  { waarde: "#4338ca", naam: "Paars" },
];

export function FactuurVormgeving({ mag }: { mag: boolean }) {
  const { company } = useAuth();
  const bedrijfId = company?.id ?? "";
  const bewaard = useQuery({
    queryKey: ["factuur-vorm", bedrijfId],
    queryFn: () => fetchFactuurVorm(bedrijfId),
    enabled: Boolean(bedrijfId),
  });

  const [vorm, setVorm] = useState<FactuurVorm>(STANDAARD_VORM);
  const [bezig, setBezig] = useState(false);
  const [proef, setProef] = useState("");
  const [proefBezig, setProefBezig] = useState(false);
  const [proefFout, setProefFout] = useState("");
  const kiezer = useRef<HTMLInputElement>(null);
  /** Welke proef de laatste is, en welke blob er nu in beeld staat. */
  const laatsteAanvraag = useRef(0);
  const laatsteProef = useRef("");

  useEffect(() => {
    const binnen = bewaard.data;
    if (!binnen) return;
    // Alleen overnemen als er echt iets anders staat. Na het opslaan komt
    // dezelfde vorm terug, en met een nieuw object erin zou het scherm
    // opnieuw tekenen en de proef nog een keer bestellen.
    setVorm((vorig) => (gelijk(vorig, binnen) ? vorig : binnen));
  }, [bewaard.data]);

  function zet<K extends keyof FactuurVorm>(sleutel: K, waarde: FactuurVorm[K]) {
    setVorm((vorig) => ({ ...vorig, [sleutel]: waarde }));
  }

  /** De proef opnieuw ophalen. Het briefpapier komt uit de opslagbak, de rest
   *  gaat mee zoals het nu op het scherm staat -- dus ook wat nog niet
   *  opgeslagen is. */
  const haalProef = useCallback(async (huidig: FactuurVorm) => {
    // Een zwaar briefpapier maakt de ene proef trager dan de volgende. Zonder
    // volgnummer landt zo'n trage dan als laatste, en kijk je naar een
    // instelling die je net veranderd hebt.
    const mijn = (laatsteAanvraag.current += 1);
    setProefBezig(true);
    setProefFout("");
    try {
      const blob = await voorbeeldFactuur(huidig);
      if (mijn !== laatsteAanvraag.current) return;
      const nieuw = URL.createObjectURL(blob);
      if (laatsteProef.current) URL.revokeObjectURL(laatsteProef.current);
      laatsteProef.current = nieuw;
      setProef(nieuw);
    } catch (e) {
      if (mijn !== laatsteAanvraag.current) return;
      setProefFout(e instanceof Error ? e.message : String(e));
    } finally {
      if (mijn === laatsteAanvraag.current) setProefBezig(false);
    }
  }, []);

  // Even wachten met ophalen: aan een schuifje trekken is tientallen
  // wijzigingen achter elkaar, en elke proef is een echte PDF op de server.
  useEffect(() => {
    if (!bedrijfId || !bewaard.data) return;
    const klok = setTimeout(() => void haalProef(vorm), 500);
    return () => clearTimeout(klok);
  }, [bedrijfId, bewaard.data, haalProef, vorm]);

  // De laatste proef weer vrijgeven als dit scherm dichtgaat. Via de ref en
  // niet via setProef: op een scherm dat al weg is voert React zo'n opdracht
  // niet meer uit, en dan blijft de PDF in het geheugen van de browser staan.
  useEffect(() => {
    return () => {
      if (laatsteProef.current) URL.revokeObjectURL(laatsteProef.current);
      laatsteProef.current = "";
    };
  }, []);

  async function kiesBestand(bestand: File) {
    if (!bedrijfId) return;
    setBezig(true);
    try {
      const oud = vorm.briefpapier_pad;
      const pad = await uploadBriefpapier(bedrijfId, bestand);
      // Het pad hangt aan de soort (.pdf/.png/.jpg). Wisselt die, dan zou het
      // oude bestand blijven liggen zonder dat iets er nog naar wijst.
      if (oud && oud !== pad) await verwijderBriefpapier(oud).catch(() => undefined);
      const nieuw = { ...vorm, briefpapier_pad: pad };
      await bewaarFactuurVorm(bedrijfId, nieuw);
      setVorm(nieuw);
      await bewaard.refetch();
      toast.success("Briefpapier opgeslagen.");
    } catch (e) {
      toast.error("Uploaden mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  async function haalWeg() {
    if (!bedrijfId || !vorm.briefpapier_pad) return;
    setBezig(true);
    try {
      await verwijderBriefpapier(vorm.briefpapier_pad);
      const nieuw = { ...vorm, briefpapier_pad: null };
      await bewaarFactuurVorm(bedrijfId, nieuw);
      setVorm(nieuw);
      await bewaard.refetch();
      toast.success("Briefpapier weggehaald.");
    } catch (e) {
      toast.error("Weghalen mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  async function opslaan() {
    if (!bedrijfId) return;
    setBezig(true);
    try {
      await bewaarFactuurVorm(bedrijfId, vorm);
      await bewaard.refetch();
      toast.success("Vormgeving opgeslagen.");
    } catch (e) {
      toast.error("Opslaan mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  const heeftPapier = Boolean(vorm.briefpapier_pad);
  const soort = vorm.briefpapier_pad?.split(".").pop()?.toUpperCase() ?? "";
  const veranderd = bewaard.data ? !gelijk(bewaard.data, vorm) : false;

  if (bewaard.isLoading) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div className="grid max-w-6xl items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <Vak
          titel="Briefpapier"
          uitleg="Een PDF of afbeelding van één A4 die als achtergrond onder elke bladzijde van de factuur komt. Staat je logo, adres en KvK er al op, zet dan hieronder de kop en de voet uit."
        >
          <input
            ref={kiezer}
            type="file"
            accept={BRIEFPAPIER_SOORTEN.join(",")}
            className="hidden"
            onChange={(e) => {
              const bestand = e.target.files?.[0];
              e.target.value = "";
              if (bestand) void kiesBestand(bestand);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={heeftPapier ? "outline" : "default"}
              className="rounded-full"
              disabled={!mag || bezig}
              onClick={() => kiezer.current?.click()}
            >
              <Upload className="size-3.5" />
              {heeftPapier ? "Vervangen" : "Briefpapier kiezen"}
            </Button>
            {heeftPapier && (
              <>
                <span className="text-[12.5px] text-muted-foreground">
                  Er staat een {soort} klaar.
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground"
                  disabled={!mag || bezig}
                  onClick={() => void haalWeg()}
                >
                  <Trash2 className="size-3.5" />
                  Weghalen
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Hooguit 2 MB, en liefst veel minder: dit bestand gaat als achtergrond mee in élke
            factuurmail. Een PDF blijft scherp en blijft klein; een foto wordt over de hele
            bladzijde uitgerekt en maakt elke factuur zo zwaar als de foto zelf.
          </p>
        </Vak>

        <Vak
          titel="Ruimte voor het briefpapier"
          uitleg="Hoeveel de tekst boven- en onderaan vrijlaat. Te weinig en de tekst loopt door je logo; te veel en de factuur begint halverwege."
        >
          <Schuif
            label="Bovenaan vrij"
            waarde={vorm.kader_boven}
            max={80}
            mag={mag}
            onChange={(n) => zet("kader_boven", n)}
          />
          <Schuif
            label="Onderaan vrij"
            waarde={vorm.kader_onder}
            max={60}
            mag={mag}
            onChange={(n) => zet("kader_onder", n)}
          />
        </Vak>

        <Vak
          titel="Wat wij er zelf op zetten"
          uitleg="Zet deze uit zodra je briefpapier ze zelf al draagt — anders staat alles er twee keer."
        >
          <Knopje
            label="Naam en adres bovenaan"
            aan={vorm.eigen_kop}
            mag={mag}
            onChange={(b) => zet("eigen_kop", b)}
          />
          <Knopje
            label="KvK, btw-nummer en IBAN onderaan"
            aan={vorm.eigen_voet}
            mag={mag}
            onChange={(b) => zet("eigen_voet", b)}
          />
        </Vak>

        <Vak titel="Kleur" uitleg="Voor de kop, de lijnen en het bedrag dat betaald moet worden.">
          <div className="flex flex-wrap gap-2">
            {KLEUREN.map((k) => (
              <button
                key={k.waarde || "zwart"}
                type="button"
                disabled={!mag}
                onClick={() => zet("kleur", k.waarde)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] ${
                  vorm.kleur === k.waarde ? "border-foreground" : "border-border"
                }`}
              >
                <span
                  className="size-3 rounded-full"
                  style={{ background: k.waarde || "#1a1a1f" }}
                />
                {k.naam}
              </button>
            ))}
          </div>
        </Vak>

        <Vak
          titel="Eigen tekst"
          uitleg="De koptekst staat boven de regels, de voettekst onderaan de factuur."
        >
          <div className="space-y-1">
            <Label className="text-[12.5px]">Koptekst</Label>
            <Textarea
              rows={2}
              maxLength={600}
              disabled={!mag}
              className="text-[13.5px]"
              placeholder="Bijvoorbeeld: Hierbij de factuur voor het glazenwassen van de afgelopen maand."
              value={vorm.koptekst}
              onChange={(e) => zet("koptekst", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[12.5px]">Voettekst</Label>
            <Textarea
              rows={2}
              maxLength={600}
              disabled={!mag}
              className="text-[13.5px]"
              placeholder="Bijvoorbeeld: Vragen over deze factuur? Bel of mail gerust."
              value={vorm.voettekst}
              onChange={(e) => zet("voettekst", e.target.value)}
            />
          </div>
        </Vak>

        {mag && (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="rounded-full"
              disabled={bezig || !veranderd}
              onClick={() => void opslaan()}
            >
              Opslaan
            </Button>
            {veranderd && (
              <span className="text-[12.5px] text-muted-foreground">
                Het voorbeeld hiernaast loopt al vooruit; opslaan maakt het ook echt zo.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 lg:sticky lg:top-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Voorbeeld</h3>
          <span className="text-[12px] text-muted-foreground">
            {proefBezig ? "bezig…" : "verzonnen gegevens"}
          </span>
        </div>
        {proefFout ? (
          <p className="rounded-[10px] border border-border p-3 text-[12.5px] text-muted-foreground">
            Het voorbeeld kwam er niet uit: {proefFout}
          </p>
        ) : proef ? (
          <iframe
            src={proef}
            title="Voorbeeld van de factuur"
            className="aspect-[1/1.414] w-full rounded-[10px] border border-border bg-white"
          />
        ) : (
          <div className="aspect-[1/1.414] w-full animate-pulse rounded-[10px] border border-border bg-muted/40" />
        )}
        <p className="text-[12px] text-muted-foreground">
          Dit is een echte factuur-PDF, gemaakt door dezelfde server die ze verstuurt. Er komt geen
          factuurnummer aan te pas en er wordt niets bewaard.
        </p>
      </div>
    </div>
  );
}

/** Twee vormen naast elkaar leggen; de velden zijn allemaal plat. */
function gelijk(a: FactuurVorm, b: FactuurVorm): boolean {
  return (Object.keys(a) as (keyof FactuurVorm)[]).every((k) => a[k] === b[k]);
}

function Vak({
  titel,
  uitleg,
  children,
}: {
  titel: string;
  uitleg: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[14px] border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">{titel}</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{uitleg}</p>
      </div>
      {children}
    </section>
  );
}

function Schuif({
  label,
  waarde,
  max,
  mag,
  onChange,
}: {
  label: string;
  waarde: number;
  max: number;
  mag: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-[12.5px]">{label}</Label>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">{waarde} mm</span>
      </div>
      <Slider
        value={[waarde]}
        min={0}
        max={max}
        step={1}
        disabled={!mag}
        onValueChange={([n]) => onChange(n ?? 0)}
      />
    </div>
  );
}

function Knopje({
  label,
  aan,
  mag,
  onChange,
}: {
  label: string;
  aan: boolean;
  mag: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[13px]">{label}</span>
      <Switch checked={aan} disabled={!mag} onCheckedChange={onChange} />
    </label>
  );
}
