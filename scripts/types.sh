#!/usr/bin/env bash
# De Supabase-types opnieuw genereren.
#
# De generator is in een nieuwere CLI-versie strenger geworden dan hoe deze
# app geschreven is. Zonder de drie reparaties hieronder regent het typefouten
# in bestanden die prima werken. Zie docs/types-opnieuw-genereren.md.
set -euo pipefail
cd "$(dirname "$0")/.."

supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts

# Eerst opmaken, dan pas repareren: de reparaties hieronder zoeken op regels
# zoals prettier ze schrijft, niet zoals de generator ze uitspuugt.
bunx prettier --write src/integrations/supabase/types.ts >/dev/null

python3 - <<'PY'
import re, pathlib

p = pathlib.Path("src/integrations/supabase/types.ts")
s = p.read_text()

# 1. company_id wordt door de trigger set_company_id gevuld, dus de app
#    stuurt hem niet mee bij een insert.
uit, blok = [], None
for regel in s.split("\n"):
    m = re.match(r"^\s+(Row|Insert|Update|Relationships): ", regel)
    if m:
        blok = m.group(1)
    if blok == "Insert" and re.match(r"^\s+company_id: string;$", regel):
        regel = regel.replace("company_id: string;", "company_id?: string;")
    uit.append(regel)
s = "\n".join(uit)

# 2. Een optioneel functieargument mag null zijn; de oude generator schreef
#    dat er zelf bij.
def haakjes_eind(t, start):
    diepte = 0
    for i in range(start, len(t)):
        if t[i] == "{":
            diepte += 1
        elif t[i] == "}":
            diepte -= 1
            if diepte == 0:
                return i + 1
    return -1

stukken, i = [], 0
for m in re.finditer(r"Args: \{", s):
    if m.start() < i:
        continue
    eind = haakjes_eind(s, m.end() - 1)
    blok = s[m.start():eind]
    nieuw = re.sub(
        r"(\w+)\?: ([^;\n}]+)",
        lambda mm: mm.group(0) if "| null" in mm.group(2) else f"{mm.group(1)}?: {mm.group(2).rstrip()} | null",
        blok,
    )
    stukken.append(s[i:m.start()])
    stukken.append(nieuw)
    i = eind
stukken.append(s[i:])
s = "".join(stukken)

# 3. Een dag zonder teams heeft geen ploegnummer; de database vergelijkt met
#    "is not distinct from".
s = re.sub(r"ploeg: number(?! \| null)(?=[;\s}])", "ploeg: number | null", s)

p.write_text(s)
PY

bunx prettier --write src/integrations/supabase/types.ts >/dev/null
echo "types bijgewerkt — controleer met: bunx tsc --noEmit"
