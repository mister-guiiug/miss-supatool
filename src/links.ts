import { repoUrl } from '@mister-guiiug/dev-pwa-config/apps-catalog';

/**
 * Règle famille : le code source et le soutien sont visibles sur le premier
 * écran ET sur les Réglages. Ici, les deux viennent du pied de page rendu dans
 * la coquille (`App.tsx`), hors des routes.
 *
 * LE LIEN DU DÉPÔT SE CALCULE. Une URL recopiée diverge sans que personne ne
 * le voie. LE LIEN DE SOUTIEN N'APPARAÎT PLUS ICI : `AppFooter` et
 * `FamilyApps` le prennent au catalogue, qui fait foi.
 */
export const APP_ID = 'miss-supatool';
export const REPO_URL = repoUrl(APP_ID);
