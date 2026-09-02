/**
 * Où trouver le relais, et faut-il l'annoncer indisponible.
 *
 * En développement, le serveur Vite relaie lui-même (`vite.config.ts`) : rien à
 * déployer pour essayer. En production, il faut l'URL d'un Worker, posée au
 * build par `VITE_SUPABASE_PROXY`. Sans elle, la création de projet et la copie
 * de structure sont indisponibles — et le disent, plutôt que d'échouer sur une
 * erreur CORS incompréhensible au premier clic.
 */

const configured = (import.meta.env.VITE_SUPABASE_PROXY ?? '').trim();

/** Base d'appel du relais, ou chaîne vide s'il n'y en a pas. */
export const PROXY_BASE: string =
  configured !== ''
    ? configured.replace(/\/+$/, '')
    : import.meta.env.DEV
      ? '/__supabase-management'
      : '';

/** L'API de management est-elle joignable depuis cette page ? */
export const MANAGEMENT_AVAILABLE: boolean = PROXY_BASE !== '';
