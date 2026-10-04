import { getQueryClient } from './client.ts';

/** Après une mutation management : rafraîchir les organisations. */
export function invalidateOrganizations(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['organizations'] });
}

/** Après une mutation de structure : le schéma cible a changé. */
export function invalidateAnalysis(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['analysis'] });
}
