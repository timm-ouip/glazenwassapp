/**
 * De klant zijn eigen gegevens laten invullen, vanuit het dossier.
 *
 * "Linkje voor de klant" maakt een geheim linkje naar /gegevens dat 7 dagen
 * werkt (tabel `klant_links`, alleen voor wie klanten mag bewerken). Daar
 * ziet de klant alleen zijn naam, telefoon en e-mail; de rest van het dossier
 * niet. Je kunt het delen (WhatsApp, mail) of de klant het op je eigen
 * telefoon laten invullen.
 *
 * Wat hij invult staat meteen in het dossier, en in de wijzigingslog met bron
 * 'klant'. Die regels staan hier geel, tot je op Klopt drukt. Ongedaan maken
 * is hetzelfde terugzetten als in de geschiedenis: het weigert als iemand het
 * intussen opnieuw aanpaste, en zet je het daar terug, dan is het hier weg.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { dossierLink } from "@/components/dossier/DossierVelden";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { korteDatum } from "@/lib/dossier";
import { fetchKlant, type Klant } from "@/lib/klanten";
import type { Dossier } from "@/lib/useDossier";
import { wijzigingenOngedaan } from "@/lib/wijzigingen";

const GELDIG_DAGEN = 7;

const VELD_NAAM: Record<string, string> = {
  naam: "naam",
  telefoon: "telefoon",
  telefoon2: "tweede telefoon",
  email: "e-mail",
  email2: "tweede e-mail",
};

/** 128 bits uit de browser zelf: niet te raden. */
function nieuweToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function linkVan(token: string) {
  return `${window.location.origin}/gegevens?t=${token}`;
}

