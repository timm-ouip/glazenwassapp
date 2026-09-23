import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconBuilding as Building2,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconKey as KeyRound,
  IconMail as Mail,
  IconDeviceDesktop as Monitor,
  IconMoon as Moon,
  IconMoonFilled as MoonFel,
  IconPlus as Plus,
  IconSun as Sun,
  IconSunFilled as SunFel,
  IconTrash as Trash2,
  IconUser as User,
  IconUserPlus as UserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { requireSession, useAuth, useRequireAuth, type Rol } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  addQuickNote,
  deleteQuickNote,
  fetchCustomers,
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchMarkeringen,
  fetchQuickNotes,
  fetchStreets,
  nieuweMarkering,
  patchMarkering,
  tintNamen,
  tintStip,
  TINTEN,
  updateQuickNoteOmschrijving,
  verwijderMarkering,
  formatPrice,
  persistDistrictOrder,
  wijkKleur,
  type District,
  type MarkeringRij,
  type QuickNote,
  type Tint,
} from "@/lib/klanten";
import {
  bewaarPaaltjeDaglimiet,
  fetchPaaltjeDaglimiet,
  fetchPaaltjeVerbruik,
  verbruikVandaag,
} from "@/lib/paaltje-chat";
import { aanmeldAdres, fetchAanmeldingen } from "@/lib/aanmeldingen";
import { fetchWasdagen } from "@/lib/wasdag";
import { bewaarWerkdagen, useWerkdagen, WEEKDAGEN } from "@/lib/werkdagen";
import { fetchTeamleden, legTeamlidWeg, maakTeamlid } from "@/lib/ploegen";
import {
  bewaarPlanningInstellingen,
  draaiHerberekeningTerug,
  herberekenDuren,
  telDuren,
  usePlanningInstellingen,
} from "@/lib/planninginstellingen";
import type { PlanInstellingen } from "@/lib/dagplanning";
import { AANNAME_BEDRAG_PER_DAG, meetTempo, MINIMUM_DAGEN, tempoVan } from "@/lib/wijkritme";
import {
  bewaarThema,
  familieKeuzes,
  familieLabels,
  familieOmschrijving,
  familieVan,
  keuzeLabels,
  leesThema,
  type Thema,
  type ThemaFamilie,
} from "@/lib/thema";
import {
  assignRol,
  fetchTeam,
  inviteEmployee,
  removeEmployee,
  trekUitnodigingIn,
  updateEmployeeRole,
  updateMyProfile,
} from "@/lib/team.functions";
import { AanmeldInstellingen } from "@/components/AanmeldInstellingen";
import { bewaarEindtijd, fetchEindtijd } from "@/lib/geldlopen";
import { RollenBeheer } from "@/components/RollenBeheer";
import { fetchRollen } from "@/lib/rechten";
import { MailboxInstellingen } from "@/components/MailboxInstellingen";
import { BerichtSjablonen } from "@/components/BerichtSjablonen";
import { WhatsAppInstellingen } from "@/components/whatsapp/WhatsAppInstellingen";
import { PaaltjeAfspraken, PaaltjeCategorieen } from "@/components/PaaltjeInstellingen";
import { SchrijfstijlInstellingen } from "@/components/SchrijfstijlInstellingen";
import { AppLayout } from "@/components/AppLayout";
import { WijkToevoegenKnop } from "@/components/WijkKiezer";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { heeftRecht, useRecht } from "@/lib/rechten";

const TABBLADEN = ["account", "team", "wijken", "aanmelden", "mail", "voorkeuren"] as const;
type Tab = (typeof TABBLADEN)[number];

/** De tabbladen van vroeger, die nu bij een ander horen. Een opgeslagen link
 *  of een bladwijzer komt zo nog op de goede plek uit. */
const OUDE_TABS: Record<string, Tab> = {
  bedrijf: "account",
  notities: "voorkeuren",
  kleuren: "voorkeuren",
};

interface InstellingenSearch {
  tab: Tab;
  /** Terug van Kapso na het koppelen van WhatsApp. */
  kapso?: "klaar" | "mislukt";
  phone_number_id?: string;
  error_code?: string;
}

export const Route = createFileRoute("/instellingen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): InstellingenSearch => {
    const tab = String(search["tab"] ?? "");
    const uit: InstellingenSearch = {
      tab: (TABBLADEN as readonly string[]).includes(tab)
        ? (tab as Tab)
        : (OUDE_TABS[tab] ?? "account"),
    };
    const kapso = search["kapso"];
    if (kapso === "klaar" || kapso === "mislukt") {
      uit.kapso = kapso;
      const nummer = String(search["phone_number_id"] ?? "");
      if (/^\d{5,30}$/.test(nummer)) uit.phone_number_id = nummer;
      const code = String(search["error_code"] ?? "");
      if (/^[a-z_]{1,40}$/.test(code)) uit.error_code = code;
    }
    return uit;
  },
  head: () => ({ meta: [{ title: "Instellingen — Wooshy" }] }),
  component: Instellingen,
});

