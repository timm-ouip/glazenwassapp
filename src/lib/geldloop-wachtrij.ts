/**
 * De wachtrij van de geldloper: elke tik wordt eerst op de telefoon bewaard
 * en dan verstuurd. Is er geen bereik (portiek, kelder), of komt het antwoord
 * niet terug, dan blijft hij staan en gaat hij later opnieuw, met hetzelfde
 * id: de database telt hem dan maar één keer. Wat de database weigert, komt
 * in "niet verwerkt" met de reden erbij; er verdwijnt niets stilletjes.
 */
import { useEffect, useSyncExternalStore } from "react";

import { boek, type GeldloopAdres, type GeldloopLijst, type Tik } from "@/lib/geldlopen";
import { vooruitEerst, type GeldDeel } from "@/lib/betalingen";

export interface Wachtend extends Tik {
  vrijgave: string;
  /** Wie tikte, voor wat de lijst laat zien zolang hij nog niet verstuurd is. */
  door: string;
  door_naam: string;
  /** "Kerkstraat 12": om te laten zien waar het om ging als het misgaat. */
  adres_tekst?: string;
  /** Wat de server zei als hij het niet aannam. */
  fout?: string;
}

interface Stand {
  wachtend: Wachtend[];
  mislukt: Wachtend[];
}

const LEEG: Stand = { wachtend: [], mislukt: [] };
/** Hoe lang een verzoek mag duren voor we het als "geen bereik" zien. */
const TIJDSLIMIET_MS = 15_000;
let gebruiker: string | null = null;
let stand: Stand = LEEG;
const luisteraars = new Set<() => void>();
/** Wie wil weten dat een tik binnen is (om hem in de lijst te houden tot de
 *  verse lijst van de server er is). */
const verstuurdLuisteraars = new Set<(t: Wachtend) => void>();
/** Wie wil weten dat de server een tik weigerde. */
const geweigerdLuisteraars = new Set<(t: Wachtend) => void>();
let bezig = false;

export function bijVerstuurd(f: (t: Wachtend) => void): () => void {
  verstuurdLuisteraars.add(f);
  return () => verstuurdLuisteraars.delete(f);
}

export function bijGeweigerd(f: (t: Wachtend) => void): () => void {
  geweigerdLuisteraars.add(f);
  return () => geweigerdLuisteraars.delete(f);
}

function sleutel(uid: string) {
  return `wooshy.geldloop.wachtrij.${uid}`;
}

function lees(uid: string): Stand {
  try {
    const ruw = localStorage.getItem(sleutel(uid));
    if (!ruw) return LEEG;
    const x = JSON.parse(ruw) as Stand;
    return { wachtend: x.wachtend ?? [], mislukt: x.mislukt ?? [] };
  } catch {
    return LEEG;
  }
}

function bewaar() {
  if (!gebruiker) return;
  try {
    localStorage.setItem(sleutel(gebruiker), JSON.stringify(stand));
  } catch {
    // Opslag vol of geblokkeerd: dan alleen in het geheugen.
  }
}

function zet(nieuw: Stand) {
  stand = nieuw;
  bewaar();
  for (const l of luisteraars) l();
}

/**
 * Voor wie de wachtrij geldt; leest wat er nog op de telefoon stond. Bij
 * uitloggen (geen gebruiker) stopt een lopende ronde meteen: de tikken
 * blijven op de telefoon staan voor als die loper weer inlogt.
 */
function kiesGebruiker(uid: string | null | undefined) {
  const nieuw = uid ?? null;
  if (nieuw === gebruiker) return;
  gebruiker = nieuw;
  stand = nieuw ? lees(nieuw) : LEEG;
  for (const l of luisteraars) l();
}

/**
 * Weigerde de database de tik (dan heeft opnieuw proberen geen zin)? Dat zijn
 * zijn eigen meldingen (P0…) en fouten in de gegevens of rechten (22…, 23…,
 * 42…). Al het andere (geen bereik, time-out, server even weg, inlog
 * verlopen) gaat later opnieuw.
 */
