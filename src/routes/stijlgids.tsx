/**
 * De stijlgids: alle bouwstenen van de app onder elkaar, in het thema dat je
 * bovenaan kiest. Hij staat er om een thema na te kijken zonder door de hele
 * app te hoeven klikken — knoppen, velden, kaarten, tegels, lijstregels en
 * menu-items in één keer naast elkaar.
 *
 * Openbaar, zonder inlog: hier staat geen klantgegeven op, alleen voorbeelden.
 * De pagina staat bewust niet in het menu; je komt er via /stijlgids.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconCash as Cash,
  IconCalendar as CalendarDays,
  IconCheck as Check,
  IconHome as Home,
  IconMapPin as MapPin,
  IconUsers as Users,
} from "@tabler/icons-react";

import { Cijferkaarten } from "@/components/Cijferkaarten";
import { Vorm, type VormNaam } from "@/components/Vorm";
import {
  TEGEL_GEWOON,
  TEGEL_KLEUR,
  TEGEL_KLIKBAAR,
  TEGEL_VAK,
  TegelGetal,
  TegelKop,
  TegelOnder,
} from "@/components/Tegel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  bewaarThema,
  familieKeuzes,
  familieLabels,
  keuzeLabels,
  leesThema,
  type Thema,
  type ThemaFamilie,
} from "@/lib/thema";

/** Alle vormen op een rij, elk op een ander vak: naam, vakkleur en waar hij hangt. */
const VORMEN_RIJ: [VormNaam, keyof typeof TEGEL_KLEUR, string][] = [
  ["vlek", "oranje", "-bottom-6 -right-5 size-[80px]"],
  ["blad", "aqua", "-left-4 -top-5 size-[80px]"],
  ["palmblad", "paars", "-bottom-4 -right-5 size-[72px]"],
  ["golven", "geel", "inset-x-0 bottom-0 h-[42px]"],
  ["slinger", "groen", "-right-3 -top-4 h-[80px] w-[58px]"],
  ["bloem", "petrol", "-right-5 -top-5 size-[70px]"],
  ["schelpen", "perzik", "-bottom-3 -right-3 h-[52px] w-[68px]"],
  ["wig", "donker", "inset-x-0 bottom-0 h-[46px]"],
];

