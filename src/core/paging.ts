/**
 * Pagination des lectures.
 *
 * Deux stratégies, et le choix n'est pas cosmétique :
 *
 * - **Curseur** (`keyset`) quand la table a une clé primaire d'UNE colonne. On
 *   trie dessus et on redemande « ce qui vient après la dernière valeur lue ».
 *   Coût constant par page, et surtout : une ligne insérée pendant la copie ne
 *   décale rien.
 * - **Décalage** (`offset`) sinon. Postgres doit parcourir puis jeter les N
 *   premières lignes à chaque page — le coût croît avec la profondeur —, et
 *   toute écriture concurrente à la source décale la fenêtre, ce qui saute ou
 *   double des lignes. C'est un repli, pas un choix.
 */

export interface PageCursor {
  column: string;
  /** Dernière valeur lue, telle qu'elle sera renvoyée dans le filtre. */
  value: string;
}

export interface SelectPageOptions {
  columns: readonly string[];
  /** Colonnes de tri : la clé primaire, ou rien si la table n'en a pas. */
  orderBy: readonly string[];
  limit: number;
  offset?: number;
  after?: PageCursor;
}

/**
 * Protège la valeur d'un filtre PostgREST.
 *
 * `,` `.` `:` `(` `)` — et l'espace — sont lus par l'analyseur de PostgREST
 * avant d'atteindre Postgres : un horodatage ISO (`2026-09-02T10:00:00.123Z`)
 * ou un titre avec une virgule cassent le filtre s'ils ne sont pas entre
 * guillemets. Les identifiants simples (entiers, UUID) restent nus, où les
 * guillemets n'apportent rien.
 */
export function quoteFilterValue(value: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Construit la requête d'une page. Renvoie une chaîne de recherche déjà encodée
 * (`select=…&order=…`), à coller derrière `?`.
 */
export function buildSelectQuery(options: SelectPageOptions): string {
  const params = new URLSearchParams();
  params.set('select', options.columns.join(','));
  if (options.orderBy.length > 0) {
    params.set('order', options.orderBy.map(c => `${c}.asc`).join(','));
  }
  params.set('limit', String(options.limit));
  if (options.after) {
    // `gt.` sur la dernière valeur lue : la pagination ne dépend plus du
    // nombre de lignes déjà parcourues.
    params.set(
      options.after.column,
      `gt.${quoteFilterValue(options.after.value)}`
    );
  } else if (options.offset !== undefined && options.offset > 0) {
    params.set('offset', String(options.offset));
  }
  return params.toString();
}

export type PagingStrategy = 'keyset' | 'offset';

/** Le curseur exige une clé primaire d'une seule colonne. */
export function pagingStrategy(primaryKey: readonly string[]): PagingStrategy {
  return primaryKey.length === 1 ? 'keyset' : 'offset';
}

/**
 * Extrait le total d'un en-tête `Content-Range` (`0-999/12345`).
 * `*` signifie « inconnu » (PostgREST le renvoie sans `count=exact`).
 */
export function parseContentRange(header: string | null): number | undefined {
  if (!header) return undefined;
  const slash = header.lastIndexOf('/');
  if (slash === -1) return undefined;
  const total = header.slice(slash + 1).trim();
  if (total === '*' || total === '') return undefined;
  const parsed = Number.parseInt(total, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Découpe un tableau en lots de `size` (dernier lot éventuellement plus court). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError('La taille de lot doit être positive.');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Valeur du curseur pour la ligne suivante. `null` quand la colonne manque ou
 * vaut NULL : impossible de continuer au curseur, l'appelant retombe sur le
 * décalage plutôt que de boucler à l'infini sur la même page.
 */
export function cursorValue(
  row: Record<string, unknown>,
  column: string
): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}
