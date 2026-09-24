import { Pillen } from "@/components/Pillen";
import type { Geldkeuze } from "@/lib/geldfilter";

/** De drie pillen boven een scherm met bedragen. */
export function GeldfilterPillen({
  keuze,
  onChange,
}: {
  keuze: Geldkeuze;
  onChange: (k: Geldkeuze) => void;
}) {
  return (
    <Pillen
      keuzes={[
        { waarde: "allebei" as const, label: "Allebei" },
        { waarde: "contant" as const, label: "Contant" },
        { waarde: "overmaken" as const, label: "Overmaken" },
      ]}
      waarde={keuze}
      onChange={onChange}
      label="Contant of overmaken"
    />
  );
}
