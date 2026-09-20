import {
  IconCalendarOff as CalendarOff,
  IconCheck as Check,
  IconCircleOff as CircleSlash,
  IconCornerDownRight as CornerDownRight,
  IconFileText as FileText,
  IconFlag as Flag,
  IconHammer as Hammer,
  IconScissors as Scissors,
  IconUserMinus as UserMinus,
} from "@tabler/icons-react";
import { Slot } from "@radix-ui/react-slot";
import { createPortal } from "react-dom";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  eersteMaand,
  komendeMaanden,
  maandSleutel,
  tintStip,
  schuifStartOp,
  toonMaand,
  vorigeMaand,
  type Customer,
  type Markering,
  type MarkeringRij,
} from "@/lib/klanten";

interface Props {
  customer: Customer;
  onPatch: (patch: Partial<Customer>) => void;
  /** Opent het dossier van dit adres. De pagina houdt het schermpje zelf
   *  vast, zodat het opent waar je bent — een sprong naar de klantenpagina
   *  raakte het dossier kwijt zodra het adres nog geen klant had. */
  onDossier: () => void;
  /** Opent het hoekadres-schermpje; ook dat houdt de pagina vast. */
  onHoekadres: () => void;
  /** Extra opdracht bij dit adres: werk zonder maand, dat meerijdt als je
   *  toch in die wijk bent. */
  onKlus?: (() => void) | undefined;
  /** Klant laat stoppen: gestopt of verhuisd. Laat weg waar dat niet kan. */
  onStoppen?: (() => void) | undefined;
  /** De aangevinkte adressen van deze straat eruit lichten, in een nieuwe
   *  straat ernaast. Alleen in de selecteermodus, op een aangevinkt adres;
   *  laat het verder weg. */
  onSplitsen?: (() => void) | undefined;
  /** De kleuren die dit bedrijf zelf gemaakt heeft, uit Instellingen. */
  markeringen: MarkeringRij[];
  /** Wie het adres niet mag bijwerken, ziet alleen het dossier (en wat er
   *  verder expliciet meegegeven is). */
  alleenLezen?: boolean;
  children: ReactNode;
}

/** Streepje bij de jaarwisseling: anders lopen december en januari in elkaar over. */
function jaarwissel(maand: string, i: number): boolean {
  return i > 0 && maand.endsWith("-01");
}

/** Zo lang houdt Radix een vinger vast voordat het menu opengaat. */
const LANG_INDRUKKEN = 700;

/**
 * Het menu pas bouwen als je het nodig hebt. Een wijk heeft honderden regels,
 * en een klaarstaand Radix-menu per regel was het duurste deel van de lijst:
 * wisselen van maand of wijk kostte daardoor bijna een halve seconde extra.
 *
 * De regel zelf blijft altijd hetzelfde element; het menu hangt er los naast
 * en wordt bij de eerste rechtermuisklik (of lang indrukken) gebouwd. Zou de
 * regel bij het bouwen vervangen worden, dan raakte je kwijt wat je net in
 * een vakje van die regel typte.
 */
export function KlantMenu(props: Props) {
  /** Waar het menu open moet; `keer` telt op, zodat dezelfde plek opnieuw kan. */
  const [punt, setPunt] = useState<Punt | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openOp = (x: number, y: number) => setPunt((p) => ({ x, y, keer: (p?.keer ?? 0) + 1 }));
  const stopTimer = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse" && timer.current) clearTimeout(timer.current);
  };

  return (
    <>
      <Slot
        // Zolang het menu open is een rand om de regel (data-[state=open]),
        // zodat je ziet over welk adres het gaat — zoals Radix dat deed.
        data-state={open ? "open" : "closed"}
        // Een regel lang vasthouden opent geen menu van de telefoon zelf.
        style={{ WebkitTouchCallout: "none" }}
        onContextMenu={(e: ReactMouseEvent) => {
          // Hield het lang indrukken van de regel hem al tegen, dan niet.
          if (e.defaultPrevented) return;
          e.preventDefault();
          // Android opent zelf al bij lang indrukken; dan niet nog een keer.
          if (timer.current) clearTimeout(timer.current);
          openOp(e.clientX, e.clientY);
        }}
        onPointerDown={(e: ReactPointerEvent) => {
          if (e.defaultPrevented || e.pointerType === "mouse") return;
          if (timer.current) clearTimeout(timer.current);
          const { clientX: x, clientY: y } = e;
          timer.current = setTimeout(() => openOp(x, y), LANG_INDRUKKEN);
        }}
        onPointerMove={stopTimer}
        onPointerUp={stopTimer}
        onPointerCancel={stopTimer}
      >
        {props.children}
      </Slot>
      {punt && <KlantMenuVol {...props} punt={punt} onOpenChange={setOpen} />}
    </>
  );
}

