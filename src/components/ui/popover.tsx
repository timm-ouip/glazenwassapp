import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * Modaal, tenzij je anders vraagt: zolang hij open is kan de pagina eronder
 * niet aangetikt worden. Anders sloot één tik ernaast hem én tikte die tik
 * ook nog aan wat eronder lag — op de telefoon een volgend adres. Nu sluit
 * die tik hem alleen; de volgende tik werkt weer gewoon.
 */
function Popover({ modal = true, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root modal={modal} {...props} />;
}

// Die tik naast de popover landt op <html>, en de popover sluit pas op de
// klik van die tik. Safari op de iPhone stuurt die klik alleen naar iets dat
// "klikbaar" is; een lege klikfunctie maakt <html> dat, zoals React het met
// zijn eigen containers doet. Doet verder niets.
if (typeof document !== "undefined") document.documentElement.onclick ??= () => {};

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    { className, align = "center", sideOffset = 4, onInteractOutside, onCloseAutoFocus, ...props },
    ref,
  ) => {
    // Sloot je hem door ernaast te tikken, dan niet terug naar de knop: een
    // modale popover doet dat wel, en dan bleef die knop (de notitie van het
    // vorige adres) na het sluiten nog oplichten.
    const buiten = React.useRef(false);
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          onInteractOutside={(e) => {
            onInteractOutside?.(e);
            if (!e.defaultPrevented) buiten.current = true;
          }}
          onCloseAutoFocus={(e) => {
            onCloseAutoFocus?.(e);
            if (buiten.current) e.preventDefault();
            buiten.current = false;
          }}
          // De pagina staat stil zolang hij open is (modaal), dus lange inhoud
          // (een notitie met maandregels) scrolt binnen de popover zelf.
          className={cn(
            "z-50 max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
