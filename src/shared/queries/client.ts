/**
 * Client Query — defaults PWA du socle (focus coupé, retry 1, stale 30 s).
 * Les jetons Management ne partent pas au simple retour d'onglet.
 */
export {
  getQueryClient,
  createQueryClient,
  resetQueryClient,
  PWA_QUERY_DEFAULTS,
} from '@mister-guiiug/dev-pwa-config/react/query-client';
