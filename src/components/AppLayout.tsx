import type { ReactNode } from "react";

import { Zijbalk } from "@/components/Zijbalk";

type Props = {
  titel: string;
  /** Klein kruimelpad boven de titel, bijvoorbeeld "Overzicht / Klanten". */
  kruimel?: string;
  onderschrift?: ReactNode;
  /** Knoppen rechtsboven: de besturing van deze pagina. */
  acties?: ReactNode;
  /** Optionele rij onder de titelbalk, bijvoorbeeld cijferkaarten. */
  kop?: ReactNode;
  children: ReactNode;
};

export function AppLayout({ titel, kruimel, onderschrift, acties, kop, children }: Props) {
  return (
    <div className="flex min-h-screen bg-background">
      <Zijbalk />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur print:hidden">
          <div className="flex flex-wrap items-center gap-3 px-6 py-3.5">
            <div className="mr-auto min-w-0">
              {kruimel && (
                <p className="text-[11.5px] leading-tight text-muted-foreground">{kruimel}</p>
              )}
              <h1 className="truncate font-display text-[25px] font-semibold leading-tight tracking-[-0.02em]">
                {titel}
              </h1>
              {onderschrift && <p className="text-xs text-muted-foreground">{onderschrift}</p>}
            </div>
            {acties && <div className="flex flex-wrap items-center gap-2">{acties}</div>}
          </div>
        </header>
        {kop && <div className="px-6 pt-4">{kop}</div>}
        <main className="min-w-0 flex-1 px-6 py-4">{children}</main>
      </div>
    </div>
  );
}