function Instellingen() {
  useRequireAuth();
  const { tab, kapso, phone_number_id, error_code } = Route.useSearch();
  const navigate = useNavigate();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  // Welke tabbladen je ziet hangt af van je rechten; je eigen account altijd.
  const tabMag: Partial<Record<string, boolean>> = {
    team: heeftRecht(employee, "instellingen_team"),
    wijken: heeftRecht(employee, "planning"),
    aanmelden: heeftRecht(employee, "klanten_bewerken"),
    mail: heeftRecht(employee, "mail_lezen"),
  };

  return (
    <AppLayout
      titel="Instellingen"
      kruimel="Beheer / Instellingen"
      onderschrift="Je bedrijf, je eigen account en wie er met je meewerkt."
    >
      {/* Naast elkaar in plaats van erboven: er komen tabbladen bij, en een
          rij die doorloopt tot buiten het scherm is geen menu meer. Op een
          smal scherm gaat de lijst weer boven de inhoud staan en loopt hij
          horizontaal, want daar is de breedte juist het schaarse. */}
      <Tabs
        orientation="vertical"
        value={tab}
        onValueChange={(v) =>
          void navigate({ to: "/instellingen", search: { tab: v as Tab }, replace: true })
        }
        className="flex flex-col gap-5 sm:flex-row sm:gap-6"
      >
        <TabsList className="h-auto w-full shrink-0 justify-start gap-0.5 overflow-x-auto bg-transparent p-0 fel:rounded-none fel:bg-transparent fel:p-0 sm:w-44 sm:flex-col sm:overflow-visible">
          {TABBLADEN.filter((t) => tabMag[t] ?? true).map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="w-full shrink-0 justify-start rounded-[10px] px-3 py-1.5 capitalize text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:w-full"
            >
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0 flex-1">
          {/* Jouw account en dat van het bedrijf staan op één blad: het is
              allebei "wie ben ik", en apart waren het twee halve pagina's. */}
          <TabsContent value="account" className="space-y-4">
            <AccountTab />
            <BedrijfTab isEigenaar={isEigenaar} />
          </TabsContent>
          <TabsContent value="team">
            <TeamTab />
          </TabsContent>
          <TabsContent value="wijken">
            <WijkenTab />
          </TabsContent>
          <TabsContent value="aanmelden">
            <AanmeldenTab isEigenaar={isEigenaar} />
          </TabsContent>
          <TabsContent value="mail" className="max-w-2xl">
            <div className="mb-4">
              <Kaart
                titel="Berichten aan klanten"
                uitleg="De vaste teksten voor de aankondiging, een wijziging in de planning en 'niet af gekomen'. De standaard staat al ingevuld als je gaat opstellen."
              >
                <BerichtSjablonen />
              </Kaart>
            </div>
            <Kaart
              titel="Mailbox"
              uitleg="Je gewone mail in Wooshy: alles wat binnenkomt, niet alleen antwoorden op aankondigingen."
            >
              <MailboxInstellingen isEigenaar={isEigenaar} />
            </Kaart>
            <div className="mt-4">
              <Kaart
                titel="WhatsApp"
                uitleg="Je zakelijke WhatsApp in Wooshy. Je nummer blijft gewoon werken in de app op je telefoon."
              >
                <WhatsAppInstellingen
                  isEigenaar={isEigenaar}
                  {...(kapso
                    ? {
                        kapsoTerug: {
                          status: kapso,
                          ...(phone_number_id ? { phoneNumberId: phone_number_id } : {}),
                          ...(error_code ? { foutcode: error_code } : {}),
                        },
                      }
                    : {})}
                />
              </Kaart>
            </div>
            <div className="mt-4">
              <Kaart
                titel="Paaltje: categorieën"
                uitleg="Waarin Paaltje binnenkomende mail indeelt, en hoeveel hij per soort zelf mag."
              >
                <PaaltjeCategorieen isEigenaar={isEigenaar} />
              </Kaart>
            </div>
            <div className="mt-4">
              <Kaart
                titel="Paaltje: vaste afspraken"
                uitleg="Waar Paaltje zich altijd aan houdt als hij een antwoord schrijft."
              >
                <PaaltjeAfspraken isEigenaar={isEigenaar} />
              </Kaart>
            </div>
          </TabsContent>
          {/* En hier alles wat je zelf inricht en daarna laat staan. Naast
              elkaar zodra er ruimte is: onder elkaar werd het een lange
              smalle strook met een leeg halfscherm ernaast. items-start,
              want de kaarten verschillen flink in hoogte en uitgerekt
              krijg je lege vlakken onderin. */}
          <TabsContent
            value="voorkeuren"
            className="grid max-w-6xl items-start gap-4 lg:grid-cols-2 xl:grid-cols-3"
          >
            <NotitiesTab />
            <KleurenTab />
            {/* Hoe de assistent antwoorden laat klinken: stel je één keer in,
                daarna leert hij verder van wat je zelf verstuurt. */}
            <Kaart
              titel="Schrijfstijl van Paaltje"
              uitleg="Voor de antwoorden die hij klaarzet in het postvak van Mailing."
            >
              <SchrijfstijlInstellingen isEigenaar={isEigenaar} />
            </Kaart>
            {isEigenaar && (
              <Kaart
                titel="Paaltje-assistent"
                uitleg="Hoeveel berichten Paaltje per dag beantwoordt, en hoeveel dat er de laatste tijd waren."
              >
                <PaaltjeAssistentKaart />
              </Kaart>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </AppLayout>
  );
}

/** Een kaart met een kop, zodat de drie tabbladen er hetzelfde uitzien. */
function Kaart({
  titel,
  uitleg,
  children,
}: {
  titel: string;
  uitleg?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-border bg-card shadow-card p-4">
      <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">{titel}</h2>
      {uitleg && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{uitleg}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Veld({
  id,
  label,
  waarde,
  onChange,
  lezen,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  waarde: string;
  onChange: (v: string) => void;
  lezen: boolean;
  /** Eén regel onder het vakje, voor wat je aan het veld niet kunt zien. */
  hint?: string;
} & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12.5px]">
        {label}
      </Label>
      <Input
        id={id}
        value={waarde}
        disabled={lezen}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// --- Bedrijf --------------------------------------------------------------

type Bedrijf = {
  name: string;
  adres: string;
  postcode: string;
  plaats: string;
  telefoon: string;
  email: string;
  kvk: string;
  btw: string;
  iban: string;
};

const LEEG_BEDRIJF: Bedrijf = {
  name: "",
  adres: "",
  postcode: "",
  plaats: "",
  telefoon: "",
  email: "",
  kvk: "",
  btw: "",
  iban: "",
};

function BedrijfTab({ isEigenaar }: { isEigenaar: boolean }) {
  const { employee, refreshEmployee } = useAuth();
  const [velden, setVelden] = useState<Bedrijf>(LEEG_BEDRIJF);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    if (!employee) return;
    let actief = true;
    void supabase
      .from("companies")
      .select("name,adres,postcode,plaats,telefoon,email,kvk,btw,iban")
      .eq("id", employee.company_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!actief) return;
        if (data) setVelden(data as Bedrijf);
        setLaden(false);
      });
    return () => {
      actief = false;
    };
  }, [employee]);

  function zet(sleutel: keyof Bedrijf) {
    return (v: string) => setVelden((vorig) => ({ ...vorig, [sleutel]: v }));
  }

  async function opslaan() {
    if (!employee) return;
    if (!velden.name.trim()) {
      toast.error("Een bedrijfsnaam is verplicht.");
      return;
    }
    setBezig(true);
    const { error } = await supabase
      .from("companies")
      .update({ ...velden, name: velden.name.trim() })
      .eq("id", employee.company_id);
    setBezig(false);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      return;
    }
    // De naam staat linksboven in de zijbalk; die moet meteen meeveranderen.
    await refreshEmployee();
    toast.success("Bedrijfsgegevens opgeslagen");
  }

  if (laden) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div className="grid max-w-3xl gap-4 lg:grid-cols-2">
      <Kaart titel="Contactgegevens" uitleg="De naam hiervan staat linksboven in de zijbalk.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Veld
              id="bedrijfsnaam"
              label="Bedrijfsnaam"
              waarde={velden.name}
              onChange={zet("name")}
              lezen={!isEigenaar}
            />
          </div>
          <div className="sm:col-span-2">
            <Veld
              id="bedrijfsadres"
              label="Adres"
              waarde={velden.adres}
              onChange={zet("adres")}
              lezen={!isEigenaar}
            />
          </div>
          <Veld
            id="bedrijfspostcode"
            label="Postcode"
            waarde={velden.postcode}
            onChange={zet("postcode")}
            lezen={!isEigenaar}
          />
          <Veld
            id="bedrijfsplaats"
            label="Plaats"
            waarde={velden.plaats}
            onChange={zet("plaats")}
            lezen={!isEigenaar}
          />
          <Veld
            id="bedrijfstelefoon"
            label="Telefoon"
            type="tel"
            waarde={velden.telefoon}
            onChange={zet("telefoon")}
            lezen={!isEigenaar}
          />
          <Veld
            id="bedrijfsemail"
            label="E-mailadres"
            type="email"
            waarde={velden.email}
            onChange={zet("email")}
            lezen={!isEigenaar}
          />
        </div>
      </Kaart>

      <Kaart titel="Zakelijke gegevens" uitleg="Voor op een factuur of een offerte.">
        <div className="grid gap-3">
          <Veld
            id="bedrijfskvk"
            label="KvK-nummer"
            waarde={velden.kvk}
            onChange={zet("kvk")}
            lezen={!isEigenaar}
          />
          <Veld
            id="bedrijfsbtw"
            label="Btw-nummer"
            waarde={velden.btw}
            onChange={zet("btw")}
            lezen={!isEigenaar}
          />
          <Veld
            id="bedrijfsiban"
            label="IBAN"
            waarde={velden.iban}
            onChange={zet("iban")}
            lezen={!isEigenaar}
          />
        </div>
      </Kaart>

      <div className="lg:col-span-2">
        {isEigenaar ? (
          <Button className="rounded-full" disabled={bezig} onClick={() => void opslaan()}>
            <Building2 className="size-4" /> {bezig ? "Bezig…" : "Bedrijfsgegevens opslaan"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Alleen de eigenaar kan de bedrijfsgegevens wijzigen.
          </p>
        )}
      </div>
    </div>
  );
}

// --- Account --------------------------------------------------------------

function AccountTab() {
  const { session, employee, refreshEmployee } = useAuth();
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [herhaling, setHerhaling] = useState("");
  const [bezig, setBezig] = useState<"naam" | "email" | "wachtwoord" | null>(null);

  useEffect(() => {
    setNaam(employee?.naam ?? "");
    setEmail(session?.user.email ?? "");
  }, [employee, session]);

  async function slaNaamOp() {
    if (!naam.trim()) {
      toast.error("Vul je naam in.");
      return;
    }
    setBezig("naam");
    try {
      await updateMyProfile({ data: { naam: naam.trim() } });
      await refreshEmployee();
      toast.success("Naam opgeslagen");
    } catch (err) {
      toast.error("Opslaan mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setBezig(null);
  }

  async function slaEmailOp() {
    const nieuw = email.trim();
    if (!nieuw) {
      toast.error("Vul een e-mailadres in.");
      return;
    }
    if (nieuw === session?.user.email) {
      toast.error("Dit is al je e-mailadres.");
      return;
    }
    setBezig("email");
    const { error } = await supabase.auth.updateUser({ email: nieuw });
    setBezig(null);
    if (error) {
      toast.error("Wijzigen mislukt: " + error.message);
      return;
    }
    toast.success(`Kijk in de mail op ${nieuw} om de wijziging te bevestigen`, { duration: 10000 });
  }

  async function slaWachtwoordOp() {
    if (wachtwoord.length < 6) {
      toast.error("Een wachtwoord moet minstens 6 tekens lang zijn.");
      return;
    }
    if (wachtwoord !== herhaling) {
      toast.error("De twee wachtwoorden zijn niet gelijk.");
      return;
    }
    setBezig("wachtwoord");
    const { error } = await supabase.auth.updateUser({ password: wachtwoord });
    setBezig(null);
    if (error) {
      toast.error("Wijzigen mislukt: " + error.message);
      return;
    }
    setWachtwoord("");
    setHerhaling("");
    toast.success("Wachtwoord gewijzigd");
  }

  return (
    <div className="grid max-w-3xl gap-4 lg:grid-cols-2">
      <WeergaveKaart />

      <Kaart titel="Je naam" uitleg="Wat je collega's in het team van je zien.">
        <div className="space-y-3">
          <Veld id="eigennaam" label="Naam" waarde={naam} onChange={setNaam} lezen={false} />
          <Button
            className="rounded-full"
            disabled={bezig === "naam"}
            onClick={() => void slaNaamOp()}
          >
            <User className="size-4" /> {bezig === "naam" ? "Bezig…" : "Naam opslaan"}
          </Button>
        </div>
      </Kaart>

      <Kaart
        titel="E-mailadres"
        uitleg="Je logt hiermee in. Na het opslaan sturen we een mail naar het nieuwe adres; pas als je daarop klikt verandert je inlog."
      >
        <div className="space-y-3">
          <Veld
            id="eigenemail"
            label="E-mailadres"
            type="email"
            autoComplete="email"
            waarde={email}
            onChange={setEmail}
            lezen={false}
          />
          <Button
            className="rounded-full"
            disabled={bezig === "email"}
            onClick={() => void slaEmailOp()}
          >
            <Mail className="size-4" /> {bezig === "email" ? "Bezig…" : "E-mailadres wijzigen"}
          </Button>
        </div>
      </Kaart>

      <Kaart
        titel="Wachtwoord"
        uitleg="Je hoeft je oude wachtwoord niet in te vullen — je bent al ingelogd."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Veld
            id="nieuwwachtwoord"
            label="Nieuw wachtwoord"
            type="password"
            autoComplete="new-password"
            waarde={wachtwoord}
            onChange={setWachtwoord}
            lezen={false}
          />
          <Veld
            id="herhaalwachtwoord"
            label="Nog een keer"
            type="password"
            autoComplete="new-password"
            waarde={herhaling}
            onChange={setHerhaling}
            lezen={false}
          />
          <div className="sm:col-span-2">
            <Button
              className="rounded-full"
              disabled={bezig === "wachtwoord"}
              onClick={() => void slaWachtwoordOp()}
            >
              <KeyRound className="size-4" />{" "}
              {bezig === "wachtwoord" ? "Bezig…" : "Wachtwoord wijzigen"}
            </Button>
          </div>
        </div>
      </Kaart>
    </div>
  );
}

// --- Team -----------------------------------------------------------------

type Collega = {
  id: string;
  naam: string;
  email: string;
  rol: string;
  rol_id: string | null;
  created_at: string;
};

function TeamTab() {
  const { employee } = useAuth();
  const [laden, setLaden] = useState(true);
  const [rol, setRol] = useState<string | null>(null);
  const [collegas, setCollegas] = useState<Collega[]>([]);
  /** Uitgenodigd maar nog niet binnen; alleen de eigenaar krijgt deze lijst. */
  const [uitgenodigd, setUitgenodigd] = useState<
    { id: string; email: string; op: string; verlopen: boolean }[]
  >([]);
  const [nieuweEmail, setNieuweEmail] = useState("");
  const [uitnodigen, setUitnodigen] = useState(false);
  const bevestig = useBevestig();

  async function herlaad() {
    setLaden(true);
    try {
      const data = await fetchTeam();
      setRol(data.rol);
      setCollegas(data.collegas as Collega[]);
      setUitgenodigd(data.uitgenodigd);
    } catch (err) {
      toast.error("Team laden mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setLaden(false);
  }

  useEffect(() => {
    void herlaad();
  }, []);

  const isEigenaar = rol === "eigenaar";
  const aantalEigenaren = collegas.filter((c) => c.rol === "eigenaar").length;
  const rollen = useQuery({ queryKey: ["rollen"], queryFn: fetchRollen });
  const gebruikt = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of collegas) if (c.rol_id) m.set(c.rol_id, (m.get(c.rol_id) ?? 0) + 1);
    return m;
  }, [collegas]);

  async function kiesRol(c: Collega, rolId: string | null) {
    try {
      await assignRol({ data: { employeeId: c.id, rolId } });
      toast.success(`Rechten van ${c.naam || c.email} bijgewerkt`);
      void herlaad();
    } catch (err) {
      toast.error("Rol kiezen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function nodigUit(email = nieuweEmail.trim()) {
    if (!email) {
      toast.error("Vul een e-mailadres in.");
      return;
    }
    setUitnodigen(true);
    try {
      const uit = await inviteEmployee({ data: { email } });
      if (uit.via === "supabase") {
        // Geen eigen mailbox: dan de kale standaardmail. Zeggen hoe het mooier kan.
        toast.success(`Uitnodiging verstuurd naar ${email} (7 dagen geldig).`, {
          description:
            "Dit ging via de standaardmail van Supabase. Koppel je bedrijfsmail bij Instellingen → mail, dan komt hij voortaan van je eigen adres.",
          duration: 10000,
        });
      } else {
        toast.success(
          `Uitnodiging verstuurd naar ${email} vanaf ${uit.van}. Hij is 7 dagen geldig.`,
        );
      }
      setNieuweEmail("");
      void herlaad();
    } catch (err) {
      toast.error("Uitnodigen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setUitnodigen(false);
  }

  async function trekIn(u: { id: string; email: string }) {
    const ja = await bevestig({
      titel: `Uitnodiging van ${u.email} intrekken?`,
      tekst: "De link in zijn mail werkt dan niet meer. Je kunt hem later opnieuw uitnodigen.",
      bevestigLabel: "Intrekken",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await trekUitnodigingIn({ data: { userId: u.id } });
      toast.success("Uitnodiging ingetrokken");
      void herlaad();
    } catch (err) {
      toast.error("Intrekken mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function wijzigRol(c: Collega, nieuw: Rol) {
    try {
      await updateEmployeeRole({ data: { employeeId: c.id, rol: nieuw } });
      toast.success(`${c.naam || c.email} is nu ${nieuw}`);
      void herlaad();
    } catch (err) {
      toast.error("Rol wijzigen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function verwijder(c: Collega) {
    const ja = await bevestig({
      titel: `${c.naam || c.email} verwijderen uit het team?`,
      tekst: "Deze medewerker verliest direct toegang tot de klantgegevens.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await removeEmployee({ data: { employeeId: c.id } });
      toast.success("Medewerker verwijderd");
      void herlaad();
    } catch (err) {
      toast.error("Verwijderen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (laden) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      {/* Op de telefoon past de tabel niet: dan schuift hij opzij, zodat
          Rechten en het prullenbakje nog te bereiken zijn. */}
      <div className="overflow-x-auto rounded-[18px] border border-border bg-card shadow-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-card-header text-left text-[11px] font-medium text-muted-foreground/80 zak:bg-card zak:text-[10px] zak:font-bold zak:uppercase zak:tracking-[0.08em] zak:text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Naam</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Rol</th>
              <th className="px-3 py-2 font-medium">Rechten</th>
              {isEigenaar && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {collegas.map((c) => {
              const zelf = c.id === employee?.id;
              // De laatste eigenaar moet eigenaar blijven, anders kan niemand
              // het bedrijf nog beheren.
              const laatsteEigenaar = c.rol === "eigenaar" && aantalEigenaren <= 1;
              const reden = zelf
                ? "Je kunt je eigen rol niet wijzigen"
                : laatsteEigenaar
                  ? "Er moet minstens één eigenaar blijven"
                  : undefined;
              return (
                <tr key={c.id} className="border-t border-border/60">
                  <td className="px-3 py-2">{c.naam || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.email}</td>
                  <td className="px-3 py-2">
                    {isEigenaar ? (
                      <select
                        className="rounded-[10px] border border-border bg-card px-2.5 py-1 text-[13px] disabled:cursor-not-allowed disabled:text-muted-foreground"
                        value={c.rol}
                        disabled={zelf || laatsteEigenaar}
                        title={reden}
                        aria-label={`Rol van ${c.naam || c.email}`}
                        onChange={(e) => void wijzigRol(c, e.target.value as Rol)}
                      >
                        <option value="eigenaar">Eigenaar</option>
                        <option value="medewerker">Medewerker</option>
                      </select>
                    ) : (
                      <span className="capitalize">{c.rol}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {c.rol === "eigenaar" ? (
                      <span className="text-[13px] text-muted-foreground">Alles</span>
                    ) : isEigenaar ? (
                      <select
                        className="rounded-[10px] border border-border bg-card px-2.5 py-1 text-[13px]"
                        value={c.rol_id ?? ""}
                        aria-label={`Rechten van ${c.naam || c.email}`}
                        onChange={(e) => void kiesRol(c, e.target.value || null)}
                      >
                        <option value="">
                          {rollen.isError ? "Rollen niet geladen" : "Geen rechten"}
                        </option>
                        {(rollen.data ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.naam}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[13px]">
                        {rollen.isError
                          ? "Onbekend"
                          : (rollen.data?.find((r) => r.id === c.rol_id)?.naam ??
                            (c.rol_id ? "…" : "Geen rechten"))}
                      </span>
                    )}
                  </td>
                  {isEigenaar && (
                    <td className="px-3 py-2 text-right">
                      {!zelf && c.rol !== "eigenaar" && (
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                          onClick={() => void verwijder(c)}
                          aria-label={`${c.naam || c.email} verwijderen`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isEigenaar && uitgenodigd.length > 0 && (
        <Kaart
          titel="Uitgenodigd, nog niet binnen"
          uitleg="Een uitnodiging is 7 dagen geldig. Trek hem in als hij niet meer nodig is."
        >
          <ul className="divide-y divide-border/60">
            {uitgenodigd.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{u.email}</p>
                  <p
                    className={`text-[12px] ${u.verlopen ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {u.verlopen
                      ? "Verlopen: stuur hem opnieuw als hij nog moet komen"
                      : `Verstuurd op ${new Date(u.op).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={uitnodigen}
                  onClick={() => void nodigUit(u.email)}
                >
                  Opnieuw sturen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground hover:text-destructive"
                  onClick={() => void trekIn(u)}
                >
                  Intrekken
                </Button>
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {isEigenaar && <RollenBeheer gebruikt={gebruikt} onGewijzigd={() => void herlaad()} />}

      <TeamledenKaart isEigenaar={isEigenaar} />

      {isEigenaar ? (
        <Kaart
          titel="Medewerker uitnodigen"
          uitleg="Hij krijgt een mail vanaf je bedrijfsadres om zijn naam en een wachtwoord te kiezen, en komt daarna in dit team. De link is 7 dagen geldig."
        >
          <form
            className="flex max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void nodigUit();
            }}
          >
            <Input
              type="email"
              placeholder="naam@bedrijf.nl"
              value={nieuweEmail}
              onChange={(e) => setNieuweEmail(e.target.value)}
            />
            <Button type="submit" disabled={uitnodigen} className="shrink-0 rounded-full">
              <UserPlus className="size-4" /> Uitnodigen
            </Button>
          </form>
        </Kaart>
      ) : (
        <p className="text-sm text-muted-foreground">
          Alleen de eigenaar kan medewerkers uitnodigen, verwijderen of hun rol wijzigen.
        </p>
      )}
    </div>
  );
}

/**
 * Teamleden die (nog) geen account hebben: een hulpkracht die wel meewast en
 * dus in een ploeg moet kunnen staan. Later kun je hem alsnog uitnodigen;
 * accepteert hij, dan is het dezelfde persoon en blijft zijn planning kloppen.
 */
function TeamledenKaart({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [nieuw, setNieuw] = useState("");
  const [bezig, setBezig] = useState(false);
  const [uitnodigen, setUitnodigen] = useState<{ id: string; naam: string } | null>(null);
  const [email, setEmail] = useState("");
  const teamleden = useQuery({ queryKey: ["teamleden"], queryFn: fetchTeamleden });
  const zonderAccount = (teamleden.data ?? []).filter((t) => !t.employee_id);

  async function ververs() {
    await qc.invalidateQueries({ queryKey: ["teamleden"] });
  }

  async function voegToe() {
    const naam = nieuw.trim();
    if (!naam) return;
    setBezig(true);
    try {
      await maakTeamlid(naam);
      setNieuw("");
      await ververs();
      toast.success(`${naam} staat in het team`);
    } catch (e) {
      toast.error("Toevoegen mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function haalWeg(id: string, naam: string) {
    const ja = await bevestig({
      titel: `${naam} uit het team halen?`,
      tekst: "Hij verdwijnt uit de teamkeuze. Teams van dagen die geweest zijn blijven kloppen.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await legTeamlidWeg(id);
      await ververs();
      toast.success("Teamlid weggehaald");
    } catch (e) {
      toast.error("Weghalen mislukt: " + (e as Error).message);
    }
  }

  async function stuurUitnodiging() {
    if (!uitnodigen || !email.trim()) return;
    setBezig(true);
    try {
      const uit = await inviteEmployee({ data: { email: email.trim(), teamlidId: uitnodigen.id } });
      toast.success(
        uit.via === "supabase"
          ? `Uitnodiging verstuurd naar ${email.trim()} (7 dagen geldig).`
          : `Uitnodiging verstuurd naar ${email.trim()} vanaf ${uit.van}. Hij is 7 dagen geldig.`,
      );
      setUitnodigen(null);
      setEmail("");
      await ververs();
    } catch (e) {
      toast.error("Uitnodigen mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Kaart
      titel="Teamleden zonder account"
      uitleg="Wie meewast maar niet in de app hoeft. Je kunt ze wel op een dag in een team zetten, en later alsnog uitnodigen."
    >
      {zonderAccount.length > 0 && (
        <ul className="mb-3 divide-y divide-border/60">
          {zonderAccount.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{t.naam}</span>
              {t.uitgenodigd_user_id && (
                <span className="text-[12px] text-muted-foreground">uitnodiging verstuurd</span>
              )}
              {isEigenaar && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setUitnodigen({ id: t.id, naam: t.naam });
                      setEmail("");
                    }}
                  >
                    Uitnodigen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => void haalWeg(t.id, t.naam)}
                  >
                    Weghalen
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {uitnodigen && (
        <form
          className="mb-3 flex max-w-md flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card-header p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void stuurUitnodiging();
          }}
        >
          <span className="text-[13px]">{uitnodigen.naam} uitnodigen:</span>
          <Input
            type="email"
            placeholder="naam@bedrijf.nl"
            className="h-9 max-w-[16rem] flex-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={bezig} className="rounded-full">
            Versturen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            className="rounded-full"
            onClick={() => setUitnodigen(null)}
          >
            Annuleren
          </Button>
        </form>
      )}

      {isEigenaar ? (
        <form
          className="flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void voegToe();
          }}
        >
          <Input
            placeholder="Naam"
            value={nieuw}
            onChange={(e) => setNieuw(e.target.value)}
            disabled={bezig}
          />
          <Button type="submit" disabled={bezig || !nieuw.trim()} className="shrink-0 rounded-full">
            <UserPlus className="size-4" /> Toevoegen
          </Button>
        </form>
      ) : (
        zonderAccount.length === 0 && (
          <p className="text-sm text-muted-foreground">Er zijn geen teamleden zonder account.</p>
        )
      )}
    </Kaart>
  );
}

// --- Notities -------------------------------------------------------------

/**
 * De snelkeuzes onder het notitieveld. Toevoegen kan ook daar; weggooien
 * bewust alleen hier, want in dat popovertje klik je er zo eentje weg terwijl
 * je een klant zit te bewerken.
 */
/**
 * De volgorde van de wijken: de ronde die je rijdt. Die volgorde bepaalt de
 * kleuren op de kalender, de sortering in de lijsten, en welke wijk de app
 * voorstelt als eerstvolgende.
 *
 * Erbij staat wat de app van je dagen geleerd heeft: hoeveel adressen je
 * gemiddeld op een dag doet, en hoeveel dagen dat gemiddelde telt. Zolang dat
 * er weinig zijn is het een aanname, en dat hoort er gewoon te staan.
 */
/**
 * Op welke dagen van de week je wast. Opschuiven op de planning, het voorstel
 * voor de volgende wijk en "Inplannen voor…" slaan de andere dagen over.
 */
function WerkdagenKaart() {
  const { employee, company } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const qc = useQueryClient();
  const opgeslagen = useWerkdagen();
  const [keuze, setKeuze] = useState<number[] | null>(null);
  const [bezig, setBezig] = useState(false);
  const dagen = keuze ?? opgeslagen;

  function wissel(nr: number) {
    setKeuze(
      dagen.includes(nr) ? dagen.filter((d) => d !== nr) : [...dagen, nr].sort((a, b) => a - b),
    );
  }

  async function bewaar() {
    if (!keuze || !company) return;
    if (keuze.length === 0) {
      toast.error("Kies minstens één werkdag.");
      return;
    }
    setBezig(true);
    try {
      await bewaarWerkdagen(company.id, keuze);
      await qc.invalidateQueries({ queryKey: ["werkdagen"] });
      setKeuze(null);
      toast.success("Werkdagen opgeslagen");
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Kaart
      titel="Werkdagen"
      uitleg="Op welke dagen je wast. Opschuiven op de planning, het voorstel voor de volgende wijk en 'Inplannen voor…' slaan de andere dagen over."
    >
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAGEN.map((w) => {
          const aan = dagen.includes(w.nr);
          return (
            <button
              key={w.nr}
              type="button"
              title={w.lang}
              aria-label={w.lang}
              aria-pressed={aan}
              disabled={!isEigenaar || bezig}
              onClick={() => wissel(w.nr)}
              className={`h-9 min-w-11 rounded-full border px-3 text-sm font-medium transition-colors disabled:cursor-default ${
                aan
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground enabled:hover:text-foreground"
              }`}
            >
              {w.kort}
            </button>
          );
        })}
      </div>
      {!isEigenaar && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Alleen de eigenaar kan de werkdagen aanpassen.
        </p>
      )}
      {keuze && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={() => void bewaar()} disabled={bezig}>
            {bezig ? "Bezig…" : "Werkdagen opslaan"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setKeuze(null)} disabled={bezig}>
            Annuleren
          </Button>
        </div>
      )}
    </Kaart>
  );
}

/**
 * De instellingen waar de planning mee rekent: het uurtarief waarmee de duur
 * uit de prijs komt, de werktijd, de pauze, de rijtijd bij een wijkwissel, en
 * vanaf wanneer een pand een eigen blok krijgt.
 *
 * Verander je het tarief, dan vraagt de app of de duren bijgewerkt moeten
 * worden. Duren die je zelf invulde blijven standaard staan, en bijwerken kun
 * je meteen ongedaan maken.
 */
/** Tot hoe laat een vrijgegeven wijk open blijft voor de geldlopers. */
function GeldlopenKaart() {
  const { employee, company } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const qc = useQueryClient();
  const eind = useQuery({
    queryKey: ["geldloop-eindtijd", company?.id],
    queryFn: () => fetchEindtijd(company!.id),
    enabled: !!company && isEigenaar,
  });
  const [waarde, setWaarde] = useState("");
  useEffect(() => {
    if (eind.data) setWaarde(eind.data);
  }, [eind.data]);
  if (!isEigenaar) return null;

  async function bewaar(nieuw: string) {
    if (!company || !nieuw || nieuw === eind.data) return;
    try {
      await bewaarEindtijd(company.id, nieuw);
      void qc.invalidateQueries({ queryKey: ["geldloop-eindtijd"] });
      toast.success(`Een vrijgegeven wijk blijft voortaan open tot ${nieuw}`);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    }
  }

  return (
    <Kaart
      titel="Geld lopen"
      uitleg="Tot hoe laat een wijk die je vrijgeeft open blijft voor de geldlopers. Daarna zien ze niets meer; wat ze ingetikt hebben blijft bewaard. Een avond die al loopt verandert niet mee."
    >
      <label className="flex items-center gap-2 text-[13px]">
        Open tot
        <Input
          type="time"
          className="w-32 rounded-full"
          value={waarde}
          onChange={(e) => setWaarde(e.target.value)}
          onBlur={(e) => void bewaar(e.target.value)}
        />
      </label>
    </Kaart>
  );
}

function PlanningKaart() {
  const { employee, company } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const prijzenZien = useRecht("prijzen_zien");
  const qc = useQueryClient();
  const opgeslagen = usePlanningInstellingen();
  const [concept, setConcept] = useState<PlanInstellingen | null>(null);
  const [bezig, setBezig] = useState(false);
  const i = concept ?? opgeslagen;
  const bevestig = useBevestig();

  function zet(patch: Partial<PlanInstellingen>) {
    setConcept({ ...i, ...patch });
  }

  async function vraagOmBijwerken(nieuwTarief: number) {
    let tellingen = { automatisch: 0, zelf: 0 };
    try {
      tellingen = await telDuren();
    } catch {
      // Lukt tellen niet, dan vragen we het zonder aantallen.
    }
    const ja = await bevestig({
      titel: "Duren bijwerken met het nieuwe tarief?",
      tekst:
        `${tellingen.automatisch} ${tellingen.automatisch === 1 ? "adres heeft" : "adressen hebben"} een automatische duur` +
        (tellingen.zelf > 0
          ? `, en bij ${tellingen.zelf} vulde je hem zelf in. Die laatste blijven staan.`
          : ". Je kunt dit meteen ongedaan maken."),
      bevestigLabel: "Bijwerken",
      annuleerLabel: "Laten staan",
    });
    if (!ja) return;
    try {
      const uit = await herberekenDuren(nieuwTarief, false);
      await qc.invalidateQueries({ queryKey: ["customers"] });
      await qc.invalidateQueries({ queryKey: ["klussen"] });
      toast.success(`${uit.adressen} ${uit.adressen === 1 ? "adres" : "adressen"} bijgewerkt`, {
        action: uit.kenmerk
          ? {
              label: "Ongedaan maken",
              onClick: () => {
                void draaiHerberekeningTerug(uit.kenmerk)
                  .then(async () => {
                    await qc.invalidateQueries({ queryKey: ["customers"] });
                    await qc.invalidateQueries({ queryKey: ["klussen"] });
                    toast.success("Duren teruggezet");
                  })
                  .catch((e: unknown) =>
                    toast.error("Terugzetten mislukt: " + (e as Error).message),
                  );
              },
            }
          : undefined,
        duration: 10000,
      });
    } catch (e) {
      toast.error("Bijwerken mislukt: " + (e as Error).message);
    }
  }

  async function bewaar() {
    if (!concept || !company) return;
    if (concept.tariefUur <= 0) {
      toast.error("Vul een uurtarief hoger dan nul in.");
      return;
    }
    if (concept.eind <= concept.begin) {
      toast.error("De eindtijd moet na de begintijd liggen.");
      return;
    }
    setBezig(true);
    try {
      const tariefVeranderde = concept.tariefUur !== opgeslagen.tariefUur;
      await bewaarPlanningInstellingen(company.id, concept);
      await qc.invalidateQueries({ queryKey: ["planning-instellingen"] });
      setConcept(null);
      toast.success("Planning opgeslagen");
      if (tariefVeranderde) await vraagOmBijwerken(concept.tariefUur);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  const getal = (waarde: number) => String(waarde);

  return (
    <Kaart
      titel="Planning en tijd"
      uitleg="Waar de week- en dagweergave mee rekenen: hoe lang een adres duurt, hoe lang je werkdag is, en hoeveel rijtijd er tussen twee wijken zit."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {prijzenZien && (
          <Veld
            id="tarief"
            label="Wat was je weg per uur (€)"
            waarde={getal(i.tariefUur)}
            lezen={!isEigenaar}
            inputMode="decimal"
            onChange={(v) => zet({ tariefUur: Number(v.replace(",", ".")) || 0 })}
          />
        )}
        <Veld
          id="grootpand"
          label="Eigen blok vanaf (minuten)"
          waarde={getal(i.grootPandMin)}
          lezen={!isEigenaar}
          inputMode="numeric"
          onChange={(v) => zet({ grootPandMin: Number(v) || 0 })}
        />
        <Veld
          id="begin"
          label="Werkdag begint"
          waarde={i.begin}
          lezen={!isEigenaar}
          type="time"
          onChange={(v) => zet({ begin: v })}
        />
        <Veld
          id="eind"
          label="Werkdag eindigt"
          waarde={i.eind}
          lezen={!isEigenaar}
          type="time"
          onChange={(v) => zet({ eind: v })}
        />
        <Veld
          id="pauzevan"
          label="Pauze om"
          waarde={i.pauzeVan}
          lezen={!isEigenaar}
          type="time"
          onChange={(v) => zet({ pauzeVan: v })}
        />
        <Veld
          id="pauzemin"
          label="Pauze (minuten)"
          waarde={getal(i.pauzeMin)}
          lezen={!isEigenaar}
          inputMode="numeric"
          hint="0 = geen pauze: hij telt niet mee en staat niet in de planning."
          onChange={(v) => zet({ pauzeMin: Number(v) || 0 })}
        />
        <Veld
          id="rijtijd"
          label="Rijtijd bij een andere wijk (minuten)"
          waarde={getal(i.rijtijdMin)}
          lezen={!isEigenaar}
          inputMode="numeric"
          hint="0 = geen rijtijd tussen twee wijken."
          onChange={(v) => zet({ rijtijdMin: Number(v) || 0 })}
        />
      </div>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-[13px]">
          <Switch
            checked={i.tijdlijn}
            disabled={!isEigenaar}
            onCheckedChange={(aan) =>
              zet({ tijdlijn: aan, ...(aan ? {} : { tijdvakMailen: false }) })
            }
          />
          Tijdlijn in de dagweergave
        </label>
        <label className="ml-8 flex items-center gap-2 text-[13px]">
          <Switch
            checked={i.tijdvakMailen}
            disabled={!isEigenaar || !i.tijdlijn}
            onCheckedChange={(aan) => zet({ tijdvakMailen: aan })}
          />
          <span className={i.tijdlijn ? "" : "text-muted-foreground"}>
            Tijdvak in de aankondiging (alleen grote panden, venster van 2 uur)
          </span>
        </label>
      </div>

      {!isEigenaar && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Alleen de eigenaar kan deze instellingen aanpassen.
        </p>
      )}
      {concept && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={() => void bewaar()} disabled={bezig}>
            {bezig ? "Bezig…" : "Opslaan"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConcept(null)} disabled={bezig}>
            Annuleren
          </Button>
        </div>
      )}
    </Kaart>
  );
}

function WijkenTab() {
  // Het tempo is in geld; zonder recht op prijzen tonen we alleen de dagen.
  const prijzenZien = useRecht("prijzen_zien");
  const qc = useQueryClient();
  const [volgorde, setVolgorde] = useState<District[] | null>(null);
  const [bezig, setBezig] = useState(false);

  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  // Het tempo komt uit gedaan werk, en daar horen adressen die later stopten
  // gewoon bij. Het aantal adressen per wijk blijft op de actieve lijst.
  const adressenQuery = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
  });

  // Een half jaar terugkijken is genoeg om een tempo uit af te leiden, en kort
  // genoeg dat een oude werkwijze het gemiddelde niet blijft vertekenen.
  const halfJaar = useMemo(() => {
    const nu = new Date();
    const van = new Date(nu.getFullYear(), nu.getMonth() - 6, 1);
    const dag = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { vanaf: dag(van), tot: dag(nu) };
  }, []);
  const wasdagenQuery = useQuery({
    queryKey: ["wasdagen", halfJaar.vanaf, halfJaar.tot],
    queryFn: () => fetchWasdagen(halfJaar.vanaf, halfJaar.tot),
  });

  const districts = volgorde ?? districtsQuery.data ?? [];
  const gemeten = useMemo(
    () => meetTempo(wasdagenQuery.data ?? [], adressenQuery.data ?? [], streetsQuery.data ?? []),
    [wasdagenQuery.data, adressenQuery.data, streetsQuery.data],
  );

  /** Hoeveel adressen hangen er aan deze wijk? Zegt of een wijk groot of
   *  klein is, los van wie er deze maand aan de beurt is. */
  const adressenPerWijk = useMemo(() => {
    const wijkVanStraat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s.district_id]));
    const telling = new Map<string, number>();
    for (const c of customersQuery.data ?? []) {
      const w = wijkVanStraat.get(c.street_id);
      if (w) telling.set(w, (telling.get(w) ?? 0) + 1);
    }
    return telling;
  }, [streetsQuery.data, customersQuery.data]);

  function verplaats(index: number, kant: -1 | 1) {
    const doel = index + kant;
    if (doel < 0 || doel >= districts.length) return;
    const nieuw = [...districts];
    const [eruit] = nieuw.splice(index, 1);
    nieuw.splice(doel, 0, eruit!);
    setVolgorde(nieuw);
  }

  async function bewaar() {
    if (!volgorde) return;
    setBezig(true);
    try {
      await persistDistrictOrder(volgorde);
      await qc.invalidateQueries({ queryKey: ["districts"] });
      setVolgorde(null);
      toast.success("Volgorde opgeslagen");
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      <WerkdagenKaart />
      <PlanningKaart />
      <GeldlopenKaart />
      <Kaart
        titel="Volgorde van de wijken"
        uitleg="De ronde die je rijdt. Deze volgorde bepaalt de kleuren op de kalender en welke wijk de app voorstelt als eerstvolgende."
      >
        {/* Hier en bij Importeren maak je wijken aan: dat doe je vooral in het
            begin, dus op de wijkenpagina zelf staat er geen knop meer voor. */}
        <div className="mb-3">
          <WijkToevoegenKnop
            districts={districtsQuery.data ?? []}
            onToegevoegd={() => {
              // Een half verschoven volgorde zou de nieuwe wijk verbergen tot
              // je opslaat; dan lijkt toevoegen niets te doen.
              setVolgorde(null);
              void qc.invalidateQueries({ queryKey: ["districts"] });
            }}
          />
        </div>
        {districts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nog geen wijken. Voeg er hierboven een toe, of importeer je Excel-bestand.
          </p>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-card shadow-card">
            {districts.map((d, i) => {
              const tempo = tempoVan(d.id, gemeten);
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 text-center text-[12px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: wijkKleur(i) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{d.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 text-[10.5px] font-medium ${
                          d.betaalmethode === "contant"
                            ? "bg-tint-groen text-tint-groen-ink"
                            : "bg-tint-blauw text-tint-blauw-ink"
                        }`}
                      >
                        {d.betaalmethode}
                      </span>
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {adressenPerWijk.get(d.id) ?? 0} adressen ·{" "}
                      {!prijzenZien
                        ? tempo.bron === "aanname"
                          ? "nog geen tempo gemeten"
                          : `tempo gemeten over ${tempo.dagen} ${tempo.dagen === 1 ? "dag" : "dagen"}${
                              tempo.bron === "alles" ? " (alle wijken)" : ""
                            }`
                        : tempo.bron === "aanname"
                          ? `aanname: ${formatPrice(tempo.bedragPerDag)} per dag`
                          : `${formatPrice(tempo.bedragPerDag)} per dag, gemeten over ${tempo.dagen} ${
                              tempo.dagen === 1 ? "dag" : "dagen"
                            }${tempo.bron === "alles" ? " (alle wijken)" : ""}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => verplaats(i, -1)}
                      aria-label={`${d.name} omhoog`}
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      disabled={i === districts.length - 1}
                      onClick={() => verplaats(i, 1)}
                      aria-label={`${d.name} omlaag`}
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {volgorde && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => void bewaar()} disabled={bezig}>
              {bezig ? "Bezig…" : "Volgorde opslaan"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setVolgorde(null)} disabled={bezig}>
              Annuleren
            </Button>
          </div>
        )}
      </Kaart>

      {prijzenZien && (
        <Kaart
          titel="Wat de app geleerd heeft"
          uitleg="Hoeveel je op een dag wegwast, afgeleid uit de dagen die je hebt afgevinkt. In geld en niet in adressen: een wijk met rijtjeshuizen en een wijk met villa's leveren heel verschillende aantallen op, maar een dag blijft een dag."
        >
          <p className="text-sm text-muted-foreground">
            {gemeten.algemeen.bron === "aanname" ? (
              <>
                {gemeten.algemeen.dagen === 0
                  ? "Er is nog geen enkele gewerkte dag om van te leren"
                  : `Er ${gemeten.algemeen.dagen === 1 ? "is" : "zijn"} ${gemeten.algemeen.dagen} gewerkte ${
                      gemeten.algemeen.dagen === 1 ? "dag" : "dagen"
                    }, en dat is te weinig om iets zinnigs uit af te leiden`}
                . Zolang het er minder dan {MINIMUM_DAGEN} zijn gaat de app uit van{" "}
                <strong className="font-medium text-foreground">
                  {formatPrice(AANNAME_BEDRAG_PER_DAG)} per dag
                </strong>
                . Daarna rekent ze op je eigen tempo.
              </>
            ) : (
              <>
                Een gewone werkdag is{" "}
                <strong className="font-medium text-foreground">
                  {formatPrice(gemeten.algemeen.bedragPerDag)}
                </strong>
                , gemeten over {gemeten.algemeen.dagen}{" "}
                {gemeten.algemeen.dagen === 1 ? "gewerkte dag" : "gewerkte dagen"} in het afgelopen
                half jaar.
              </>
            )}
          </p>
        </Kaart>
      )}
    </div>
  );
}

/**
 * De kleuren die je op een adres kunt zetten, met je eigen tekst erbij. Wat
 * geel betekent verschilt per bedrijf — bij de een is het "extra opletten",
 * bij de ander "hoge ramen" — dus dat hoort niet in de code te staan.
 *
 * De kleur kies je uit vier. Die vier zijn uitgezocht op leesbaarheid, in het
 * licht en in het donker en op papier; een vrij te kiezen kleur zou daar
 * zomaar doorheen kunnen zakken. Rood ontbreekt met opzet: dat betekent al
 * "deze maand overgeslagen".
 */
function KleurenTab() {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const { data: markeringen = [], isLoading } = useQuery({
    queryKey: ["markeringen"],
    queryFn: fetchMarkeringen,
  });
  const [nieuweNaam, setNieuweNaam] = useState("");
  const [nieuweTint, setNieuweTint] = useState<Tint>("amber");
  const [bezig, setBezig] = useState(false);

  function ververs() {
    return qc.invalidateQueries({ queryKey: ["markeringen"] });
  }

  async function voegToe() {
    const naam = nieuweNaam.trim();
    if (!naam) return;
    setBezig(true);
    try {
      await nieuweMarkering(naam, nieuweTint, markeringen.length + 1);
      setNieuweNaam("");
      await ververs();
    } catch (err) {
      toast.error("Toevoegen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setBezig(false);
  }

  async function pas(m: MarkeringRij, patch: { naam?: string; tint?: Tint }) {
    if (patch.naam !== undefined && patch.naam.trim() === m.naam) return;
    try {
      await patchMarkering(m.id, patch.naam !== undefined ? { naam: patch.naam.trim() } : patch);
      await ververs();
    } catch (err) {
      toast.error("Opslaan mislukt: " + (err instanceof Error ? err.message : String(err)));
      await ververs();
    }
  }

  async function gooiWeg(m: MarkeringRij) {
    const ja = await bevestig({
      titel: `Kleur "${m.naam}" weggooien?`,
      tekst:
        "De adressen die hem hadden blijven staan, maar kleuren niet meer. Maak je hem opnieuw, dan is dat een nieuwe kleur — de oude adressen krijgen hem niet vanzelf terug.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await verwijderMarkering(m.id);
      await ververs();
    } catch (err) {
      toast.error("Weggooien mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div>
      <Kaart
        titel="Kleuren op de printlijst"
        uitleg="Wat je hier maakt staat onder de rechtermuisknop op een adres, en kleurt de regel in de lijst én op papier."
      >
        <div className="space-y-3">
          {markeringen.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nog geen kleuren. Maak er hieronder een.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-[18px] border border-border bg-card shadow-card">
              {markeringen.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <KleurKeuze waarde={m.tint} onKies={(tint) => void pas(m, { tint })} />
                  <Input
                    className="h-8 flex-1"
                    defaultValue={m.naam}
                    aria-label={`Naam van de kleur ${m.naam}`}
                    onBlur={(e) => void pas(m, { naam: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                    onClick={() => void gooiWeg(m)}
                    aria-label={`Kleur ${m.naam} weggooien`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void voegToe();
            }}
          >
            <KleurKeuze waarde={nieuweTint} onKies={setNieuweTint} />
            <Input
              className="h-8 flex-1"
              placeholder="Waar deze kleur voor staat"
              value={nieuweNaam}
              onChange={(e) => setNieuweNaam(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={bezig || !nieuweNaam.trim()}>
              <Plus className="size-4" /> Toevoegen
            </Button>
          </form>
        </div>
      </Kaart>
    </div>
  );
}

/** De vier kleuren naast elkaar; de gekozene heeft een randje. */
function KleurKeuze({ waarde, onKies }: { waarde: Tint; onKies: (t: Tint) => void }) {
  return (
    <div className="flex w-[92px] shrink-0 flex-wrap items-center gap-1">
      {TINTEN.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onKies(t)}
          title={tintNamen[t]}
          aria-label={tintNamen[t]}
          aria-pressed={waarde === t}
          className={`size-5 rounded-full ring-1 ring-inset ${tintStip[t]} ${
            waarde === t ? "outline outline-2 outline-offset-1 outline-primary" : ""
          }`}
        />
      ))}
    </div>
  );
}

function NotitiesTab() {
  const [notities, setNotities] = useState<QuickNote[]>([]);
  const [laden, setLaden] = useState(true);
  const [nieuw, setNieuw] = useState("");
  const [bezig, setBezig] = useState(false);
  const bevestig = useBevestig();

  async function herlaad() {
    try {
      setNotities(await fetchQuickNotes());
    } catch (err) {
      toast.error(
        "Snelkeuzes laden mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
    setLaden(false);
  }

  useEffect(() => {
    void herlaad();
  }, []);

  async function voegToe() {
    const label = nieuw.trim();
    if (!label) return;
    setBezig(true);
    try {
      await addQuickNote(label);
      setNieuw("");
      await herlaad();
    } catch (err) {
      toast.error("Toevoegen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setBezig(false);
  }

  async function gooiWeg(q: QuickNote) {
    const ja = await bevestig({
      titel: `Snelkeuze "${q.label}" weggooien?`,
      tekst: "Notities waar hij al in staat blijven gewoon staan; alleen het knopje verdwijnt.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await deleteQuickNote(q.id);
      await herlaad();
    } catch (err) {
      toast.error("Weggooien mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function zetOmschrijving(id: string, omschrijving: string) {
    setNotities((prev) => prev.map((q) => (q.id === id ? { ...q, omschrijving } : q)));
  }

  async function bewaarOmschrijving(q: QuickNote) {
    try {
      await updateQuickNoteOmschrijving(q.id, q.omschrijving);
    } catch (err) {
      toast.error(
        "Betekenis opslaan mislukt: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  if (laden) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div>
      <Kaart
        titel="Snelkeuzes voor notities"
        uitleg="De knopjes onder het notitieveld, zoals H, T of HD. Nieuwe maak je ook daar aan; weggooien kan alleen hier."
      >
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Vul bij elke snelkeuze de betekenis in — daarmee herkent Paaltje een code in een
            notitie.
          </p>
          {notities.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nog geen snelkeuzes. Voeg er hieronder een toe, of maak ze aan terwijl je een notitie
              bewerkt.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-[18px] border border-border bg-card shadow-card">
              {notities.map((q) => (
                <li key={q.id} className="flex flex-col gap-1.5 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{q.label}</span>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      onClick={() => void gooiWeg(q)}
                      aria-label={`Snelkeuze ${q.label} weggooien`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <Input
                    value={q.omschrijving}
                    placeholder="bv. voorkant helemaal"
                    onChange={(e) => zetOmschrijving(q.id, e.target.value)}
                    onBlur={() => void bewaarOmschrijving(q)}
                    maxLength={300}
                    aria-label={`Betekenis van ${q.label}`}
                    className="h-8 text-[12.5px]"
                  />
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void voegToe();
            }}
          >
            <Input
              placeholder="Nieuwe snelkeuze, bijvoorbeeld VH"
              value={nieuw}
              onChange={(e) => setNieuw(e.target.value)}
            />
            <Button
              type="submit"
              disabled={bezig || !nieuw.trim()}
              className="shrink-0 rounded-full"
            >
              <Plus className="size-4" /> Toevoegen
            </Button>
          </form>
        </div>
      </Kaart>
    </div>
  );
}

/** Daglimiet instellen en zien hoeveel Paaltje de laatste tijd gebruikt is. */
function PaaltjeAssistentKaart() {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const companyId = employee?.company_id ?? "";
  const [daglimiet, setDaglimiet] = useState("");
  const [bezig, setBezig] = useState(false);

  const limiet = useQuery({
    queryKey: ["paaltje-daglimiet", companyId],
    queryFn: () => fetchPaaltjeDaglimiet(companyId),
    enabled: !!companyId,
  });
  const verbruik = useQuery({
    queryKey: ["paaltje-verbruik", companyId],
    queryFn: () => fetchPaaltjeVerbruik(7),
    enabled: !!companyId,
  });

  useEffect(() => {
    if (limiet.data !== undefined) setDaglimiet(String(limiet.data));
  }, [limiet.data]);

  async function bewaar() {
    const n = Number(daglimiet);
    if (!companyId || !Number.isFinite(n) || n < 0) return;
    setBezig(true);
    try {
      await bewaarPaaltjeDaglimiet(companyId, n);
      await qc.invalidateQueries({ queryKey: ["paaltje-daglimiet", companyId] });
      toast.success("Daglimiet opgeslagen.");
    } catch (err) {
      toast.error("Opslaan mislukt: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBezig(false);
    }
  }

  const dagen = verbruik.data ?? [];
  const vandaag = verbruikVandaag(dagen);
  const totaalBerichten = dagen.reduce((s, d) => s + d.berichten, 0);
  const totaalTokens = dagen.reduce((s, d) => s + d.invoer_tokens + d.uitvoer_tokens, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="paaltje-daglimiet" className="text-[12.5px]">
          Berichten per dag
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="paaltje-daglimiet"
            type="number"
            min={0}
            max={5000}
            value={daglimiet}
            onChange={(e) => setDaglimiet(e.target.value)}
            onBlur={() => void bewaar()}
            disabled={bezig || !limiet.isSuccess}
            className="max-w-[8rem]"
          />
          <span className="text-[12.5px] text-muted-foreground">berichten/dag</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Zit het bedrijf hierboven, dan antwoordt Paaltje de rest van de dag niet meer.
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium">Vandaag</p>
        <p className="text-[13px] text-muted-foreground">
          {vandaag.berichten} {vandaag.berichten === 1 ? "bericht" : "berichten"}
          {vandaag.invoer_tokens + vandaag.uitvoer_tokens > 0 &&
            ` · ${(vandaag.invoer_tokens + vandaag.uitvoer_tokens).toLocaleString("nl-NL")} tokens`}
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium">Laatste 7 dagen</p>
        {dagen.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nog niets gebruikt.</p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-[14px] border border-border">
            {dagen.map((d) => (
              <li
                key={d.dag}
                className="flex items-center justify-between px-3 py-1.5 text-[12.5px]"
              >
                <span>
                  {/* T12:00 erbij: anders leest de browser "d.dag" als UTC-middernacht,
                      en kan de datum in een westelijke tijdzone een dag terugvallen. */}
                  {new Date(`${d.dag}T12:00:00`).toLocaleDateString("nl-NL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <span className="text-muted-foreground">
                  {d.berichten} {d.berichten === 1 ? "bericht" : "berichten"} ·{" "}
                  {(d.invoer_tokens + d.uitvoer_tokens).toLocaleString("nl-NL")} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Totaal: {totaalBerichten} {totaalBerichten === 1 ? "bericht" : "berichten"},{" "}
          {totaalTokens.toLocaleString("nl-NL")} tokens.
        </p>
      </div>
    </div>
  );
}

// --- Weergave -------------------------------------------------------------

const THEMA_ICOON: Record<Thema, typeof Monitor> = {
  systeem: Monitor,
  licht: Sun,
  donker: Moon,
  "fel-licht": SunFel,
  "fel-donker": MoonFel,
  "zak-licht": Sun,
  "zak-donker": Moon,
};

/** Twee kleuren per thema, voor het vierkantje in de keuzelijst: de
 *  ondergrond en de kleur waar je het thema aan herkent. */
const THEMA_KLEUREN: Record<Thema, [grond: string, accent: string]> = {
  systeem: ["#f7f3ea", "#b5d4f4"],
  licht: ["#f7f3ea", "#b5d4f4"],
  donker: ["#26241f", "#185fa5"],
  "fel-licht": ["#f4f0e8", "#ff5b1f"],
  "fel-donker": ["#000000", "#ff5b1f"],
  "zak-licht": ["#f4f5f7", "#a9efc8"],
  "zak-donker": ["#0e1013", "#a9efc8"],
};

function ThemaVoorbeeld({ thema }: { thema: Thema }) {
  const [grond, accent] = THEMA_KLEUREN[thema];
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border"
      style={{ background: grond }}
    >
      <span className="size-2 rounded-full" style={{ background: accent }} />
    </span>
  );
}

/**
 * Het thema, in één keuzelijst. Bovenaan de drie families — crème, Fel en
 * Zakelijk — en per familie kies je licht of donker. Alleen crème kan met je
 * systeem meelopen; dat is de stand waarin de app 's avonds vanzelf donker
 * wordt. De keuze geldt op dit apparaat.
 */
function WeergaveKaart() {
  const [thema, setThema] = useState<Thema>("systeem");

  // Pas na het hydrateren inlezen: op de server bestaat localStorage niet,
  // en het themascript in de <head> heeft de klasse dan al gezet.
  useEffect(() => setThema(leesThema()), []);

  // Volgt de app het systeem, dan moet hij meebewegen als je dat 's avonds
  // omzet zonder de pagina te herladen.
  useEffect(() => {
    if (thema !== "systeem") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const luister = () => bewaarThema("systeem");
    media.addEventListener("change", luister);
    return () => media.removeEventListener("change", luister);
  }, [thema]);

  function kies(nieuw: Thema) {
    setThema(nieuw);
    bewaarThema(nieuw);
  }

  const familie = familieVan(thema);
  const HuidigIcoon = THEMA_ICOON[thema];

  return (
    <Kaart
      titel="Weergave"
      uitleg="Kies hoe de app eruitziet. Crème is warm papier met zwevende panelen, Fel zet felle kleurvlakken neer en Zakelijk is de rustige: koelgrijs met witte kaarten. De keuze geldt alleen op dit apparaat."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full max-w-xs items-center gap-2.5 rounded-[12px] border border-border bg-card px-3 py-2 text-left text-[13px] transition-colors hover:bg-accent zak:rounded-full"
          >
            <ThemaVoorbeeld thema={thema} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{familieLabels[familie]}</span>
              <span className="block text-[11.5px] text-muted-foreground">
                {keuzeLabels[thema]}
                {thema === "systeem" ? " — volgt je apparaat" : ""}
              </span>
            </span>
            <HuidigIcoon className="size-4 shrink-0 text-muted-foreground" />
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {(Object.keys(familieLabels) as ThemaFamilie[]).map((f, i) => (
            <div key={f}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="pb-1">
                <span className="block">{familieLabels[f]}</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {familieOmschrijving[f]}
                </span>
              </DropdownMenuLabel>
              {familieKeuzes[f].map((t) => {
                const Icoon = THEMA_ICOON[t];
                const aan = thema === t;
                return (
                  <DropdownMenuItem
                    key={t}
                    onSelect={() => kies(t)}
                    className="gap-2.5"
                    aria-current={aan ? "true" : undefined}
                  >
                    <ThemaVoorbeeld thema={t} />
                    <Icoon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{keuzeLabels[t]}</span>
                    {aan && <Check className="size-4 shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Kaart>
  );
}

// --- Aanmeldpagina -------------------------------------------------------

function AanmeldenTab({ isEigenaar }: { isEigenaar: boolean }) {
  const { data: aanmeldingen } = useQuery({
    queryKey: ["aanmeldingen"],
    queryFn: fetchAanmeldingen,
  });

  return (
    <div className="space-y-4">
      <Kaart
        titel="Aanmeldpagina"
        uitleg="Eén pagina waar je klanten zelf hun naam en telefoonnummer invullen. Deel de link of hang de QR-code op."
      >
        <AanmeldInstellingen isEigenaar={isEigenaar} />
      </Kaart>

      <Kaart titel="Laatst binnengekomen" uitleg="Zo zie je of de QR-code werkt.">
        {!aanmeldingen || aanmeldingen.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Er is nog niets ingevuld.</p>
        ) : (
          <ul className="divide-y divide-border text-[13px]">
            {aanmeldingen.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{a.naam || "Zonder naam"}</span>
                  <span className="ml-2 text-muted-foreground">{aanmeldAdres(a)}</span>
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
