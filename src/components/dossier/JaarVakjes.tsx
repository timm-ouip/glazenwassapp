/**
 * Het jaar van één adres in twaalf vakjes: groen is gewassen, de oranje rand
 * is de volgende beurt, geel wordt overgeslagen. Een maand buiten de
 * frequentie is grijs. Tik op een maand om hem over te slaan (of weer niet);
 * een maand die gewassen is of al voorbij, tik je niet meer aan.
 */
import { jaarVakken, volgendeBeurtMaand } from "@/lib/dossier";
import { toonMaand } from "@/lib/klanten";
import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

export function JaarVakjes({ d }: { d: Dossier }) {
  const p = d.pand;
  // De volgende beurt volgt de ronde, niet de datum; staat er nog niets op
  // de planning, dan de eerstvolgende maand van de frequentie.
  const volgende = d.zonderAdres ? null : volgendeBeurtMaand(p, d.volgendeBeurt, d.dezeMaand);
  const vakken = jaarVakken(d.jaar, p, d.zonderAdres ? [] : d.gewassen, volgende, d.dezeMaand);
  const mag = d.magPlanOfBewerken && !d.toevoegenBezig;

  // Wat je bedoelt (aan of uit) volgt uit wat je ziet; de lijst zelf wordt
  // pas in de rij uitgerekend, uit de verse stand.
  function wissel(maand: string) {
    void d.zetOverslaan(p.overslaan.includes(maand) ? { uit: [maand] } : { aan: [maand] });
  }

  return (
    <>
      <div className="text-[12px] text-muted-foreground">
        Het jaar · tik op een maand om over te slaan
      </div>
      <div className="grid grid-cols-12 gap-1 text-center text-[11px]">
        {vakken.map((v) => {
          const kan = mag && v.tikbaar;
          return (
            <button
              key={v.maand}
              type="button"
              disabled={!kan}
              onClick={() => wissel(v.maand)}
              aria-pressed={v.status === "overslaan"}
              title={`${toonMaand(v.maand)} ${d.jaar}${
                {
                  gewassen: " · gewassen",
                  volgende: " · volgende beurt",
                  overslaan: " · overslaan",
                  beurt: "",
                  geen: " · niet volgens de frequentie",
                }[v.status]
              }`}
              className={cn(
                "rounded-[8px] py-1.5 transition-colors disabled:cursor-default",
                v.status === "gewassen" && "bg-tint-groen",
                v.status === "overslaan" && "bg-tint-geel",
                v.status === "volgende" && "border-2 border-primary",
                v.status === "beurt" && "bg-muted text-foreground",
                v.status === "geen" && "bg-muted text-muted-foreground/70",
                kan && "hover:brightness-95",
              )}
            >
              {v.letter}
            </button>
          );
        })}
      </div>
      <div className="text-[12px] text-muted-foreground">
        Groen = gewassen · oranje rand = volgende · geel = overslaan
      </div>
    </>
  );
}
