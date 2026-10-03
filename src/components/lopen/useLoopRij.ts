/**
 * Wat de drie weergaven van een loopadres delen: de kleuren per uitkomst en
 * het bewaren. De kaart (LoopAdresRij), de tegel op de telefoon (LoopTegel)
 * en de tabelrij op de computer (LoopTabelRij) tekenen elk op hun eigen
 * manier, maar bewaren op dezelfde.
 */
import { useEffect, useRef, useState } from "react";

import {
  foutTekst,
  leesPrijs,
  prijsTekst,
  type LoopAdres,
  type LoopPatch,
  type LoopVoorstel,
  type Uitkomst,
} from "@/lib/lopen";

/** De kleur van een uitkomstknop die aan staat. */
export const KNOP_AAN: Record<Uitkomst, string> = {
  niet_thuis: "border-transparent bg-tint-amber text-tint-amber-ink",
  interesse: "border-transparent bg-tint-blauw text-tint-blauw-ink",
  ja: "border-transparent bg-tint-groen text-tint-groen-ink",
  nee: "border-transparent bg-tint-rood text-tint-rood-ink",
};

/** De kleur van een vak of pil met die uitkomst; "nee" blijft grijs. */
export const UITKOMST_VLAK: Record<Uitkomst, string> = {
  niet_thuis: "bg-tint-amber text-tint-amber-ink",
  interesse: "bg-tint-blauw text-tint-blauw-ink",
  ja: "bg-tint-groen text-tint-groen-ink",
  nee: "bg-muted text-muted-foreground",
};

export const NOTITIE_HINT =
  "Schrijf over het huis, niet over de bewoner. Niets over gezondheid, geloof of andere gevoelige zaken.";

export interface LoopRijProps {
  rij: LoopAdres;
  /** Het prijsvoorstel voor dit adres, als er een is. */
  voorstel: LoopVoorstel | null;
  /** Bewaart en gooit bij een fout; de lijst zet de nieuwe stand alvast neer. */
  onBewaar: (id: string, patch: LoopPatch) => Promise<void>;
  /** Ja: eerst bewaren, dan het venster voor de nieuwe klant. */
  onJa: (rij: LoopAdres) => Promise<void>;
  /** Zonder eigen rand en schaduw: de kaart staat al in een vak. */
  kaal?: boolean;
}

/** Wat een adres kan: een uitkomst tikken, een prijs en een notitie invullen. */
export function useLoopRij({
  rij,
  onBewaar,
  onJa,
}: Pick<LoopRijProps, "rij" | "onBewaar" | "onJa">) {
  const [fout, setFout] = useState<{ melding: string; opnieuw?: () => void } | null>(null);
  const [prijs, setPrijs] = useState(prijsTekst(rij.prijs));
  const prijsBezig = useRef(false);
  const [notitie, setNotitie] = useState(rij.notitie);
  const notitieBezig = useRef(false);

  // Wat een collega intikte overnemen, maar niet terwijl jij zelf typt.
  useEffect(() => {
    if (!prijsBezig.current) setPrijs(prijsTekst(rij.prijs));
  }, [rij.prijs]);
  useEffect(() => {
    if (!notitieBezig.current) setNotitie(rij.notitie);
  }, [rij.notitie]);

  // Verdwijnt de rij terwijl je nog typt (scherm gekanteld, blad dicht zonder
  // dat het veld is losgelaten), dan alsnog bewaren wat er stond. Een fout
  // meldt de lijst zelf, want deze rij is er dan niet meer.
  const laatste = useRef({ rij, prijs, notitie, onBewaar });
  useEffect(() => {
    laatste.current = { rij, prijs, notitie, onBewaar };
  });
  useEffect(
    () => () => {
      const l = laatste.current;
      const patch: LoopPatch = {};
      const bedrag = leesPrijs(l.prijs);
      if (prijsBezig.current && bedrag !== undefined && bedrag !== l.rij.prijs)
        patch.prijs = bedrag;
      if (notitieBezig.current && l.notitie !== l.rij.notitie) patch.notitie = l.notitie;
      if (Object.keys(patch).length > 0) l.onBewaar(l.rij.id, patch).catch(() => {});
    },
    [],
  );

  async function bewaar(patch: LoopPatch) {
    setFout(null);
    try {
      await onBewaar(rij.id, patch);
    } catch (e) {
      setFout({ melding: foutTekst(e), opnieuw: () => void bewaar(patch) });
    }
  }

  async function tik(u: Uitkomst) {
    if (u === "ja") {
      setFout(null);
      try {
        await onJa(rij);
      } catch (e) {
        setFout({ melding: foutTekst(e), opnieuw: () => void tik("ja") });
      }
      return;
    }
    if (rij.uitkomst === u) return;
    await bewaar({ uitkomst: u });
  }

  function prijsKlaar() {
    prijsBezig.current = false;
    const waarde = leesPrijs(prijs);
    if (waarde === undefined) {
      setFout({ melding: "Dit is geen bedrag. Typ bijvoorbeeld 14,50." });
      return;
    }
    if (waarde === rij.prijs) return;
    void bewaar({ prijs: waarde });
  }

  function notitieKlaar() {
    notitieBezig.current = false;
    if (notitie === rij.notitie) return;
    void bewaar({ notitie });
  }

  return {
    fout,
    bewaar,
    tik,
    prijs,
    setPrijs,
    prijsFocus: () => {
      prijsBezig.current = true;
    },
    prijsKlaar,
    neemOver: (v: LoopVoorstel) => {
      setPrijs(prijsTekst(v.voorstel));
      void bewaar({ prijs: v.voorstel });
    },
    notitie,
    setNotitie,
    notitieFocus: () => {
      notitieBezig.current = true;
    },
    notitieKlaar,
    wisNotitie: () => {
      notitieBezig.current = false;
      setNotitie("");
      void bewaar({ notitie: "" });
    },
  };
}
