import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconFolder as Folder,
  IconPlus as Plus,
  IconTrash as Trash,
  IconUserOff as UserOff,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { StopDialog } from "@/components/StopDialog";
import {
  bewaarGeldloopDossier,
  fetchGeldloopDossier,
  geldloopStoppen,
  type GeldloopAdres,
  type GeldloopDossierData,
} from "@/lib/geldlopen";
import {
  INTERVALLEN,
  intervalLabels,
  ritmeLabel,
  ritmeVarianten,
  zelfdeRitme,
} from "@/lib/klanten";

const MAANDEN = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

type Werk = {
  id: string;
  maanden: string[];
  jaar?: number;
  notitie: string;
  extra: string;
  /** Het stuk werk zoals het in de database staat (met duur e.d.): dat blijft
   *  zoals het is, de geldloper haalt het alleen weg of zet een meerprijs. */
  orig?: GeldloopDossierData["adres"]["maandwerk"][number];
};

function leesBedrag(tekst: string): number | null {
  const schoon = tekst.replace(/[€\s]/g, "").replace(",", ".");
  if (schoon === "") return 0;
  const n = Number(schoon);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function alsTekst(n: number | undefined | null): string {
  return n ? String(n).replace(".", ",") : "";
}

/**
 * Het dossier zoals de geldloper het aan de deur nodig heeft: de klant, de
 * notitie, prijs en frequentie, extra werk, en laten stoppen. Alleen tijdens
 * zijn avond; de database controleert dat. Alles wat hij verandert, ziet de
 * eigenaar terug in het avondoverzicht, met Ongedaan maken.
 */
export function GeldloopDossier({
  open,
  adres,
  onSluit,
  onVeranderd,
}: {
  open: boolean;
  adres: GeldloopAdres;
  onSluit: () => void;
  onVeranderd: () => void;
}) {
  const dossier = useQuery({
    queryKey: ["geldloop-dossier", adres.id],
    queryFn: () => fetchGeldloopDossier(adres.id),
    enabled: open,
  });
  const [stoppen, setStoppen] = useState(false);

  return (
    <>
      <Dialog open={open && !stoppen} onOpenChange={(o) => !o && onSluit()}>
        <PopupKader className="sm:max-w-lg">
          <PopupKop
            icoon={<Folder className="size-[22px]" />}
            titel={`${adres.straat} ${adres.house_number}${adres.addition}`}
            subtitel={adres.naam || "Dossier"}
          />
          {dossier.isLoading ? (
            <PopupBody>
              <p className="text-[13px] text-muted-foreground">Laden…</p>
            </PopupBody>
          ) : dossier.isError ? (
            <PopupBody>
              <p className="text-[13px] text-tint-rood-ink">{(dossier.error as Error).message}</p>
            </PopupBody>
          ) : dossier.data ? (
            <Formulier
              data={dossier.data}
              onSluit={onSluit}
              onStoppen={() => setStoppen(true)}
              onBewaard={() => {
                void dossier.refetch();
                onVeranderd();
              }}
            />
          ) : null}
        </PopupKader>
      </Dialog>
      <StopDialog
        open={stoppen}
        onOpenChange={(o) => {
          if (!o) setStoppen(false);
        }}
        titel={adres.naam || `${adres.straat} ${adres.house_number}${adres.addition}`}
        omschrijving={`${adres.straat} ${adres.house_number}${adres.addition}`}
        // De geldloper ziet de planning niet; de wasdagen vanaf morgen gaan
        // mee weg en de eigenaar kan het terugdraaien.
        telDagen={async () => ({ dagen: [], aantal: 0 })}
        metKlant={!!adres.naam}
        onBevestig={async (reden) => {
          await geldloopStoppen(adres.id, reden);
          toast.success(
            `${adres.straat} ${adres.house_number}${adres.addition} is gestopt. De eigenaar ziet het in het avondoverzicht.`,
          );
          setStoppen(false);
          onVeranderd();
          onSluit();
        }}
      />
    </>
  );
}

function Formulier({
  data,
  onSluit,
  onStoppen,
  onBewaard,
}: {
  data: GeldloopDossierData;
  onSluit: () => void;
  onStoppen: () => void;
  onBewaard: () => void;
}) {
  const [klant, setKlant] = useState({
    naam: data.klant?.naam ?? "",
    telefoon: data.klant?.telefoon ?? "",
    telefoon2: data.klant?.telefoon2 ?? "",
    email: data.klant?.email ?? "",
    email2: data.klant?.email2 ?? "",
  });
  const [note, setNote] = useState(data.adres.note);
  const [prijs, setPrijs] = useState(alsTekst(data.adres.prijs));
  const [interval, zetInterval] = useState(data.adres.interval_maanden || 1);
  const [ritme, setRitme] = useState(data.adres.ritme || 1);
  const [werk, setWerk] = useState<Werk[]>(() =>
    data.adres.maandwerk.map((w) => ({
      id: w.id ?? crypto.randomUUID(),
      maanden: w.maanden,
      ...(w.jaar ? { jaar: w.jaar } : {}),
      notitie: w.notitie,
      extra: alsTekst(w.id ? data.adres.maandwerk_extra[w.id] : undefined),
      orig: w,
    })),
  );
  const [nieuw, setNieuw] = useState({
    notitie: "",
    maand: String(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2).padStart(2, "0"),
    eenmalig: true,
    extra: "",
  });
  const [bezig, setBezig] = useState(false);
  // Andere frequentie: dezelfde maand binnen de nieuwe cyclus houden (om de
  // 2 in maand 4 = even). Bij openen niets aanpassen.
  useEffect(() => {
    // Altijd vanaf de maand in het dossier rekenen: terug naar de oude
    // frequentie is dan ook weer precies de oude maand.
    const oud = data.adres.ritme || 1;
    setRitme(interval === data.adres.interval_maanden ? oud : ((oud - 1) % interval) + 1);
  }, [interval, data.adres.interval_maanden, data.adres.ritme]);

  function voegToe() {
    if (!nieuw.notitie.trim()) {
      toast.error("Schrijf op wat het extra werk is.");
      return;
    }
    const nu = new Date();
    const maand = Number(nieuw.maand);
    const jaar = maand < nu.getMonth() + 1 ? nu.getFullYear() + 1 : nu.getFullYear();
    setWerk((w) => [
      ...w,
      {
        id: crypto.randomUUID(),
        maanden: [nieuw.maand],
        ...(nieuw.eenmalig ? { jaar } : {}),
        notitie: nieuw.notitie.trim(),
        extra: nieuw.extra,
      },
    ]);
    setNieuw((n) => ({ ...n, notitie: "", extra: "" }));
  }

  async function bewaar() {
    const prijsGetal = leesBedrag(prijs);
    if (prijsGetal === null) {
      toast.error("De prijs is geen bedrag.");
      return;
    }
    const extras: Record<string, number> = {};
    for (const w of werk) {
      const e = leesBedrag(w.extra);
      if (e === null) {
        toast.error(`De meerprijs bij "${w.notitie}" is geen bedrag.`);
        return;
      }
      if (e > 0) extras[w.id] = e;
    }
    const maandwerk = werk.map(
      (w) =>
        w.orig ?? {
          id: w.id,
          maanden: w.maanden,
          ...(w.jaar ? { jaar: w.jaar } : {}),
          notitie: w.notitie,
        },
    );
    const wijzigingen: Record<string, unknown> = {};
    if (note !== data.adres.note) wijzigingen["note"] = note;
    if (
      interval !== data.adres.interval_maanden ||
      !zelfdeRitme(ritme, data.adres.ritme, interval)
    ) {
      wijzigingen["interval_maanden"] = interval;
      wijzigingen["ritme"] = ritme;
    }
    if (JSON.stringify(maandwerk) !== JSON.stringify(data.adres.maandwerk))
      wijzigingen["maandwerk"] = maandwerk;
    if (prijsGetal !== data.adres.prijs) wijzigingen["prijs"] = prijsGetal;
    if (JSON.stringify(extras) !== JSON.stringify(data.adres.maandwerk_extra ?? {}))
      wijzigingen["maandwerk_extra"] = extras;
    const klantWas = data.klant ?? { naam: "", telefoon: "", telefoon2: "", email: "", email2: "" };
    const klantAnders = (Object.keys(klant) as (keyof typeof klant)[]).filter(
      (k) => klant[k].trim() !== (klantWas[k] ?? "").trim(),
    );
    if (klantAnders.length > 0) {
      if (!data.klant && !klant.naam.trim()) {
        toast.error("Vul een naam in voor de nieuwe klant.");
        return;
      }
      wijzigingen["klant"] = Object.fromEntries(klantAnders.map((k) => [k, klant[k].trim()]));
      if (!data.klant) wijzigingen["klant"] = { ...klant };
    }
    if (Object.keys(wijzigingen).length === 0) {
      onSluit();
      return;
    }
    setBezig(true);
    try {
      await bewaarGeldloopDossier(data.adres.id, wijzigingen);
      toast.success("Opgeslagen. De eigenaar ziet het in het avondoverzicht.");
      onBewaard();
      onSluit();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  const veld = (sleutel: keyof typeof klant, placeholder: string, type = "text") => (
    <PopupVeld>
      <Input
        type={type}
        className={popupInvoer}
        placeholder={placeholder}
        value={klant[sleutel]}
        onChange={(e) => setKlant((k) => ({ ...k, [sleutel]: e.target.value }))}
      />
    </PopupVeld>
  );

  return (
    <>
      <PopupBody>
        <PopupBlok label={data.klant ? "De klant" : "Nieuwe klant op dit adres"}>
          {veld("naam", "Naam")}
          <PopupPaar>
            {veld("telefoon", "Telefoon", "tel")}
            {veld("telefoon2", "Tweede telefoon", "tel")}
          </PopupPaar>
          <PopupPaar>
            {veld("email", "E-mail", "email")}
            {veld("email2", "Tweede e-mail", "email")}
          </PopupPaar>
        </PopupBlok>

        <PopupBlok label="Prijs en frequentie">
          <PopupPaar>
            <PopupVeld icoon={<span className="text-sm">€</span>}>
              <Input
                inputMode="decimal"
                className={`${popupInvoer} tabular-nums`}
                value={prijs}
                onChange={(e) => setPrijs(e.target.value)}
              />
            </PopupVeld>
            <PopupVeld>
              <select
                className="h-9 w-full bg-transparent text-[14px] outline-none"
                value={interval}
                onChange={(e) => zetInterval(Number(e.target.value))}
              >
                {INTERVALLEN.map((n) => (
                  <option key={n} value={n}>
                    {intervalLabels[n]}
                  </option>
                ))}
              </select>
            </PopupVeld>
          </PopupPaar>
          {interval > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {ritmeVarianten(interval).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRitme(r)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    zelfdeRitme(ritme, r, interval)
                      ? "border-transparent bg-tint-amber text-tint-amber-ink"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {ritmeLabel({ interval_maanden: interval, ritme: r })}
                </button>
              ))}
            </div>
          )}
        </PopupBlok>

        <PopupBlok label="Notitie">
          <Textarea
            rows={2}
            className="rounded-[12px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </PopupBlok>

        <PopupBlok label="Extra werk">
          {werk.length > 0 && (
            <div className="divide-y divide-border/70 rounded-[12px] border border-border">
              {werk.map((w) => (
                <div key={w.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    {w.notitie}
                    <span className="block text-[11.5px] text-muted-foreground">
                      {w.maanden.map((m) => MAANDEN[Number(m) - 1]).join(", ")}
                      {w.jaar ? ` ${w.jaar}, eenmalig` : ", elk jaar"}
                    </span>
                  </span>
                  <Input
                    inputMode="decimal"
                    aria-label="Meerprijs"
                    className="h-8 w-20 rounded-full text-right tabular-nums"
                    placeholder="€ 0"
                    value={w.extra}
                    onChange={(e) =>
                      setWerk((lijst) =>
                        lijst.map((x) => (x.id === w.id ? { ...x, extra: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Weghalen"
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-surface"
                    onClick={() => setWerk((lijst) => lijst.filter((x) => x.id !== w.id))}
                  >
                    <Trash className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              className="h-9 min-w-0 flex-1 rounded-full"
              placeholder="Bijv. dakgoot, serre"
              value={nieuw.notitie}
              onChange={(e) => setNieuw((n) => ({ ...n, notitie: e.target.value }))}
            />
            <select
              aria-label="Maand"
              className="h-9 rounded-full border border-border bg-card px-2 text-[13px]"
              value={nieuw.maand}
              onChange={(e) => setNieuw((n) => ({ ...n, maand: e.target.value }))}
            >
              {MAANDEN.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </select>
            <Input
              inputMode="decimal"
              aria-label="Meerprijs nieuw werk"
              className="h-9 w-20 rounded-full text-right"
              placeholder="€ 0"
              value={nieuw.extra}
              onChange={(e) => setNieuw((n) => ({ ...n, extra: e.target.value }))}
            />
            <label className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <input
                type="checkbox"
                checked={!nieuw.eenmalig}
                onChange={(e) => setNieuw((n) => ({ ...n, eenmalig: !e.target.checked }))}
              />
              elk jaar
            </label>
            <Button size="sm" variant="outline" className="rounded-full" onClick={voegToe}>
              <Plus className="size-4" /> Erbij
            </Button>
          </div>
        </PopupBlok>
      </PopupBody>
      <PopupVoet>
        {!data.adres.inactief_op && (
          <Button
            variant="ghost"
            className="mr-auto rounded-full text-tint-rood-ink"
            onClick={onStoppen}
          >
            <UserOff className="size-4" /> Laten stoppen
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={onSluit}>
          Annuleren
        </Button>
        <Button className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
          {bezig ? "Bezig…" : "Opslaan"}
        </Button>
      </PopupVoet>
    </>
  );
}
