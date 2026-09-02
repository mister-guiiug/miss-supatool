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

/**
 * Les refus de l'API de management qui méritent mieux qu'une recopie.
 *
 * Celui des droits est le pire à recevoir tel quel : il arrive en anglais, il
 * renvoie à une page de documentation, et il ne dit pas ce qui, dans le
 * contexte de cette application, permettrait d'avancer. Or il y a une issue —
 * le SQL est téléchargeable et se colle dans l'éditeur du tableau de bord —
 * et c'est elle qu'il faut nommer.
 *
 * Le repérage se fait sur le TEXTE et non sur le type de l'erreur : `core` ne
 * connaît pas la couche réseau, et cette dépendance-là ne vaut pas d'être
 * inversée pour un message.
 */
const HINTS: { test: RegExp; message: string }[] = [
  {
    test: /necessary privileges to access this endpoint/i,
    message:
      "Ce jeton n'a pas le droit d'exécuter du SQL sur ce projet. Vérifiez votre rôle dans l'organisation qui le détient (il faut Owner ou Administrator ; Developer et Read-only ne suffisent pas), et que le jeton appartient bien à ce compte. À défaut : téléchargez le SQL ci-dessus et collez-le dans l'éditeur SQL du tableau de bord Supabase — le résultat est le même.",
  },
];

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
  const raw = redact(error instanceof Error ? error.message : String(error));
  return HINTS.find(hint => hint.test.test(raw))?.message ?? raw;
}

/**
 * Ce refus est-il un refus de DROITS ?
 *
 * La distinction commande le comportement : une instruction refusée pour une
 * raison SQL (une table qui manque, une dépendance pas encore là) mérite qu'on
 * continue et qu'on rejoue. Un refus de droits, lui, vaut pour toutes les
 * suivantes — les envoyer quand même, c'est répéter treize fois le même
 * message et doubler la note avec la seconde passe.
 */
export function isAuthorizationFailure(status: number): boolean {
  return status === 401 || status === 403;
}
