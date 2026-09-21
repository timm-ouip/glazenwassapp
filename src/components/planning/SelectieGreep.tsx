import { useDraggable } from "@dnd-kit/core";
import { IconGripVertical as Grip } from "@tabler/icons-react";

import { telAdressen } from "@/lib/overslaan-keuze";

/**
 * Het handvatje op wat gekozen is, in de selecteerstand. Daar is een streek
 * met de muis een selectie en geen sleep; aan dit handvatje pak je de hele
 * selectie op, om hem naar een andere dag of een ander team te slepen.
 *
 * `sleutel` moet uniek zijn op de pagina: elk gekozen blok of adres heeft
 * zijn eigen handvatje, en ze slepen allemaal dezelfde selectie.
 */
export function SelectieGreep({
  sleutel,
  datum,
  gekozen,
}: {
  sleutel: string;
  /** De dag waar dit blok op staat: vandaar vertrekt de selectie. */
  datum: string;
  gekozen: Set<string>;
}) {
  const ids = [...gekozen];
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `blok:greep:${sleutel}`,
    data: { soort: "blok", adressen: ids, titel: telAdressen(ids.length), datum },
  });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      aria-label={`Sleep de selectie (${telAdressen(ids.length)})`}
      title={`Sleep de selectie (${telAdressen(ids.length)})`}
      // Eerst de sleep van dnd-kit, en dan niet verder: anders begint de
      // selecteerstand hier een streek en wist of kiest hij adressen.
      onPointerDown={(e) => {
        listeners?.["onPointerDown"]?.(e);
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        listeners?.["onTouchStart"]?.(e);
        e.stopPropagation();
      }}
      className="inline-flex shrink-0 cursor-grab touch-none items-center rounded p-0.5 hover:bg-background/50 active:cursor-grabbing"
    >
      <Grip className="size-3" />
    </span>
  );
}
