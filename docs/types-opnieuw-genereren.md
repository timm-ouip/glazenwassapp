# De Supabase-types opnieuw genereren

```bash
./scripts/types.sh
```

Niet met de hand `supabase gen types` draaien: de generator is in een nieuwere
CLI-versie strenger geworden dan hoe deze app geschreven is, en het script zet
drie dingen terug die anders een regen typefouten geven in bestanden die prima
werken.

1. **`company_id` is optioneel bij een insert.** De trigger `set_company_id`
   vult hem, dus de app stuurt hem niet mee.
2. **Een optioneel functieargument mag `null` zijn.** De oude generator schreef
   `wijken?: string[] | null`, de nieuwe laat `| null` weg.
3. **`ploeg` mag leeg zijn** bij `dag_afmelden` en `dag_heropenen`: een dag
   zonder teams heeft geen ploegnummer.

Controleer na afloop met `bunx tsc --noEmit` dat het schoon is.

Let op: de `types.ts` die tot 12-10-2026 in de repo stond liep twaalf tabellen
achter (de hele geldloop ontbrak). Genereren is dus geen formaliteit.
