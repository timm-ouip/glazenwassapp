import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { requireSession, useRequireAuth } from "@/lib/auth";
import { fetchTeam, inviteEmployee, removeEmployee } from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Collega = { id: string; naam: string; email: string; rol: string; created_at: string };

export const Route = createFileRoute("/team")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({ meta: [{ title: "Team — Klantenlijst glazenwasser" }] }),
  component: TeamPagina,
});

function TeamPagina() {
  useRequireAuth();
  const [laden, setLaden] = useState(true);
  const [rol, setRol] = useState<string | null>(null);
  const [collegas, setCollegas] = useState<Collega[]>([]);
  const [nieuweEmail, setNieuweEmail] = useState("");
  const [uitnodigen, setUitnodigen] = useState(false);

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

  async function verwijder(c: Collega) {
    if (!confirm(`${c.naam || c.email} verwijderen uit het team?`)) return;
    try {
      await removeEmployee({ data: { employeeId: c.id } });
      toast.success("Medewerker verwijderd");
      void herlaad();
    } catch (err) {
      toast.error("Verwijderen mislukt: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1600px] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" asChild>
              <Link to="/">
                <ArrowLeft className="size-4" /> Terug
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-foreground">Team</h1>
              <p className="text-xs text-muted-foreground">Medewerkers van je bedrijf</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-4 px-5 py-6">
        {laden ? (
          <p className="text-sm text-muted-foreground">Laden…</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Naam</th>
                    <th className="px-3 py-2 font-medium">E-mail</th>
                    <th className="px-3 py-2 font-medium">Rol</th>
                    {rol === "eigenaar" && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {collegas.map((c) => (
                    <tr key={c.id} className="border-t border-border/60">
                      <td className="px-3 py-2">{c.naam || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.email}</td>
                      <td className="px-3 py-2 capitalize">{c.rol}</td>
                      {rol === "eigenaar" && (
                        <td className="px-3 py-2 text-right">
                          {c.rol !== "eigenaar" && (
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
                  ))}
                </tbody>
              </table>
            </div>

            {rol === "eigenaar" ? (
              <div className="max-w-sm rounded-lg border border-border bg-card p-4 shadow-card">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Medewerker uitnodigen</h2>
                <form
                  className="flex gap-2"
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
                  <Button type="submit" disabled={uitnodigen} className="shrink-0">
                    <UserPlus className="size-4" /> Uitnodigen
                  </Button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Alleen de eigenaar kan medewerkers uitnodigen of verwijderen.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