export function KlantInvulLink({ d }: { d: Dossier }) {
  const qc = useQueryClient();
  const klantId = d.klantId;
  const mag = !d.alleenLezen;
  const [bezig, setBezig] = useState(false);
  const [open, setOpen] = useState(false);

  const link = useQuery({
    queryKey: ["klant_link", klantId],
    enabled: Boolean(klantId) && mag,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("klant_links")
        .select("token,geldig_tot,gezien_op,aantal")
        .eq("klant_id", klantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const token = link.data?.token ?? null;
  const tot = link.data?.geldig_tot ?? null;
  // Een linkje dat te vaak gebruikt is (de rem in de database) werkt niet meer.
  const loopt = Boolean(
    token && tot && Date.parse(tot) > Date.now() && (link.data?.aantal ?? 0) < 30,
  );
  const gezienOp = link.data?.gezien_op ?? null;

  // Wat de klant invulde en nog niet bekeken is. Alleen als er ooit een
  // linkje was: anders kan er niets van de klant zijn.
  const ingevuld = useQuery({
    queryKey: ["klant_ingevuld", klantId, gezienOp],
    enabled: Boolean(klantId) && mag && link.isSuccess && link.data !== null,
    queryFn: async () => {
      let q = supabase
        .from("wijzigingen")
        .select("id,veld,op")
        .eq("klant_id", klantId!)
        .eq("bron", "klant")
        .is("teruggedraaid_op", null)
        .order("op", { ascending: false });
      if (gezienOp) q = q.gt("op", gezienOp);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    // Loopt er een linkje, dan af en toe kijken: de klant kan het net op je
    // eigen telefoon of thuis hebben ingevuld terwijl het dossier openstaat.
    refetchInterval: loopt ? 15000 : false,
  });
  const regels = ingevuld.data ?? [];
  const laatste = regels[0]?.op ?? null;

  /** Deze ene klant vers in de klantenlijst zetten: het dossier leest daaruit,
   *  en die lijst ververst niet vanzelf als niemand anders hem gebruikt. */
  const verversKlant = useCallback(
    async (id: string) => {
      const vers = await fetchKlant(id).catch(() => null);
      if (!vers) return;
      const stand = qc.getQueryState<Klant[]>(["klanten"]);
      if (!stand?.data) return;
      qc.setQueryData<Klant[]>(
        ["klanten"],
        stand.data.map((k) => (k.id === id ? vers : k)),
        { updatedAt: stand.dataUpdatedAt },
      );
    },
    [qc],
  );

  // Nieuw ingevuld: de velden in het dossier ophalen, anders staat daar nog
  // de oude stand. Per klant opnieuw beginnen.
  const gezien = useRef<{ klant: string | null; op: string | null } | null>(null);
  useEffect(() => {
    if (!ingevuld.isSuccess) return;
    const vorig = gezien.current;
    if (vorig && klantId && vorig.klant === klantId && laatste && laatste !== vorig.op) {
      void verversKlant(klantId);
    }
    gezien.current = { klant: klantId, op: laatste };
  }, [ingevuld.isSuccess, laatste, klantId, verversKlant]);

  async function maakLink() {
    setBezig(true);
    try {
      const id = klantId ?? (await d.zorgVoorKlant());
      // Lukte het maken van de klant niet, dan zei zorgVoorKlant dat al.
      if (!id) return;
      // Een lopend linkje houden, met 7 dagen erbij; anders een nieuw. Eerst
      // de verse stand: het kan intussen opgebruikt of ingetrokken zijn.
      const vers = klantId ? (await link.refetch()).data : null;
      const versLoopt = Boolean(
        vers && Date.parse(vers.geldig_tot) > Date.now() && vers.aantal < 30,
      );
      const t = versLoopt && vers ? vers.token : nieuweToken();
      const geldigTot = new Date(Date.now() + GELDIG_DAGEN * 86_400_000).toISOString();
      const { error } = await supabase
        .from("klant_links")
        .upsert(
          { klant_id: id, token: t, geldig_tot: geldigTot, ...(versLoopt ? {} : { aantal: 0 }) },
          { onConflict: "klant_id" },
        );
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["klant_link", id] });
      setOpen(true);
    } catch (e) {
      toast.error("Linkje maken mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function intrekken() {
    if (!klantId) return;
    // Niet weggooien: gezien_op moet blijven, anders wordt alles weer geel.
    const { error } = await supabase
      .from("klant_links")
      .update({ geldig_tot: new Date().toISOString() })
      .eq("klant_id", klantId);
    if (error) {
      toast.error("Intrekken mislukt: " + error.message);
      return;
    }
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["klant_link", klantId] });
    toast.success("Het linkje werkt niet meer.");
  }

  /** Gezien tot en met de nieuwste die je nu ziet; wat later binnenkomt blijft geel. */
  async function klopt() {
    if (!klantId || !laatste) return;
    const { error } = await supabase
      .from("klant_links")
      .update({ gezien_op: laatste })
      .eq("klant_id", klantId);
    if (error) toast.error("Opslaan mislukt: " + error.message);
    void qc.invalidateQueries({ queryKey: ["klant_link", klantId] });
  }

  async function terug() {
    if (!klantId || regels.length === 0) return;
    try {
      await wijzigingenOngedaan(regels.map((r) => r.id));
      toast.success("Teruggezet naar wat er stond.");
    } catch (e) {
      toast.error((e as Error).message);
    }
    void qc.invalidateQueries({ queryKey: ["klant_ingevuld", klantId] });
    void qc.invalidateQueries({ queryKey: ["dossier-wijzigingen"] });
    void verversKlant(klantId);
  }

  async function kopieer() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(linkVan(token));
      toast.success("Linkje gekopieerd");
    } catch {
      toast.error("Kopiëren lukt hier niet; houd het linkje ingedrukt om het te kopiëren.");
    }
  }

  async function deel() {
    if (!token) return;
    try {
      await navigator.share({
        title: "Je gegevens",
        text: "Wil je hier je gegevens controleren en aanvullen?",
        url: linkVan(token),
      });
    } catch {
      // Gestopt door de gebruiker: niets aan de hand.
    }
  }

  if (!mag || (!klantId && !d.adres)) return null;

  const kanDelen = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const velden = [...new Set(regels.map((r) => VELD_NAAM[r.veld] ?? r.veld))].join(", ");

  return (
    <>
      {regels.length > 0 && laatste && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            Door de klant zelf ingevuld op {korteDatum(laatste)}: {velden}
          </span>
          <span className="flex shrink-0 gap-3">
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              onClick={() => void klopt()}
            >
              Klopt
            </button>
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              onClick={() => void terug()}
            >
              Ongedaan maken
            </button>
          </span>
        </p>
      )}
      <Popover open={open && loopt} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${dossierLink} self-start text-[13px]`}
            disabled={bezig}
            onClick={(e) => {
              // Eerst het linkje maken of verlengen; dan pas openklappen.
              e.preventDefault();
              if (open) setOpen(false);
              else void maakLink();
            }}
          >
            {bezig ? "Linkje maken…" : "Linkje voor de klant"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(340px,calc(100vw-32px))] space-y-3">
          <div>
            <div className="text-[14px] font-medium">Laat de klant zelf invullen</div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Hij ziet alleen naam, telefoon en e-mail, niets anders uit het dossier. Werkt tot{" "}
              {tot ? korteDatum(tot) : ""}.
            </p>
          </div>
          {token && (
            <>
              <input
                readOnly
                value={linkVan(token)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 w-full rounded-[10px] border border-border bg-background px-2.5 text-[12.5px]"
              />
              <div className="flex flex-wrap gap-2">
                {kanDelen && (
                  <button
                    type="button"
                    className="rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground"
                    onClick={() => void deel()}
                  >
                    Delen…
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium"
                  onClick={() => void kopieer()}
                >
                  Kopiëren
                </button>
                <a
                  href={linkVan(token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium"
                >
                  Hier invullen
                </a>
              </div>
            </>
          )}
          <button
            type="button"
            className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => void intrekken()}
          >
            Linkje intrekken
          </button>
        </PopoverContent>
      </Popover>
    </>
  );
}
