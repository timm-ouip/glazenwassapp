/**
 * De bouwinstelling van de app.
 *
 * Tot oktober 2026 liep dit via @lovable.dev/vite-tanstack-config, een pakket
 * dat al deze plugins voor je aanzette (en daarnaast een paar dingen voor de
 * editor van Lovable). Hier staat nu met de hand wat daarvan voor deze app
 * telt; wat alleen voor de Lovable-editor was (het doorsturen van fouten naar
 * die editor, de bronverwijzingen voor aanklikken-en-bewerken) is weg.
 *
 * Uitrollen gaat zoals altijd: `bun run build`, daarna
 * `wrangler deploy -c .output/server/wrangler.json`.
 */
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => {
  // De VITE_-variabelen uit .env ook in de serverkant van de build zetten,
  // niet alleen in de browserkant.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  );

  return {
    define,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      // Eén React en één TanStack Query, ook als een pakket een eigen kopie
      // meebrengt: twee kopieën geven de vreemdste fouten.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Code onder een map "server" mag nooit in de browser belanden.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // De eigen serveringang src/server.ts (vangt fouten bij het renderen).
        server: { entry: "server" },
      }),
      // Alleen bij het bouwen: maakt er een Cloudflare Worker van in .output.
      ...(command === "build" ? [nitro({ defaultPreset: "cloudflare-module" })] : []),
      viteReact(),
    ],
  };
});
