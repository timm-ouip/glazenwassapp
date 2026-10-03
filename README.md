# Wooshy (glazenwassapp)

De app voor glazenwassers: klanten en adressen, de planning per wijk, de
geldloop voor wie contant betaalt en facturen voor wie overmaakt.

- **App:** React met TanStack Start en TanStack Query, gebouwd met Vite.
- **Database:** Supabase (Postgres met RLS, Edge Functions in Deno), in
  `supabase/`.
- **Online:** een Cloudflare Worker (`paaltjesystems`, zie `wrangler.jsonc`).

## Lokaal draaien

```sh
bun install
cp .env.example .env   # en vul de Supabase-gegevens in
bun run dev            # http://localhost:8080 (bun leest .env zelf in)
```

## Controleren

```sh
bunx tsc --noEmit
bun run lint
bun run build
```

De proeven voor de database staan in `supabase/tests/` en draaien als
postgres; elke proef rolt zichzelf terug.

## Uitrollen

- **App:** `bun run build`, daarna
  `bunx wrangler deploy -c .output/server/wrangler.json`.
- **Database:** `supabase db push`.
- **Edge Functions:** `supabase functions deploy <naam>`.
- Na een migratie de types opnieuw maken met `./scripts/types.sh` (zie
  `docs/types-opnieuw-genereren.md`).

Achtergrond en eerdere keuzes staan in `docs/`.
