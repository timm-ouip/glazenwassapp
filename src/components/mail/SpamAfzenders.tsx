/** De afzenders die altijd naar spam gaan, met een knop om dat terug te draaien. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { PopupBody, PopupHint, PopupKader, PopupKop } from "@/components/Popup";
import { fetchSpamRegels } from "@/lib/berichten";
import { spamregelWeg } from "@/lib/mailacties";

export function SpamAfzenders({ kanSchrijven }: { kanSchrijven: boolean }) {
  const qc = useQueryClient();
  const regels = useQuery({ queryKey: ["spam-regels"], queryFn: fetchSpamRegels });
  const [open, setOpen] = useState(false);
  const lijst = regels.data ?? [];
  if (lijst.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-1 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
      >
        <ShieldAlert className="size-3.5" /> {lijst.length} {lijst.length === 1 ? "afzender" : "afzenders"} altijd naar spam
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <PopupKader className="sm:max-w-md" aria-describedby="spam-afzenders-uitleg">
          <DialogDescription id="spam-afzenders-uitleg" className="sr-only">
            Mail van deze adressen gaat vanzelf naar de spammap
          </DialogDescription>
          <PopupKop
            icoon={<ShieldAlert className="size-5" />}
            titel="Altijd naar spam"
            subtitel="Nieuwe mail van deze adressen gaat vanzelf naar de spammap"
          />
          <PopupBody className="gap-1.5">
            {lijst.map((email) => (
              <div key={email} className="flex items-center gap-2 rounded-xl border border-input px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{email}</span>
                <button
                  type="button"
                  disabled={!kanSchrijven}
                  onClick={() =>
                    void spamregelWeg(email)
                      .then(() => {
                        toast.success(`${email} gaat niet meer vanzelf naar spam.`);
                        void qc.invalidateQueries({ queryKey: ["spam-regels"] });
                      })
                      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                  }
                  className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X className="size-3.5" /> Weghalen
                </button>
              </div>
            ))}
            <PopupHint>Mail die al in de spammap staat blijft daar; zet die zelf terug met "Geen spam".</PopupHint>
          </PopupBody>
        </PopupKader>
      </Dialog>
    </>
  );
}
