import { useState } from "react";
import { nl } from "date-fns/locale";
import { IconCalendarUp as CalendarArrowUp } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PopupKader, PopupKop } from "@/components/Popup";
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
          data-sneltoets="verplaats"
          title={aantal === 0 ? "Vink eerst iets aan" : `${aantal} verplaatsen`}
        >
          <CalendarArrowUp className="size-4" /> Verplaatsen naar
          {aantal > 0 && <span className="tabular-nums opacity-80">({aantal})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <DagKalender
          huidigeDag={huidigeDag}
          onKies={(d) => {
            setOpen(false);
            onKies(d);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Hetzelfde voor één adres, vanuit het menu op een regel van de dag: een
 * menu-item kan geen kalender openklappen, dus komt die in een venstertje.
 */
export function VerplaatsNaarDialoog({
  open,
  onOpenChange,
  adres,
  huidigeDag,
  onKies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Kerkstraat 12", onder de titel. */
  adres: string;
  huidigeDag: string;
  onKies: (datum: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          icoon={<CalendarArrowUp className="size-[22px]" />}
          titel="Verplaatsen naar"
          subtitel={adres}
        />
        <div className="flex justify-center overflow-y-auto px-2 pb-4 pt-2">
          <DagKalender
            huidigeDag={huidigeDag}
            onKies={(d) => {
              onOpenChange(false);
              onKies(d);
            }}
          />
        </div>
      </PopupKader>
    </Dialog>
  );
}

function DagKalender({
  huidigeDag,
  onKies,
}: {
  huidigeDag: string;
  onKies: (datum: string) => void;
}) {
  return (
    <Calendar
      mode="single"
      locale={nl}
      weekStartsOn={1}
      defaultMonth={new Date(`${huidigeDag}T12:00:00`)}
      // De dag zelf uitzetten: daar staat het al op, dus dat verplaatst niets.
      disabled={(d) => datumSleutel(d) === huidigeDag}
      onSelect={(d) => {
        if (d) onKies(datumSleutel(d));
      }}
    />
  );
}
