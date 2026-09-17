/**
 * Paaltje instellen: in welke categorieën hij mail indeelt, hoe zelfstandig hij
 * per categorie is, en de vaste afspraken waar hij zich aan houdt.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck as Check,
  IconPlus as Plus,
  IconTrash as Trash2,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  fetchAfspraken,
  fetchCategorieen,
  legAfspraakWeg,
  legCategorieWeg,
  niveausVoor,
  nieuweAfspraak,
  nieuweCategorie,
  wijzigCategorie,
  zetAfspraak,
  ZELFSTANDIGHEID,
  type Zelfstandigheid,
} from "@/lib/paaltje";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function melding(e: unknown) {
  toast.error(e instanceof Error ? e.message : String(e));
}

export function PaaltjeCategorieen({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const categorieen = useQuery({
    queryKey: ["mail-categorieen"],
    queryFn: fetchCategorieen,
    enabled: isEigenaar,
  });
  const [naam, setNaam] = useState("");
  const [omschrijving, setOmschrijving] = useState("");

  if (!isEigenaar) {
    return (
      <p className="text-[13px] text-muted-foreground">Alleen de eigenaar kan Paaltje instellen.</p>
    );
  }
  const ververs = () => void qc.invalidateQueries({ queryKey: ["mail-categorieen"] });

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-[12px] border border-border">
        {(categorieen.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{c.naam}</p>
              {c.omschrijving && (
                <p className="text-[12px] text-muted-foreground">{c.omschrijving}</p>
              )}
            </div>
            <select
              aria-label={`Wat Paaltje mag bij ${c.naam}`}
              value={c.zelfstandigheid}
              onChange={(e) =>
                void wijzigCategorie(c.id, { zelfstandigheid: e.target.value as Zelfstandigheid })
                  .then(ververs)
                  .catch(melding)
              }
              className="h-8 rounded-[8px] border border-input bg-background px-2 text-[12.5px]"
              title={ZELFSTANDIGHEID[c.zelfstandigheid].uitleg}
            >
              {niveausVoor(c).map((n) => (
                <option key={n} value={n}>
                  {ZELFSTANDIGHEID[n].naam}
                </option>
              ))}
            </select>
            <label
              className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
              title="Paaltje beantwoordt een WhatsApp in deze categorie zelf, na de wachttijd, als het nummer bij een klant hoort en hij heel zeker is."
            >
              <input
                type="checkbox"
                checked={c.zelf_antwoorden_whatsapp}
                onChange={(e) =>
                  void wijzigCategorie(c.id, { zelf_antwoorden_whatsapp: e.target.checked })
                    .then(ververs)
                    .catch(melding)
                }
                className="size-4 accent-primary"
              />
              WhatsApp zelf
            </label>
            {!c.sleutel && (
              <button
                type="button"
                aria-label={`${c.naam} weggooien`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  const ja = await bevestig({
                    titel: `${c.naam} weggooien?`,
                    tekst:
                      "Paaltje deelt geen nieuwe mail meer in deze categorie in. Oude mail houdt zijn label.",
                    bevestigLabel: "Weggooien",
                    gevaarlijk: true,
                  });
                  if (ja) void legCategorieWeg(c.id).then(ververs).catch(melding);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <details className="rounded-[12px] border border-dashed border-border px-3 py-2 text-[13px]">
        <summary className="cursor-pointer text-muted-foreground">Wat betekenen de keuzes?</summary>
        <ul className="mt-2 space-y-1 text-[12.5px] text-muted-foreground">
          {Object.values(ZELFSTANDIGHEID).map((z) => (
            <li key={z.naam}>
              <span className="font-medium text-foreground">{z.naam}:</span> {z.uitleg}
            </li>
          ))}
          <li>
            Zelf doorvoeren kan alleen bij Overslaan; een klant laten stoppen doet Paaltje nooit
            zelf.
          </li>
          <li>
            <span className="font-medium text-foreground">WhatsApp zelf:</span> Paaltje beantwoordt
            een WhatsApp in deze categorie zelf, na de wachttijd en binnen de antwoordtijden (in te
            stellen bij WhatsApp). Alleen als het nummer bij een klant hoort en hij heel zeker is.
            Bij WhatsApp voert hij overslaan ook zelf door als het op voorstellen staat, want een
            nummer is lastig na te maken.
          </li>
        </ul>
      </details>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!naam.trim()) return;
          void nieuweCategorie(naam, omschrijving)
            .then(() => {
              setNaam("");
              setOmschrijving("");
              ververs();
              toast.success("Categorie toegevoegd.");
            })
            .catch(melding);
        }}
      >
        <Input
          aria-label="Naam van de nieuwe categorie"
          placeholder="Nieuwe categorie, bijv. Facturen"
          value={naam}
          maxLength={60}
          onChange={(e) => setNaam(e.target.value)}
          className="h-9 min-w-[10rem] flex-1"
        />
        <Input
          aria-label="Waar gaat deze categorie over"
          placeholder="Waar gaat het over? (voor Paaltje)"
          value={omschrijving}
          maxLength={300}
          onChange={(e) => setOmschrijving(e.target.value)}
          className="h-9 min-w-[12rem] flex-[2]"
        />
        <Button type="submit" size="sm" className="h-9 rounded-full" disabled={!naam.trim()}>
          <Plus className="size-3.5" /> Toevoegen
        </Button>
      </form>
    </div>
  );
}

export function PaaltjeAfspraken({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const afspraken = useQuery({
    queryKey: ["paaltje-afspraken"],
    queryFn: fetchAfspraken,
    enabled: isEigenaar,
  });
  const [tekst, setTekst] = useState("");

  if (!isEigenaar) {
    return (
      <p className="text-[13px] text-muted-foreground">Alleen de eigenaar kan Paaltje instellen.</p>
    );
  }
  const ververs = () => void qc.invalidateQueries({ queryKey: ["paaltje-afspraken"] });
  const voorgesteld = (afspraken.data ?? []).filter((a) => a.status === "voorgesteld");
  const goedgekeurd = (afspraken.data ?? []).filter((a) => a.status === "goedgekeurd");

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">
        Regels waar Paaltje zich altijd aan houdt als hij een antwoord schrijft. Bijvoorbeeld:
        &ldquo;Noem bij een prijsvraag altijd dat we eerst komen kijken.&rdquo;
      </p>

      {voorgesteld.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-muted-foreground">Voorgesteld door Paaltje</p>
          {voorgesteld.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 rounded-[10px] bg-tint-paars/60 px-3 py-2 text-[13px]"
            >
              <span className="min-w-0 flex-1">{a.tekst}</span>
              <button
                type="button"
                aria-label="Goedkeuren"
                className="text-tint-groen-ink"
                onClick={() => void zetAfspraak(a.id, "goedgekeurd").then(ververs).catch(melding)}
              >
                <Check className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Afwijzen"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void zetAfspraak(a.id, "afgewezen").then(ververs).catch(melding)}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {goedgekeurd.length > 0 ? (
        <ul className="divide-y divide-border rounded-[12px] border border-border">
          {goedgekeurd.map((a) => (
            <li key={a.id} className="flex items-start gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{a.tekst}</span>
              <button
                type="button"
                aria-label="Afspraak weggooien"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void legAfspraakWeg(a.id).then(ververs).catch(melding)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Nog geen afspraken.</p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tekst.trim()) return;
          void nieuweAfspraak(tekst, null)
            .then(() => {
              setTekst("");
              ververs();
            })
            .catch(melding);
        }}
      >
        <Input
          aria-label="Nieuwe afspraak"
          placeholder="Nieuwe afspraak"
          value={tekst}
          maxLength={500}
          onChange={(e) => setTekst(e.target.value)}
          className="h-9"
        />
        <Button type="submit" size="sm" className="h-9 rounded-full" disabled={!tekst.trim()}>
          <Plus className="size-3.5" /> Toevoegen
        </Button>
      </form>
    </div>
  );
}
