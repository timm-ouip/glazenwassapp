/**
 * Een moment kiezen, zoals in een mailprogramma: een paar vaste keuzes
 * (vanmiddag, morgenochtend, maandag, over een week) of zelf een dag en tijd.
 * Gebruikt voor herinneringen en voor later versturen.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function op(dag: Date, uur: number): Date {
  const d = new Date(dag);
  d.setHours(uur, 0, 0, 0);
  return d;
}

/** De vaste keuzes vanaf nu; wat al voorbij is valt weg. */
export function vasteMomenten(nu = new Date()): { label: string; moment: Date }[] {
  const morgen = new Date(nu);
  morgen.setDate(nu.getDate() + 1);
  const maandag = new Date(nu);
  maandag.setDate(nu.getDate() + ((8 - nu.getDay()) % 7 || 7));
  const week = new Date(nu);
  week.setDate(nu.getDate() + 7);
  return [
    { label: "Vanmiddag 13:00", moment: op(nu, 13) },
    { label: "Vanavond 19:00", moment: op(nu, 19) },
    { label: "Morgenochtend 08:00", moment: op(morgen, 8) },
    { label: "Maandag 08:00", moment: op(maandag, 8) },
    { label: "Over een week 08:00", moment: op(week, 8) },
  ].filter((m) => m.moment.getTime() > nu.getTime() + 5 * 60_000);
}

export function toonMoment(iso: string | Date): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "jjjj-mm-ddTuu:mm" in je eigen tijdzone, voor een datetime-local-veld. */
function lokaal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MomentKiezer({
  titel,
  trigger,
  onKies,
  extra,
  align = "end",
}: {
  titel: string;
  trigger: ReactNode;
  onKies: (moment: Date) => void;
  /** Onderaan, bijvoorbeeld "Herinnering weghalen". */
  extra?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [zelf, setZelf] = useState(false);
  const [waarde, setWaarde] = useState(() => lokaal(op(new Date(Date.now() + 24 * 3600_000), 8)));

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setZelf(false);
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        <DropdownMenuLabel>{titel}</DropdownMenuLabel>
        {vasteMomenten().map((m) => (
          <DropdownMenuItem key={m.label} onSelect={() => onKies(m.moment)}>
            {m.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {zelf ? (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new Date(waarde);
              if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000) return;
              onKies(d);
              setOpen(false);
            }}
          >
            <Input
              type="datetime-local"
              value={waarde}
              min={lokaal(new Date())}
              onChange={(e) => setWaarde(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-8 text-[12.5px]"
              aria-label="Dag en tijd"
            />
            <Button type="submit" size="sm" className="rounded-full">
              Kiezen
            </Button>
          </form>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setZelf(true);
            }}
          >
            Zelf dag en tijd kiezen…
          </DropdownMenuItem>
        )}
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
