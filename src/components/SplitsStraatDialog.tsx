import { useEffect, useRef, useState } from "react";
import {
  IconScissors as Scissors,
  IconSignRight as Signpost,
  IconTypography as Type,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { opslaanBijEnter } from "@/lib/dialoog";
import { formatNumber, straatSleutel, type Customer, type Street } from "@/lib/klanten";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** De straat waar de adressen nu in staan. */
  street: Street | null;
  /** Wat er meegaat naar de nieuwe straat, op volgorde. */
  adressen: Customer[];
  /** Hoeveel actieve adressen deze straat heeft; zo weet je wat er
   *  achterblijft. Gestopte en verhuisde adressen tellen niet mee — die staan
   *  op de klantenpagina. */
  straatAantal: number;
  /** De straatnamen die de wijk al heeft, om een vrije naam voor te stellen. */
  bestaandeNamen: string[];
  onSplitsen: (naam: string, volledig: string) => void;
}

/**
 * "Ameland" → "Ameland 2", en bestaat die al dan "Ameland 3".
 *
 * Een eigen naam en niet nog een keer dezelfde: twee straten met dezelfde
 * naam zijn voor de app een vergissing — daar zet het samenvoegscherm een
 * waarschuwing bij. Je kunt de naam gewoon overtypen als je hem tóch gelijk
 * wilt houden.
 */
function vrijeNaam(basis: string, bestaande: string[]): string {
  const bezet = new Set(bestaande.map(straatSleutel));
  for (let n = 2; n <= 20; n++) {
    const kandidaat = `${basis} ${n}`;
    if (!bezet.has(straatSleutel(kandidaat))) return kandidaat;
  }
  return basis;
}

/**
 * Een straat in tweeën: wat je aangevinkt hebt gaat naar een nieuwe straat,
 * de rest blijft staan. De tegenhanger van het samenvoegen van twee straten
 * met dezelfde naam.
 *
 * Waarvoor: een lange straat die je in twee stukken loopt, of een rij huizen
 * die eigenlijk bij het zijstraatje hoort. Alles gaat mee zoals het is —
 * prijs, notitie, ritme en de kant van de straat — alleen de straat eronder
 * verandert.
 */
export function SplitsStraatDialog({
  open,
  onOpenChange,
  street,
  adressen,
  straatAantal,
  bestaandeNamen,
  onSplitsen,
}: Props) {
  const [naam, setNaam] = useState("");
  const [volledig, setVolledig] = useState("");

  // De straatnamen in een ref, net als in useStabiel: het voorstel mag ze
  // meenemen, maar een lijst die tussendoor ververst hoort niet over je
  // getypte naam heen te schrijven. Deze staat bewust vóór de vulling
  // hieronder, zodat hij in dezelfde beurt al bijgewerkt is.
  const namen = useRef(bestaandeNamen);
  useEffect(() => {
    namen.current = bestaandeNamen;
  });

  // Alleen bij het opengaan invullen: daarna is wat er staat van jou.
  useEffect(() => {
    if (!open || !street) return;
    setNaam(vrijeNaam(street.name, namen.current));
    // De officiële naam gaat mee: het blijft dezelfde straat, en daarmee
    // blijven de postcodes kloppen.
    setVolledig(street.volledige_naam);
  }, [open, street]);

  const blijftAchter = Math.max(0, straatAantal - adressen.length);

  function save() {
    if (!naam.trim()) {
      toast.error("Vul een straatnaam in.");
      return;
    }
    onSplitsen(naam.trim(), volledig.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-md" onKeyDown={opslaanBijEnter(save)}>
        <PopupKop
          // Dezelfde amber als de straatschermpjes: straten hebben in deze app
          // één kleur, waar je ze ook tegenkomt.
          kleur="amber"
          icoon={<Scissors className="size-[22px]" />}
          titel={`“${street?.name ?? ""}” splitsen`}
          subtitel={`${adressen.length} ${adressen.length === 1 ? "adres gaat" : "adressen gaan"} naar een nieuwe straat`}
        />
        <PopupBody>
          <PopupHint>
            De nieuwe straat komt direct onder deze te staan, in dezelfde groep. Prijzen, notities
            en ritmes gaan gewoon mee. Dit kun je met Ongedaan maken terugdraaien.
          </PopupHint>

          <PopupBlok label="Naam op de lijst" info="Kort houden — zo staat hij op de printlijst.">
            <PopupVeld icoon={<Signpost className="size-4" />}>
              <Input
                id="splits-naam"
                autoFocus
                className={popupInvoer}
                placeholder="bijv. Ameland 2"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>

          <PopupBlok
            label="Volledige straatnaam"
            info="De officiële naam, waarmee postcodes opgezocht worden. Bij een gesplitste straat is dat meestal dezelfde als hiervoor."
          >
            <PopupVeld icoon={<Type className="size-4" />}>
              <Input
                id="splits-volledig"
                className={popupInvoer}
                placeholder={street?.name ? `bijv. ${street.name}straat` : "Amelandstraat"}
                value={volledig}
                onChange={(e) => setVolledig(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>

          <PopupBlok label="Gaat mee" terzijde={`${adressen.length} van ${straatAantal}`}>
            <div className="flex flex-wrap gap-1 rounded-xl border border-input px-3 py-2.5">
              {adressen.map((c) => (
                <span
                  key={c.id}
                  className="rounded-full bg-surface px-2 py-[1px] text-[12px] tabular-nums text-muted-foreground"
                >
                  {formatNumber(c)}
                </span>
              ))}
            </div>
            {blijftAchter === 0 ? (
              <PopupHint>
                {`Alle adressen uit deze lijst gaan mee; in “${street?.name ?? ""}” kunnen alleen nog gestopte of verhuisde adressen staan. Wil je de straat enkel een andere naam geven, sluit dit dan en hernoem hem met het potloodje.`}
              </PopupHint>
            ) : (
              <PopupHint>
                {`${blijftAchter} ${blijftAchter === 1 ? "adres blijft" : "adressen blijven"} in “${street?.name ?? ""}” staan.`}
              </PopupHint>
            )}
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={save}>
            Splitsen
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
