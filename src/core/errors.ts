/**
 * Traduire les pannes en phrases actionnables.
 *
 * Un `fetch` qui n'aboutit pas rend « Failed to fetch », et rien d'autre : le
 * navigateur refuse délibérément de dire s'il s'agit d'un DNS introuvable,
 * d'un refus CORS ou d'un blocage par extension, pour ne pas transformer la
 * page en scanner de réseau. Le message brut est donc un cul-de-sac pour
 * l'utilisateur — d'où cette reformulation, qui énumère les causes possibles
 * au lieu de les taire.
 */

import { redact } from './redact.ts';

export function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return "Délai dépassé : le projet n'a pas répondu à temps. Il est peut-être en pause (projet Free inactif).";
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Opération interrompue.';
  }
  if (error instanceof TypeError) {
    return "Projet injoignable. Vérifiez l'URL, que le projet n'est pas en pause, et qu'aucune extension ou pare-feu ne bloque la requête.";
  }
  return redact(error instanceof Error ? error.message : String(error));
}