function isWeigering(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  return typeof code === "string" && /^(P0|22|23|42)/.test(code);
}

/**
 * Stuurt wat er wacht, op volgorde (een Ongedaan maken moet na de tik komen
 * die hij terugdraait). Stopt bij de eerste keer geen bereik.
 */
export async function verstuurWachtrij(): Promise<void> {
  if (bezig) return;
  bezig = true;
  // Voor wie deze ronde loopt: wisselt de telefoon intussen van gebruiker,
  // dan stoppen we (de volgende ronde is voor de nieuwe).
  const voor = gebruiker;
  try {
    while (stand.wachtend.length > 0 && gebruiker === voor) {
      const t = stand.wachtend[0]!;
      const ac = new AbortController();
      const wekker = setTimeout(() => ac.abort(), TIJDSLIMIET_MS);
      try {
        await boek(t, ac.signal);
        if (gebruiker !== voor) return;
        for (const f of verstuurdLuisteraars) f(t);
        zet({ ...stand, wachtend: stand.wachtend.filter((w) => w.id !== t.id) });
      } catch (e) {
        if (!isWeigering(e) || gebruiker !== voor) return;
        const fout = { ...t, fout: (e as Error).message };
        zet({
          wachtend: stand.wachtend.filter((w) => w.id !== t.id),
          mislukt: [...stand.mislukt, fout],
        });
        for (const f of geweigerdLuisteraars) f(fout);
      } finally {
        clearTimeout(wekker);
      }
    }
  } finally {
    bezig = false;
  }
}

/**
 * Een tik op de telefoon zetten en op de achtergrond versturen. Wacht niet:
 * met één streepje bereik loop je gewoon door naar het volgende huis.
 */
export function zetInWachtrij(t: Wachtend) {
  zet({ ...stand, wachtend: [...stand.wachtend, t] });
  void verstuurWachtrij();
}

export function vergeetMislukt(id: string) {
  zet({ ...stand, mislukt: stand.mislukt.filter((w) => w.id !== id) });
}

/** Een geweigerde tik nog eens proberen. */
export function probeerOpnieuw(id: string) {
  const t = stand.mislukt.find((w) => w.id === id);
  if (!t) return;
  const { fout: _fout, ...schoon } = t;
  zet({ wachtend: [...stand.wachtend, schoon], mislukt: stand.mislukt.filter((w) => w.id !== id) });
  void verstuurWachtrij();
}

function abonneer(l: () => void) {
  luisteraars.add(l);
  return () => luisteraars.delete(l);
}

/** Wat er op de telefoon wacht of mislukte, en of er bereik is. */
export function useWachtrij(uid: string | null | undefined): Stand & { online: boolean } {
  // Niet tijdens het tekenen: dan zouden andere onderdelen midden in een
  // render bijgewerkt worden.
  useEffect(() => kiesGebruiker(uid), [uid]);
  const huidig = useSyncExternalStore(
    abonneer,
    () => stand,
    () => LEEG,
  );
  const online = useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  return { ...huidig, online };
}

/**
 * Houdt de wachtrij aan het versturen, overal in de app: ook als de avond
 * voorbij is of de loper de volgende ochtend de app opent. Eén keer, in de
 * layout.
 */
export function useWachtrijVersturen(uid: string | null | undefined) {
  useEffect(() => {
    kiesGebruiker(uid);
    if (!uid) return;
    const probeer = () => void verstuurWachtrij();
    window.addEventListener("online", probeer);
    document.addEventListener("visibilitychange", probeer);
    const t = setInterval(() => {
      if (stand.wachtend.length > 0) probeer();
    }, 15_000);
    probeer();
    return () => {
      window.removeEventListener("online", probeer);
      document.removeEventListener("visibilitychange", probeer);
      clearInterval(t);
    };
  }, [uid]);
}

// ---------------------------------------------------------------------
// Wat een tik met de lijst doet, zolang de server het nog niet heeft gezegd
// ---------------------------------------------------------------------