export const Route = createFileRoute("/stijlgids")({
  head: () => ({
    meta: [
      { title: "Stijlgids — Paaltje Systems" },
      // Een hulppagina, geen pagina voor klanten: hij hoeft niet in Google.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Stijlgids,
});

function Stijlgids() {
  const [thema, setThema] = useState<Thema>("systeem");
  useEffect(() => setThema(leesThema()), []);

  function kies(t: Thema) {
    setThema(t);
    bewaarThema(t);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <h1 className="font-display text-[19px] font-bold tracking-[-0.02em]">Stijlgids</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Alle bouwstenen in het thema dat je hieronder kiest.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(Object.keys(familieLabels) as ThemaFamilie[]).flatMap((f) =>
            familieKeuzes[f].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => kies(t)}
                aria-pressed={thema === t}
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  thema === t
                    ? "border-primary bg-primary font-medium text-primary-foreground"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                {familieLabels[f]} · {keuzeLabels[t]}
              </button>
            )),
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-4 py-6">
        <Blok titel="Cijferkaarten" uitleg="De rij getallen boven aan een pagina.">
          <Cijferkaarten
            cijfers={[
              {
                label: "Adressen",
                waarde: "86",
                onder: "in 2 wijken",
                icon: MapPin,
                kleur: "blauw",
              },
              {
                label: "Straten",
                waarde: "7",
                onder: "Gouda en Bloemenbuurt",
                icon: CalendarDays,
                kleur: "amber",
              },
              {
                label: "Opbrengst",
                waarde: "€ 1.284,50",
                onder: "laatst € 1.216,00",
                icon: Cash,
                kleur: "groen",
              },
            ]}
          />
        </Blok>

        <Blok
          titel="Vakken"
          uitleg="De tegels van Home en het dashboard, met de uitgeknipte vorm die in Fel achter de cijfers ligt."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className={`${TEGEL_VAK} ${TEGEL_KLIKBAAR} ${TEGEL_GEWOON} ${TEGEL_KLEUR.aqua}`}>
              <Vorm
                naam="slinger"
                plek="-right-5 -top-6 h-[130px] w-[95px] md:-right-6 md:-top-8 md:h-[210px] md:w-[155px]"
              />
              <TegelKop label="Klanten" />
              <TegelGetal>1.248</TegelGetal>
              <TegelOnder>37 zonder wijk</TegelOnder>
            </div>
            <div className={`${TEGEL_VAK} ${TEGEL_KLIKBAAR} ${TEGEL_GEWOON} ${TEGEL_KLEUR.groen}`}>
              <Vorm naam="blad" plek="-left-7 -top-8 size-[140px] md:size-[190px]" />
              <TegelKop label="Betalingen" />
              <TegelGetal>€ 642</TegelGetal>
              <TegelOnder>vanavond opgehaald</TegelOnder>
            </div>
            <div className={`${TEGEL_VAK} ${TEGEL_KLIKBAAR} ${TEGEL_GEWOON} ${TEGEL_KLEUR.geel}`}>
              <Vorm naam="golven" plek="inset-x-0 bottom-0 h-[60px] md:h-[110px]" />
              <TegelKop label="Aanmeldingen" />
              <TegelGetal>4</TegelGetal>
              <TegelOnder>nog te beoordelen</TegelOnder>
            </div>
            <div className={`${TEGEL_VAK} ${TEGEL_GEWOON} ${TEGEL_KLEUR.creme}`}>
              <TegelKop label="Vandaag" pijl={false} />
              <TegelGetal>56/86</TegelGetal>
              <TegelOnder>afgemeld</TegelOnder>
            </div>
          </div>

          <p className="mt-5 text-[13px] text-muted-foreground">
            Alle acht vormen bij elkaar. Ze zijn uit te zetten in Instellingen → Weergave; in
            Zakelijk staan ze er sowieso niet.
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2 md:grid-cols-8">
            {VORMEN_RIJ.map(([naam, kleur, plek]) => (
              <div key={naam}>
                <div
                  className={`${TEGEL_VAK} ${TEGEL_KLEUR[kleur]} relative h-[84px] overflow-hidden rounded-[18px]`}
                >
                  <Vorm naam={naam} plek={plek} />
                </div>
                <span className="mt-1 block text-[11.5px] text-muted-foreground">{naam}</span>
              </div>
            ))}
          </div>
        </Blok>

        <Blok titel="Knoppen" uitleg="Eén donkere knop per scherm; de rest is rustig.">
          <div className="flex flex-wrap items-center gap-2">
            <Button>
              <Check /> Dag klaar melden
            </Button>
            <Button variant="outline">Wijk vrijgeven</Button>
            <Button variant="secondary">Annuleren</Button>
            <Button variant="ghost">Overslaan</Button>
            <Button variant="destructive">Verwijderen</Button>
            <Button size="sm" variant="outline">
              Klein
            </Button>
          </div>
        </Blok>

        <Blok titel="Velden en schakelaars" uitleg="Waar je iets invult of aanzet.">
          <div className="flex flex-wrap items-center gap-3">
            <Input className="w-56" placeholder="Zoek op adres of naam…" aria-label="Zoeken" />
            <Input className="w-32" placeholder="€ 14,50" aria-label="Prijs" />
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox defaultChecked /> Afgemeld
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <Switch defaultChecked /> Mail sturen
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Tabs defaultValue="overzicht">
              <TabsList>
                <TabsTrigger value="overzicht">Overzicht</TabsTrigger>
                <TabsTrigger value="lopen">Lopen</TabsTrigger>
                <TabsTrigger value="pof">Pof</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </Blok>

        <Blok titel="Statuspillen" uitleg="Wat er met een adres of een dag aan de hand is.">
          <div className="flex flex-wrap items-center gap-2">
            <Pil kleur="groen">Afgemeld</Pil>
            <Pil kleur="amber">Pof</Pil>
            <Pil kleur="blauw">Nieuw</Pil>
            <Pil kleur="rood">Klacht</Pil>
            <Pil kleur="paars">Al ingepland</Pil>
            <Badge>Standaard</Badge>
            <Badge variant="secondary">Rustig</Badge>
          </div>
        </Blok>

        <Blok titel="Een wijk met adressen" uitleg="De kaart zoals hij op de dagpagina staat.">
          <section className="rounded-[18px] border border-border bg-card p-2.5 shadow-card">
            <div className="mb-1 flex items-center gap-2 rounded-[12px] px-2 py-1.5">
              <span className="size-2.5 shrink-0 rounded-full bg-tint-blauw-mid" />
              <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                Gouda
              </h2>
              <span className="rounded-full bg-surface px-2 py-[1px] text-[10.5px] tabular-nums text-muted-foreground">
                34 adressen
              </span>
              <span className="text-[13px] font-semibold tabular-nums">€ 512,00</span>
            </div>
            <div className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold tracking-[0.03em] text-muted-foreground">
              Kleiweg
            </div>
            {[
              ["Kleiweg 12", "Fam. Verhoeven · 8 weken", "€ 14,50", true],
              ["Kleiweg 14", "J. de Bruin · 8 weken", "€ 14,50", true],
              ["Kleiweg 16 a", "Bakkerij Stolk · 4 weken", "€ 27,00", false],
            ].map(([adres, onder, prijs, gedaan]) => (
              <label
                key={adres as string}
                className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-card-header"
              >
                <Checkbox defaultChecked={gedaan as boolean} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13.5px] font-medium ${gedaan ? "text-muted-foreground line-through" : ""}`}
                  >
                    {adres}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {onder}
                  </span>
                </span>
                {gedaan ? <Pil kleur="groen">Afgemeld</Pil> : null}
                <span className="shrink-0 text-[13px] font-semibold tabular-nums">{prijs}</span>
              </label>
            ))}
          </section>
        </Blok>

        <Blok
          titel="Menu-items"
          uitleg="Zoals ze in de zijbalk staan: de pagina waar je bent, licht op."
        >
          <div className="max-w-[240px] rounded-[16px] border border-border bg-sidebar p-3">
            {(
              [
                { icoon: Home, label: "Home", actief: false },
                { icoon: CalendarDays, label: "Planning", actief: true },
                { icoon: Users, label: "Klanten", actief: false },
                { icoon: Cash, label: "Betalingen", actief: false },
              ] as const
            ).map(({ icoon: I, label, actief }) => {
              return (
                <div
                  key={label}
                  className={`relative flex h-10 items-center gap-3 rounded-[12px] px-2.5 text-[13.5px] zak:rounded-[10px] ${
                    actief
                      ? "bg-card font-semibold shadow-card zak:bg-sidebar-accent zak:text-sidebar-accent-foreground zak:shadow-none"
                      : "text-foreground/75"
                  }`}
                >
                  <I
                    className={`size-[17px] shrink-0 ${actief ? "text-tint-oranje-ink zak:text-sidebar-accent-foreground" : "text-muted-foreground"}`}
                  />
                  <span className="truncate">{label}</span>
                </div>
              );
            })}
          </div>
        </Blok>

        <Blok titel="Staafjes" uitleg="De omzet per maand, zoals op Home en het dashboard.">
          <div className="flex h-[120px] items-end gap-2 rounded-[18px] border border-border bg-card p-4 shadow-card">
            {[62, 58, 71, 79, 86, 92, 74, 69, 88].map((h, i) => (
              <span
                key={h}
                className="flex-1 rounded-t-[6px]"
                style={{
                  height: `${h}%`,
                  background: i === 8 ? "var(--grafiek-accent)" : "var(--grafiek-rustig)",
                }}
              />
            ))}
          </div>
        </Blok>
      </main>
    </div>
  );
}

function Blok({ titel, uitleg, children }: { titel: string; uitleg: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">{titel}</h2>
        <p className="text-[12px] text-muted-foreground">{uitleg}</p>
      </div>
      {children}
    </section>
  );
}

const PIL: Record<string, string> = {
  groen: "bg-tint-groen text-tint-groen-ink",
  amber: "bg-tint-amber text-tint-amber-ink",
  blauw: "bg-tint-blauw text-tint-blauw-ink",
  rood: "bg-tint-rood text-tint-rood-ink",
  paars: "bg-tint-paars text-tint-paars-ink",
};

function Pil({ kleur, children }: { kleur: keyof typeof PIL; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${PIL[kleur]}`}
    >
      {children}
    </span>
  );
}
