import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Het team beheer je sinds de instellingenpagina op /instellingen?tab=team.
 * Dit adres blijft bestaan zodat oude bladwijzers en links blijven werken.
 */
export const Route = createFileRoute("/team")({
  beforeLoad: () => {
    throw redirect({ to: "/instellingen", search: { tab: "team" } });
  },
});