/** Haalt een bedrag van de oudste posten af, zoals de database dat ook doet. */
function trekAf(delen: GeldDeel[], bedrag: number): GeldDeel[] {
  let rest = bedrag;
  const uit: GeldDeel[] = [];
  for (const d of delen) {
    if (rest <= 0.005) {
      uit.push(d);
      continue;
    }
    const af = Math.min(rest, d.rest);
    rest -= af;
    if (d.rest - af > 0.005) uit.push({ ...d, rest: Math.round((d.rest - af) * 100) / 100 });
  }
  return uit;
}

const rond = (n: number) => Math.round(n * 100) / 100;

/** Een beurt waarvan alleen de meerprijs openstaat (de beurt zelf is vooruit
 *  betaald) telt niet als open wasbeurt, net als in de database. */
function openWassen(delen: GeldDeel[]): number {
  return delen.reduce(
    (t, d) =>
      t +
      (d.soort === "wassen"
        ? (d.vooruit ?? 0) > 0.005
          ? 0
          : 1
        : d.soort === "beginstand"
          ? Math.ceil((d.aantal * d.rest) / d.bedrag - 0.0001)
          : 0),
    0,
  );
}

/** Wat de vaste kortingen samen van de gewone prijs afhalen. */
function gewoneKorting(a: GeldloopAdres): number {
  return a.vaste_kortingen.reduce((t, k) => t + k.bedrag, 0);
}

