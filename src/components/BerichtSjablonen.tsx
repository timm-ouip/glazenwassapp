import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus as Plus, IconStar as Star, IconTrash as Trash2 } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBevestig } from "@/components/Bevestig";
import {
  bewaarSjabloon,
  fetchRedenen,
  fetchSjablonen,
  legSjabloonWeg,
  maakReden,
  maakStandaard,
  PLAATSHOUDERS,
  SOORT_LABEL,
  vulInVoorbeeld,
  wisReden,
  type Sjabloon,
  type SjabloonSoort,
} from "@/lib/sjablonen";
import { useRecht } from "@/lib/rechten";

const SOORTEN: SjabloonSoort[] = ["aankondiging", "wijziging", "niet_af"];

const UITLEG: Record<SjabloonSoort, string> = {
  aankondiging: "Het bericht dat je stuurt vóór een wasdag.",
  wijziging: "Als een dag verschuift: de nieuwe dag en waarom.",
  niet_af: "Als je niet aan een adres toekwam en later terugkomt.",
};

/**
 * De vaste teksten voor berichten aan klanten, en de snelle redenen bij een
 * wijziging. Per soort kun je er meerdere hebben; de standaard staat al
 * ingevuld als je gaat opstellen.
 */
export function BerichtSjablonen() {
  const magVersturen = useRecht("mail_versturen");
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const sjablonen = useQuery({ queryKey: ["bericht-sjablonen"], queryFn: fetchSjablonen });
  const redenen = useQuery({ queryKey: ["snelle-redenen"], queryFn: fetchRedenen });
  const [open, setOpen] = useState<Sjabloon | null>(null);
  const [nieuweReden, setNieuweReden] = useState("");

  const ververs = () => qc.invalidateQueries({ queryKey: ["bericht-sjablonen"] });

  const opslaan = useMutation({
    mutationFn: (s: Sjabloon) => bewaarSjabloon(s),
    onSuccess: async () => {
      await ververs();
      setOpen(null);
      toast.success("Template opgeslagen");
    },
    onError: (e: Error) => toast.error("Opslaan mislukt: " + e.message),
  });

  async function nieuw(soort: SjabloonSoort) {
    setOpen({
      id: "",
      soort,
      naam: "",
      onderwerp: "",
      tekst: "Beste {{naam}},\n\n\n\nMet vriendelijke groet,",
      wa_sjabloon_id: null,
      standaard: false,
      sort_order: (sjablonen.data ?? []).filter((s) => s.soort === soort).length,
    });
  }

  async function weg(s: Sjabloon) {
    const ja = await bevestig({
      titel: `Template "${s.naam}" weghalen?`,
      tekst: "Berichten die je al verstuurde blijven zoals ze waren.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await legSjabloonWeg(s.id);
      await ververs();
      toast.success("Template weggehaald");
    } catch (e) {
      toast.error("Weghalen mislukt: " + (e as Error).message);
    }
  }

  async function zetStandaard(s: Sjabloon) {
    try {
      await maakStandaard(s.id, s.soort);
      await ververs();
    } catch (e) {
      toast.error("Standaard maken mislukt: " + (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {SOORTEN.map((soort) => {
        const lijst = (sjablonen.data ?? []).filter((s) => s.soort === soort);
        return (
          <div key={soort}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-medium">{SOORT_LABEL[soort]}</h3>
              <span className="text-[12px] text-muted-foreground">{UITLEG[soort]}</span>
            </div>
            <ul className="mt-1.5 divide-y divide-border/60 rounded-[14px] border border-border">
              {lijst.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-muted-foreground">Nog geen template.</li>
              )}
              {lijst.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    title={s.standaard ? "Dit is de standaard" : "Maak dit de standaard"}
                    aria-label={s.standaard ? "Is de standaard" : "Maak standaard"}
                    disabled={!magVersturen || s.standaard}
                    onClick={() => void zetStandaard(s)}
                    className={
                      s.standaard
                        ? "text-tint-amber-ink"
                        : "text-muted-foreground/40 hover:text-foreground"
                    }
                  >
                    <Star className="size-4" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm">{s.naam}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setOpen(s)}
                  >
                    {magVersturen ? "Bewerken" : "Bekijken"}
                  </Button>
                  {magVersturen && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      aria-label={`${s.naam} weghalen`}
                      onClick={() => void weg(s)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {magVersturen && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 rounded-full text-muted-foreground"
                onClick={() => void nieuw(soort)}
              >
                <Plus className="size-4" /> Template erbij
              </Button>
            )}
          </div>
        );
      })}

      {open && (
        <div className="space-y-2 rounded-[14px] border border-border bg-card-header p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sj-naam" className="text-[12.5px]">
                Naam (voor jezelf)
              </Label>
              <Input
                id="sj-naam"
                value={open.naam}
                disabled={!magVersturen}
                onChange={(e) => setOpen({ ...open, naam: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sj-onderwerp" className="text-[12.5px]">
                Onderwerp van de mail
              </Label>
              <Input
                id="sj-onderwerp"
                value={open.onderwerp}
                disabled={!magVersturen}
                onChange={(e) => setOpen({ ...open, onderwerp: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sj-tekst" className="text-[12.5px]">
              Tekst
            </Label>
            <Textarea
              id="sj-tekst"
              rows={8}
              value={open.tekst}
              disabled={!magVersturen}
              onChange={(e) => setOpen({ ...open, tekst: e.target.value })}
            />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Tussen accolades vult de app in:{" "}
            {PLAATSHOUDERS.map((p) => `${p.sleutel} = ${p.uitleg}`).join(" · ")}
          </p>
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted-foreground">Voorbeeld bekijken</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded-[10px] bg-background p-2 font-sans">
              {vulInVoorbeeld(open.tekst)}
            </pre>
          </details>
          <div className="flex items-center gap-2">
            {magVersturen && (
              <Button
                size="sm"
                disabled={opslaan.isPending || !open.naam.trim() || !open.tekst.trim()}
                onClick={() => opslaan.mutate(open)}
              >
                {opslaan.isPending ? "Bezig…" : "Opslaan"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setOpen(null)}>
              Sluiten
            </Button>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-[13px] font-medium">Snelle redenen</h3>
        <p className="text-[12px] text-muted-foreground">
          Wat je aanklikt bij een wijziging; ze komen op de plek van {"{{reden}}"}.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(redenen.data ?? []).map((r) => (
            <span
              key={r.id}
              className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
            >
              {r.tekst}
              {magVersturen && (
                <button
                  type="button"
                  aria-label={`${r.tekst} weghalen`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    void wisReden(r.id)
                      .then(() => qc.invalidateQueries({ queryKey: ["snelle-redenen"] }))
                      .catch((e: unknown) =>
                        toast.error("Weghalen mislukt: " + (e as Error).message),
                      );
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </span>
          ))}
          {magVersturen && (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const tekst = nieuweReden.trim();
                if (!tekst) return;
                void maakReden(tekst, (redenen.data ?? []).length)
                  .then(async () => {
                    setNieuweReden("");
                    await qc.invalidateQueries({ queryKey: ["snelle-redenen"] });
                  })
                  .catch((e: unknown) => toast.error("Toevoegen mislukt: " + (e as Error).message));
              }}
            >
              <Input
                value={nieuweReden}
                placeholder="Nieuwe reden"
                className="h-8 w-40 text-xs"
                onChange={(e) => setNieuweReden(e.target.value)}
              />
              <Button size="sm" variant="outline" type="submit" className="h-8 px-2">
                <Plus className="size-3.5" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
