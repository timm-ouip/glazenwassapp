import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Een minuut lang is wat er al is goed genoeg. Zonder dit haalde elke
        // paginawissel en elke terugkeer in de app alle adressen opnieuw op
        // (bijna 2 MB), en dat maakte de app op de telefoon traag. Terugkomen
        // in de app ververst nog steeds, maar alleen als het ouder is.
        staleTime: 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
