/**
 * Les quatre appels PostgREST dont la copie a besoin : décrire, compter, lire
 * une page, écrire un lot.
 *
 * Rien ici ne décide : les colonnes, l'ordre, la taille des pages et le mode
 * d'écriture viennent du plan (`core/plan.ts`). Ce fichier ne fait que parler
 * le protocole — en-têtes `Prefer`, `Content-Range`, `on_conflict` — et il est
 * le seul à le connaître.
 */

import type { DatabaseSchema } from '../core/schema.ts';
import { parseOpenApiSchema } from '../core/schema.ts';
import { buildSelectQuery, parseContentRange } from '../core/paging.ts';
import type { PageCursor } from '../core/paging.ts';
import { ProjectClient, toApiError } from './http.ts';

const REST = '/rest/v1';

/** En-têtes de sélection de schéma Postgres (défaut : `public`). */
function schemaHeaders(schema: string, write: boolean): Record<string, string> {
  if (schema === 'public') return {};
  return write ? { 'content-profile': schema } : { 'accept-profile': schema };
}

export async function fetchOpenApiDocument(
  client: ProjectClient,
  options: { schema?: string; signal?: AbortSignal } = {}
): Promise<unknown> {
  const schema = options.schema ?? 'public';
  return client.requestJson<unknown>(`${REST}/`, {
    headers: {
      accept: 'application/openapi+json',
      ...schemaHeaders(schema, false),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function fetchSchema(
  client: ProjectClient,
  options: { schema?: string; signal?: AbortSignal } = {}
): Promise<DatabaseSchema> {
  return parseOpenApiSchema(await fetchOpenApiDocument(client, options));
}

export type CountStrategy = 'exact' | 'estimated';

/**
 * Nombre de lignes. `estimated` interroge le planificateur : instantané sur une
 * grosse table, approximatif sur une petite — PostgREST bascule alors de
 * lui-même sur un compte exact. `exact` compte vraiment, et peut prendre des
 * dizaines de secondes sur plusieurs millions de lignes.
 */
export async function countRows(
  client: ProjectClient,
  table: string,
  options: {
    strategy?: CountStrategy;
    schema?: string;
    signal?: AbortSignal;
  } = {}
): Promise<number | undefined> {
  const strategy = options.strategy ?? 'estimated';
  const path = `${REST}/${encodeURIComponent(table)}?select=*&limit=1`;
  const response = await client.request(path, {
    headers: {
      prefer: `count=${strategy}`,
      ...schemaHeaders(options.schema ?? 'public', false),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await toApiError(response, path);
  // Le corps n'intéresse personne, mais le laisser non lu retient la connexion.
  await response.text();
  return parseContentRange(response.headers.get('content-range'));
}

export interface ReadPageOptions {
  columns: readonly string[];
  orderBy: readonly string[];
  limit: number;
  offset?: number;
  after?: PageCursor;
  schema?: string;
  signal?: AbortSignal;
}

export async function readPage(
  client: ProjectClient,
  table: string,
  options: ReadPageOptions
): Promise<Record<string, unknown>[]> {
  const query = buildSelectQuery({
    columns: options.columns,
    orderBy: options.orderBy,
    limit: options.limit,
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.after ? { after: options.after } : {}),
  });
  const path = `${REST}/${encodeURIComponent(table)}?${query}`;
  const rows = await client.requestJson<Record<string, unknown>[]>(path, {
    headers: schemaHeaders(options.schema ?? 'public', false),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return Array.isArray(rows) ? rows : [];
}

export interface WriteRowsOptions {
  /** `merge-duplicates` remplace une ligne existante ; sinon un doublon est un 409. */
  mode: 'insert' | 'upsert';
  /** Colonnes de la contrainte de conflit, séparées par des virgules. */
  onConflict?: string;
  schema?: string;
  signal?: AbortSignal;
}

export async function writeRows(
  client: ProjectClient,
  table: string,
  rows: readonly Record<string, unknown>[],
  options: WriteRowsOptions
): Promise<void> {
  if (rows.length === 0) return;

  const params = new URLSearchParams();
  if (options.mode === 'upsert' && options.onConflict) {
    params.set('on_conflict', options.onConflict);
  }
  const query = params.toString();
  const path = `${REST}/${encodeURIComponent(table)}${query ? `?${query}` : ''}`;

  const prefer = ['return=minimal'];
  if (options.mode === 'upsert') prefer.push('resolution=merge-duplicates');

  const response = await client.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: prefer.join(','),
      ...schemaHeaders(options.schema ?? 'public', true),
    },
    body: JSON.stringify(rows),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await toApiError(response, path);
  await response.text();
}
