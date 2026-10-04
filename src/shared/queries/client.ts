import { QueryClient } from '@tanstack/react-query';

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        // Pas de refetch au focus : une analyse ou une liste d'organisations
        // n'est pas un flux temps réel, et un retour d'onglet ne doit pas
        // relancer des appels munis d'un jeton d'accès personnel.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  });
}

let client: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  client ??= createAppQueryClient();
  return client;
}