type Punt = { x: number; y: number; keer: number };

/**
 * Rechtermuisknop op een adresregel: naar het dossier, een kleur meegeven
 * voor de printlijst, en maanden overslaan.
 *
 * Dit zit bewust achter de rechtermuisknop en niet in de regel zelf: de
 * wijklijst is al dicht bezet, en dit zijn dingen die je een paar keer per
 * jaar doet, niet elke ronde.
 */
function KlantMenuVol({
  customer: c,
  onPatch: ruwePatch,
  onDossier,
  onHoekadres,
  onKlus,
  onStoppen,
  onSplitsen,
  markeringen,
  alleenLezen = false,
  punt,
  onOpenChange,
}: Omit<Props, "children"> & { punt: Punt; onOpenChange: (open: boolean) => void }) {
  // Het menu opent vanaf een onzichtbaar ankertje, via hetzelfde event dat
  // Radix zelf opvangt: zo komt het precies op de plek van de klik.
  const anker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    anker.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: punt.x,
        clientY: punt.y,
      }),
    );
  }, [punt]);

  // Alles loopt hierlangs, zodat een startmaand die je overslaat overal
  // opschuift en niet alleen in het menu-item dat je toevallig gebruikte.
  const onPatch = (p: Partial<Customer>) => ruwePatch(schuifStartOp(c, p));
  const maanden = komendeMaanden();
  const komende = maanden[0]!;
  const start = eersteMaand(c);
  const nieuwDezeMaand = start === maandSleutel(new Date());

  function zetKleur(kleur: Markering) {
    onPatch({ markering: c.markering === kleur ? "" : kleur });
  }

  // De maanden die je in "Overslaan in…" aanvinkt, bewaren we pas als het
  // menu dichtgaat. Sla je de maand over die in beeld staat, dan verdwijnt
  // het adres uit de lijst — en het menu met hem, nog voor je een tweede
  // maand kon aanvinken. Een ref ernaast, want het sluiten komt in dezelfde
  // klik als een ander menu-item en ziet de state dan nog niet.
  const [wachtend, setWachtend] = useState<string[] | null>(null);
  const wachtendRef = useRef<string[] | null>(null);
  const overslaan = wachtend ?? c.overslaan;

  function zetWachtend(lijst: string[] | null) {
    wachtendRef.current = lijst;
    setWachtend(lijst);
  }

  function vinkMaand(maand: string) {
    const aan = overslaan.includes(maand);
    zetWachtend(aan ? overslaan.filter((m) => m !== maand) : [...overslaan, maand].sort());
  }

  function wisselMaand(maand: string) {
    const aan = overslaan.includes(maand);
    zetWachtend(null);
    onPatch({
      overslaan: aan ? overslaan.filter((m) => m !== maand) : [...overslaan, maand].sort(),
    });
  }

  /** Alles t/m deze maand overslaan — voor een langere pauze in één klik. */
  function slaOverTot(maand: string) {
    const tot = maanden.filter((m) => m <= maand);
    zetWachtend(null);
    onPatch({ overslaan: [...new Set([...overslaan, ...tot])].sort() });
  }

  function menuOpenDicht(open: boolean) {
    if (open || !wachtendRef.current) return;
    const lijst = wachtendRef.current;
    zetWachtend(null);
    // Niets veranderd (twee keer dezelfde maand geklikt)? Dan ook niets opslaan.
    if (lijst.join() !== c.overslaan.join()) onPatch({ overslaan: lijst });
  }

  return (
    <ContextMenu
      onOpenChange={(o) => {
        menuOpenDicht(o);
        onOpenChange(o);
      }}
    >
      {/* In de body, want naast de regel kan geen span staan (een tabelrij). */}
      {createPortal(
        <ContextMenuTrigger asChild>
          <span
            ref={anker}
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 size-0"
            // Niet doorgeven aan wat er in React boven de regel hangt.
            onContextMenu={(e) => e.stopPropagation()}
          />
        </ContextMenuTrigger>,
        document.body,
      )}
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={onDossier}>
          <FileText className="size-4" /> Dossier
        </ContextMenuItem>
        {/* Alleen in de selecteermodus op een aangevinkt adres: dan gaat dit
            menu niet meer over dit ene adres, maar over wat je in deze straat
            aangevinkt hebt. De tegenhanger van straten samenvoegen. */}
        {onSplitsen && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onSplitsen}>
              <Scissors className="size-4" /> Straat splitsen…
            </ContextMenuItem>
          </>
        )}
        {!alleenLezen && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => wisselMaand(komende)}>
              <CalendarOff className="size-4" />
              {overslaan.includes(komende) ? `${toonMaand(komende)} toch doen` : "Overslaan"}
            </ContextMenuItem>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <CalendarOff className="size-4" /> Overslaan in…
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {maanden.map((m, i) => (
                  <Fragment key={m}>
                    {jaarwissel(m, i) && <ContextMenuSeparator />}
                    <ContextMenuCheckboxItem
                      checked={overslaan.includes(m)}
                      onSelect={(e) => {
                        // Openhouden: meestal vink je er meer dan één aan.
                        e.preventDefault();
                        vinkMaand(m);
                      }}
                    >
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </ContextMenuCheckboxItem>
                  </Fragment>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <CalendarOff className="size-4" /> Overslaan t/m…
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {maanden.map((m, i) => (
                  <Fragment key={m}>
                    {jaarwissel(m, i) && <ContextMenuSeparator />}
                    <ContextMenuItem onSelect={() => slaOverTot(m)}>
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </ContextMenuItem>
                  </Fragment>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {overslaan.length > 0 && (
              <ContextMenuItem
                onSelect={() => {
                  zetWachtend(null);
                  onPatch({ overslaan: [] });
                }}
              >
                <CircleSlash className="size-4" /> Niets meer overslaan ({overslaan.length})
              </ContextMenuItem>
            )}

            {/* Vanaf wanneer hij meedoet hoort bij overslaan: allebei gaan ze over
            de maanden waarin je hier langskomt. Zonder maand in de naam — die
            is meestal al voorbij, en zolang hij nog moet beginnen staat hij in
            de regel zelf als "vanaf okt". */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Flag className="size-4" /> Nieuw vanaf:
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {maanden.map((m, i) => (
                  <Fragment key={m}>
                    {jaarwissel(m, i) && <ContextMenuSeparator />}
                    <ContextMenuItem onSelect={() => onPatch({ start_maand: m })}>
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </ContextMenuItem>
                  </Fragment>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onPatch({ start_maand: vorigeMaand() })}>
                  <CircleSlash className="size-4" /> Niet nieuw, al langer klant
                </ContextMenuItem>
                {c.start_maand && (
                  <ContextMenuItem onSelect={() => onPatch({ start_maand: "" })}>
                    <CircleSlash className="size-4" /> Meteen (aanmaakmaand)
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}

        {(onKlus || onStoppen) && <ContextMenuSeparator />}
        {onKlus && (
          <ContextMenuItem onSelect={onKlus}>
            <Hammer className="size-4" /> Extra opdracht…
          </ContextMenuItem>
        )}
        {onStoppen && (
          <ContextMenuItem onSelect={onStoppen}>
            <UserMinus className="size-4" /> Klant stopt…
          </ContextMenuItem>
        )}

        {!alleenLezen && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>Kleur op printlijst</ContextMenuLabel>
            {markeringen.length === 0 && (
              <ContextMenuLabel className="font-normal text-muted-foreground">
                Nog geen kleuren — maak ze bij Instellingen
              </ContextMenuLabel>
            )}
            {markeringen.map((m) => (
              <ContextMenuItem key={m.id} onSelect={() => zetKleur(m.sleutel)}>
                <span className={`size-3 rounded-full ring-1 ring-inset ${tintStip[m.tint]}`} />
                {m.naam}
                {c.markering === m.sleutel && <Check className="ml-auto size-4" />}
              </ContextMenuItem>
            ))}
            {c.markering ? (
              <ContextMenuItem onSelect={() => onPatch({ markering: "" })}>
                <CircleSlash className="size-4" /> Kleur weghalen
              </ContextMenuItem>
            ) : (
              nieuwDezeMaand && (
                // Anders zoek je je scheel naar de kleur die je nooit gezet hebt.
                <ContextMenuLabel className="font-normal text-muted-foreground">
                  Al groen: nieuw vanaf {toonMaand(start)}
                </ContextMenuLabel>
              )
            )}

            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onHoekadres}>
              <CornerDownRight className="size-4" /> Hoekadres…
              {c.hoek_straat && (
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {c.hoek_straat}
                </span>
              )}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