export function pasToeOpAdres(a: GeldloopAdres, t: Wachtend): GeldloopAdres {
  const bedrag = t.bedrag ?? 0;
  // Zit hij er al in (de verse lijst van de server was sneller)? Dan niet
  // nog eens aftrekken.
  if (a.vanavond?.id === t.id || a.kortingen_vanavond.some((k) => k.id === t.id)) return a;
  switch (t.soort) {
    case "betaald": {
      const delen = trekAf(a.delen, bedrag);
      return {
        ...a,
        open: Math.round((a.open - bedrag) * 100) / 100,
        delen,
        open_wassen: openWassen(delen),
        vanavond: {
          id: t.id,
          soort: "betaald",
          bedrag,
          op: t.op,
          door: t.door,
          door_naam: t.door_naam,
        },
      };
    }
    case "korting": {
      const delen = trekAf(a.delen, bedrag);
      return {
        ...a,
        open: Math.round((a.open - bedrag) * 100) / 100,
        delen,
        open_wassen: openWassen(delen),
        kortingen_vanavond: [
          ...a.kortingen_vanavond,
          {
            id: t.id,
            bedrag,
            reden: t.reden ?? "",
            door: t.door,
            door_naam: t.door_naam,
            op: t.op,
          },
        ],
      };
    }
    case "vooruit": {
      // Zoals de database: de open wasbeurten vanaf `vooruit_vanaf` (meestal
      // de beurt van nu; zie vooruitEerst) gebruiken elk een vooruitbetaalde
      // beurt.
      // Wat er al met euro's aan betaald was, komt vrij en gaat naar de
      // andere posten; is een beurt goedkoper dan de prijs per beurt, dan
      // wordt het verschil tegoed. Een klus of de papieren kaart gebruikt
      // nooit een beurt. De prijs van de dag kent de telefoon niet; hij
      // rekent met de gewone prijs (de prijs per beurt plus de vaste
      // kortingen, die zitten daar al in) tot de server het precies zegt.
      const aantal = t.aantal ?? 0;
      const p = t.prijs_per_beurt ?? (aantal > 0 ? bedrag / aantal : 0);
      const gewoon = p + gewoneKorting(a);
      let over = aantal;
      let vrij = 0;
      let af = 0;
      const eerst = vooruitEerst(a.delen, a.vooruit_vanaf);
      const gedekt = a.delen
        .map((d) => {
          if (over <= 0 || !eerst.includes(d)) return d;
          over -= 1;
          const dek = Math.min(d.bedrag, gewoon);
          const tegoed = Math.max(0, p - dek);
          vrij += d.bedrag - d.rest + tegoed;
          af += dek + tegoed;
          return { ...d, rest: rond(d.bedrag - dek), vooruit: dek };
        })
        .filter((d) => d.rest > 0.005);
      const delen = trekAf(gedekt, vrij);
      return {
        ...a,
        open: rond(a.open - af),
        delen,
        open_wassen: openWassen(delen),
        vooruit_over: a.vooruit_over + over,
        vooruit_waarde: rond(a.vooruit_waarde + over * p),
        vanavond: {
          id: t.id,
          soort: "vooruit",
          bedrag,
          aantal,
          op: t.op,
          door: t.door,
          door_naam: t.door_naam,
        },
      };
    }
    case "terugbetaald":
    case "omgerekend":
      // Gebeurt op kantoor; hoort niet in de lijst van de avond.
      return a;
    case "niet_thuis":
    case "geen_geld":
      return {
        ...a,
        vanavond: {
          id: t.id,
          soort: t.soort,
          bedrag: 0,
          op: t.op,
          door: t.door,
          door_naam: t.door_naam,
        },
      };
    case "ongedaan": {
      const was = a.vanavond;
      if (was && was.id === t.herroept && was.soort === "vooruit") {
        // Beurten die nog over waren gaan eraf; wat al gebruikt was komt weer
        // open. Welke posten precies, zegt de server zo meteen.
        const aantal = was.aantal ?? 0;
        const p = aantal > 0 ? was.bedrag / aantal : 0;
        const ongebruikt = Math.min(aantal, a.vooruit_over);
        return {
          ...a,
          open: rond(a.open + (aantal - ongebruikt) * (p + gewoneKorting(a))),
          vooruit_over: a.vooruit_over - ongebruikt,
          vooruit_waarde: rond(Math.max(0, a.vooruit_waarde - ongebruikt * p)),
          vanavond: null,
        };
      }
      if (was && was.id === t.herroept) {
        const terug = was.soort === "betaald" ? was.bedrag : 0;
        return { ...a, open: a.open + terug, vanavond: null };
      }
      const korting = a.kortingen_vanavond.find((k) => k.id === t.herroept);
      if (korting) {
        return {
          ...a,
          open: a.open + korting.bedrag,
          kortingen_vanavond: a.kortingen_vanavond.filter((k) => k.id !== t.herroept),
        };
      }
      return a;
    }
  }
}

/** De lijst zoals hij is met de tikken erbij die nog onderweg zijn. */
export function metWachtende(lijst: GeldloopLijst, wachtend: Wachtend[]): GeldloopLijst {
  const hier = wachtend.filter((w) => w.vrijgave === lijst.vrijgave.id);
  if (hier.length === 0) return lijst;
  let adressen = lijst.adressen;
  let mij = lijst.opgehaald.mij;
  let mijAantal = lijst.opgehaald.mij_aantal;
  for (const t of hier) {
    adressen = adressen.map((a) => {
      if (a.id !== t.adres) return a;
      const na = pasToeOpAdres(a, t);
      // Alleen meetellen als de tik echt iets veranderde (hij kan al in de
      // verse lijst van de server zitten).
      if (na !== a) {
        // Vooruit is ook geld in de tas; het telt net zo mee als betaald.
        if (t.soort === "betaald" || t.soort === "vooruit") {
          mij += t.bedrag ?? 0;
          mijAantal += 1;
        } else if (t.soort === "ongedaan") {
          const was = a.vanavond;
          if (
            was &&
            was.id === t.herroept &&
            (was.soort === "betaald" || was.soort === "vooruit")
          ) {
            mij -= was.bedrag;
            mijAantal -= 1;
          }
        }
      }
      return na;
    });
  }
  return {
    ...lijst,
    adressen,
    opgehaald: { ...lijst.opgehaald, mij, mij_aantal: mijAantal },
  };
}
