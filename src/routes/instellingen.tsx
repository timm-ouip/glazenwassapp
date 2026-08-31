import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, KeyRound, Mail, Trash2, User, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { requireSession, useAuth, useRequireAuth, type Rol } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchTeam,
  inviteEmployee,
  removeEmployee,
  updateEmployeeRole,
  updateMyProfile,
} from "@/lib/team.functions";
import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABBLADEN = ["bedrijf", "account", "team"] as const;
type Tab = (typeof TABBLADEN)[number];

interface InstellingenSearch {
  tab: Tab;
}

export const Route = createFileRoute("/instellingen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): InstellingenSearch => {
    const tab = String(search["tab"] ?? "");
    return { tab: (TABBLADEN as readonly string[]).includes(tab) ? (tab as Tab) : "bedrijf" };
  },
  head: () => ({ meta: [{ title: "Instellingen — Klantenlijst glazenwasser" }] }),
  component: Instellingen,
});

function Instellingen() {
  useRequireAuth();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";

  return (
    <AppLayout
      titel="Instellingen"
      kruimel="Beheer / Instellingen"
      onderschrift="Je bedrijf, je eigen account en wie er met je meewerkt."
    >
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({ to: "/instellingen", search: { tab: v as Tab }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="bedrijf">Bedrijf</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="bedrijf" className="mt-4">
          <BedrijfTab isEigenaar={isEigenaar} />
        </TabsContent>
        <TabsContent value="account" className="mt-4">
          <AccountTab />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamTab />
        </TabsContent>
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
    <section className="rounded-[14px] border border-border bg-card p-4">
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
  ...rest
}: {
  id: string;
  label: string;
  waarde: string;
  onChange: (v: string) => void;
  lezen: boolean;
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

type Collega = { id: string; naam: string; email: string; rol: string; created_at: string };

function TeamTab() {
  const { employee } = useAuth();
  const [laden, setLaden] = useState(true);
  const [rol, setRol] = useState<string | null>(null);
  const [collegas, setCollegas] = useState<Collega[]>([]);
  const [nieuweEmail, setNieuweEmail] = useState("");
  const [uitnodigen, setUitnodigen] = useState(false);
  const bevestig = useBevestig();

  async function herlaad() {
    setLaden(true);
    try {
      const data = await fetchTeam();
      setRol(data.rol);
      setCollegas(data.collegas as Collega[]);
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

  async function nodigUit() {
    if (!nieuweEmail.trim()) {
      toast.error("Vul een e-mailadres in.");
      return;
    }
    setUitnodigen(true);
    try {
      await inviteEmployee({ data: { email: nieuweEmail.trim() } });
      toast.success("Uitnodiging verstuurd");
      setNieuweEmail("");
    } catch (err) {
      toast.error("Uitnodigen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
    setUitnodigen(false);
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
      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-card-header text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Naam</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Rol</th>
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
                        className="rounded-md border border-border bg-card px-2 py-1 text-[13px] disabled:cursor-not-allowed disabled:text-muted-foreground"
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

      {isEigenaar ? (
        <Kaart
          titel="Medewerker uitnodigen"
          uitleg="Hij krijgt een mail om een wachtwoord te kiezen en komt daarna in dit team."
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
