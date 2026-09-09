import { useState } from "react";
import { nl } from "date-fns/locale";
import { CalendarArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { datumSleutel } from "@/lib/wasdag";

/**
 * "Verplaatsen naar…" — zet wat je aangevinkt hebt op een andere dag.
 *
 * Bewust een kalender en geen lijstje met de komende dagen, zoals bij
 * "Inplannen voor" op de wijkenpagina: werk dat blijft liggen schuift lang niet
 * altijd naar morgen. Soms gaat een straat een maand vooruit omdat de steiger
 * er staat, en dan wil je die maand kunnen aanwijzen.
 */
export function VerplaatsNaarKnop({
  aantal,
  huidigeDag,
  onKies,
}: {
  aantal: number;
  /** De dag waar je nu op staat; die kun je niet kiezen. */
  huidigeDag: string;
  onKies: (datum: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          className="rounded-full"
          disabled={aantal === 0}
          title={aantal === 0 ? "Vink eerst iets aan" : `${aantal} verplaatsen`}
        >
          <CalendarArrowUp className="size-4" /> Verplaatsen naar
          {aantal > 0 && <span className="tabular-nums opacity-80">({aantal})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={nl}
          weekStartsOn={1}
          defaultMonth={new Date(`${huidigeDag}T12:00:00`)}
          // De dag zelf uitzetten: daar staat het al op, dus dat verplaatst niets.
          disabled={(d) => datumSleutel(d) === huidigeDag}
          onSelect={(d) => {
            if (!d) return;
            setOpen(false);
            onKies(datumSleutel(d));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
