/**
 * Clés de cache TanStack Query — source unique pour invalidation.
 *
 * Les jetons et clés de service n'y figurent jamais en clair : seule une
 * empreinte courte distingue deux sessions, pour qu'un changement de jeton
 * invalide le cache sans l'exposer dans les outils de développement.
 */

/** Empreinte synchrone et non cryptographique — identité de cache seulement. */
export function tokenScope(secret: string): string {
  let hash = 5381;
  const value = secret.trim();
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export const queryKeys = {
  organizations: (scope: string) => ['organizations', scope] as const,
  analysis: (scope: {
    sourceUrl: string;
    targetUrl: string;
    schema: string;
    sourceKeyScope: string;
    targetKeyScope: string;
  }) => ['analysis', scope] as const,
} as const;
