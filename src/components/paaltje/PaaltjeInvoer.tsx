/**
 * Het typvak onderin het Paaltje-paneel: groeit mee met wat je typt. Enter
 * verstuurt, Shift+Enter begint een nieuwe regel. `rechts` is nu nog leeg —
 * daar komt later een microfoonknop bij.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconArrowUp as ArrowUp, IconLoader2 as Loader2 } from "@tabler/icons-react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  /** Geeft `false` terug bij een mislukte poging, zodat de tekst teruggezet
   *  kan worden in plaats van kwijt te raken. */
  onVerstuur: (tekst: string) => Promise<boolean> | void;
  bezig: boolean;
  /** Plek rechts van het typvak, voor een latere microfoonknop. */
  rechts?: ReactNode;
}

export const PaaltjeInvoer = forwardRef<HTMLTextAreaElement, Props>(function PaaltjeInvoer(
  { onVerstuur, bezig, rechts },
  ref,
) {
  const [tekst, setTekst] = useState("");
  const eigenRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => eigenRef.current as HTMLTextAreaElement);

  // Meegroeien met de inhoud, tot een maximum — daarna scrollt het typvak zelf.
  useEffect(() => {
    const el = eigenRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [tekst]);

  // Pas leegmaken als het versturen ook echt gelukt is — anders ben je je
  // net getypte bericht kwijt bij een foutmelding of de daglimiet. Tot dat
  // moment staat de tekst er nog (grijs, want het vak is dan `bezig`), en bij
  // een fout staat hij daardoor vanzelf weer gewoon in het vak.
  async function versturen() {
    const schoon = tekst.trim();
    if (!schoon || bezig) return;
    const gelukt = await onVerstuur(schoon);
    if (gelukt === false) return;
    setTekst("");
    requestAnimationFrame(() => eigenRef.current?.focus());
  }

  return (
    <div className="flex items-end gap-1.5">
      <Textarea
        ref={eigenRef}
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void versturen();
          }
        }}
        placeholder="Vraag iets, of geef een wijziging door…"
        rows={1}
        disabled={bezig}
        aria-label="Bericht aan Paaltje"
        className="max-h-40 min-h-[38px] flex-1 resize-none rounded-[14px] border-input bg-background/70 py-2 text-[13px] focus-visible:ring-ring/25"
      />
      {rechts}
      <button
        type="button"
        aria-label="Versturen"
        onClick={() => void versturen()}
        disabled={bezig || !tekst.trim()}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40",
        )}
      >
        {bezig ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </button>
    </div>
  );
});
