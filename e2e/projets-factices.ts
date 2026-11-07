import type { Page } from '@playwright/test';

/**
 * DEUX PROJETS SUPABASE FICTIFS, servis par `page.route`.
 *
 * L'app n'a ni backend à elle ni mode démo : elle lit et écrit dans les
 * projets que l'utilisateur lui branche. Sans projet, tout ce qui suit
 * « Projets » est un écran vide. Pour exercer le cœur de l'outil — l'analyse
 * des deux schémas —, la suite simule au minimum ce que l'app lit :
 *
 * - `GET /rest/v1/` : le document OpenAPI de PostgREST, d'où l'app tire les
 *   tables, les colonnes, les clés primaires (`<pk/>`) et étrangères (`<fk/>`) ;
 * - `GET /storage/v1/bucket` : la liste des seaux.
 *
 * RIEN NE SORT DU NAVIGATEUR. Les deux adresses sont en `.invalid`, domaine
 * réservé qui ne se résout jamais (RFC 2606) : même si une route manquait, la
 * requête n'atteindrait personne. La CSP de l'app (`connect-src https:`) les
 * laisse passer, c'est la même porte que pour un vrai projet.
 *
 * AUCUNE CLÉ. `CLE_FACTICE` n'a la forme d'aucune clé Supabase (ni JWT, ni
 * `sb_secret_…`) : l'app la dit « non reconnue », l'accepte avec un
 * avertissement, et c'est tout ce dont la suite a besoin.
 */
export const SOURCE = 'https://source.e2e.invalid';
export const CIBLE = 'https://cible.e2e.invalid';
export const CLE_FACTICE = 'cle-factice-e2e';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-expose-headers': 'content-range',
};

const PK = 'Note:\nThis is a Primary Key<pk/>';

/** La forme exacte d'un document PostgREST, réduite à ce que l'app lit. */
function openApi(tables: readonly ('clients' | 'factures')[]) {
  const definitions: Record<string, unknown> = {};
  const paths: Record<string, unknown> = { '/': {} };
  if (tables.includes('clients')) {
    definitions.clients = {
      type: 'object',
      required: ['id', 'nom'],
      properties: {
        id: { description: PK, format: 'bigint', type: 'integer' },
        nom: { format: 'text', type: 'string' },
      },
    };
    paths['/clients'] = { get: {}, post: {}, patch: {}, delete: {} };
  }
  if (tables.includes('factures')) {
    definitions.factures = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { description: PK, format: 'bigint', type: 'integer' },
        client_id: {
          description:
            "Note:\nThis is a Foreign Key to `clients.id`.<fk table='clients' column='id'/>",
          format: 'bigint',
          type: 'integer',
        },
        montant: { format: 'numeric', type: 'number' },
      },
    };
    paths['/factures'] = { get: {}, post: {}, patch: {}, delete: {} };
  }
  return { swagger: '2.0', paths, definitions };
}

/**
 * La source porte `clients` et `factures`, la cible seulement `clients` : une
 * table à créer, de quoi rendre l'analyse parlante. Rend le journal des
 * appels reçus (`MÉTHODE hôte/chemin`), pour vérifier ce que l'app a demandé.
 */
export async function simulerDeuxProjets(page: Page): Promise<string[]> {
  const appels: string[] = [];
  await page.route(/\.e2e\.invalid\//, async route => {
    const requete = route.request();
    const url = new URL(requete.url());
    const methode = requete.method();
    appels.push(`${methode} ${url.host}${url.pathname}`);

    if (methode === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    if (methode === 'GET' && url.pathname === '/rest/v1/') {
      return json(
        openApi(
          url.host === new URL(SOURCE).host
            ? ['clients', 'factures']
            : ['clients']
        )
      );
    }
    if (methode === 'GET' && url.pathname === '/storage/v1/bucket') {
      return json([]);
    }
    // Tout le reste est hors du périmètre simulé : un 404 franc vaut mieux
    // qu'une réponse inventée que l'app prendrait pour vraie.
    return route.fulfill({
      status: 404,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hors simulation e2e' }),
    });
  });
  return appels;
}

/** Branche les deux projets fictifs par l'interface et lance l'analyse. */
export async function brancherEtAnalyser(page: Page): Promise<void> {
  // Les cartes sont des `<section>` sans nom accessible : on les désigne par
  // leur titre, comme un lecteur les distingue.
  const carte = (titre: string) =>
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: titre, exact: true }) });
  const source = carte('Projet source');
  const cible = carte('Projet cible');
  await source.getByLabel('URL du projet').fill(SOURCE);
  await source.getByLabel('Clé de service (service_role)').fill(CLE_FACTICE);
  await cible.getByLabel('URL du projet').fill(CIBLE);
  await cible.getByLabel('Clé de service (service_role)').fill(CLE_FACTICE);
  await page.getByRole('button', { name: 'Analyser les deux projets' }).click();
}
