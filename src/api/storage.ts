/**
 * L'API Storage : seaux et objets.
 *
 * Deux particularités du protocole méritent d'être connues, parce qu'elles
 * dictent la forme du code :
 *
 * - lister est un **POST** (`/object/list/{seau}`), le filtre voyageant dans le
 *   corps. C'est la seule écriture apparente autorisée sur la source, et
 *   `core/guard.ts` la connaît nommément ;
 * - le listage n'est **pas récursif**. Il rend le contenu d'un « dossier », et
 *   les dossiers y apparaissent comme des entrées sans `id`. Le parcours
 *   complet est donc une descente, faite ici une fois pour toutes.
 */

import { ProjectClient, toApiError } from './http.ts';

const STORAGE = '/storage/v1';

export interface BucketDto {
  id: string;
  name: string;
  public: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
}

export interface StorageObject {
  /** Chemin complet dans le seau (`dossier/sous-dossier/fichier.png`). */
  path: string;
  size?: number;
  mimeType?: string;
  updatedAt?: string;
}

interface ListEntryDto {
  name?: unknown;
  id?: unknown;
  updated_at?: unknown;
  metadata?: unknown;
}

export async function listBuckets(
  client: ProjectClient,
  signal?: AbortSignal
): Promise<BucketDto[]> {
  const buckets = await client.requestJson<BucketDto[]>(`${STORAGE}/bucket`, {
    ...(signal ? { signal } : {}),
  });
  return Array.isArray(buckets) ? buckets : [];
}

export async function createBucket(
  client: ProjectClient,
  bucket: {
    name: string;
    isPublic: boolean;
    fileSizeLimit?: number | null;
    allowedMimeTypes?: string[] | null;
  },
  signal?: AbortSignal
): Promise<void> {
  const path = `${STORAGE}/bucket`;
  const response = await client.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: bucket.name,
      name: bucket.name,
      public: bucket.isPublic,
      file_size_limit: bucket.fileSizeLimit ?? null,
      allowed_mime_types: bucket.allowedMimeTypes ?? null,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await toApiError(response, path);
  await response.text();
}

function toEntry(raw: unknown): {
  name: string;
  isFolder: boolean;
  size?: number;
  mimeType?: string;
  updatedAt?: string;
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as ListEntryDto;
  if (typeof entry.name !== 'string' || entry.name === '') return null;
  // Un dossier n'a pas d'identifiant : c'est ainsi que l'API les distingue.
  const isFolder = entry.id === null || entry.id === undefined;
  const metadata =
    typeof entry.metadata === 'object' && entry.metadata !== null
      ? (entry.metadata as Record<string, unknown>)
      : undefined;
  const size = typeof metadata?.size === 'number' ? metadata.size : undefined;
  const mimeType =
    typeof metadata?.mimetype === 'string' ? metadata.mimetype : undefined;
  const updatedAt =
    typeof entry.updated_at === 'string' ? entry.updated_at : undefined;
  return {
    name: entry.name,
    isFolder,
    ...(size !== undefined ? { size } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

async function listFolder(
  client: ProjectClient,
  bucket: string,
  prefix: string,
  limit: number,
  offset: number,
  signal?: AbortSignal
): Promise<unknown[]> {
  const path = `${STORAGE}/object/list/${encodeURIComponent(bucket)}`;
  const entries = await client.requestJson<unknown[]>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prefix,
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    }),
    ...(signal ? { signal } : {}),
  });
  return Array.isArray(entries) ? entries : [];
}

export interface WalkOptions {
  /** Ne parcourir qu'une branche (`photos/2026/`). Vide : tout le seau. */
  prefix?: string;
  /** Entrées demandées par requête. */
  pageSize?: number;
  signal?: AbortSignal;
}

/**
 * Parcourt un seau en profondeur et rend les objets un par un.
 *
 * Générateur, et non tableau : un seau de cent mille fichiers ne tient pas en
 * mémoire, et l'écran d'avancement a besoin de compter au fil de l'eau plutôt
 * qu'après un long silence.
 */
export async function* walkObjects(
  client: ProjectClient,
  bucket: string,
  options: WalkOptions = {}
): AsyncGenerator<StorageObject> {
  const pageSize = options.pageSize ?? 100;
  const roots = [options.prefix ?? ''];

  while (roots.length > 0) {
    const prefix = roots.shift();
    if (prefix === undefined) break;

    let offset = 0;
    for (;;) {
      const entries = await listFolder(
        client,
        bucket,
        prefix,
        pageSize,
        offset,
        options.signal
      );
      if (entries.length === 0) break;

      for (const raw of entries) {
        const entry = toEntry(raw);
        if (!entry) continue;
        const full = prefix === '' ? entry.name : `${prefix}${entry.name}`;
        if (entry.isFolder) {
          roots.push(`${full}/`);
        } else {
          yield {
            path: full,
            ...(entry.size !== undefined ? { size: entry.size } : {}),
            ...(entry.mimeType !== undefined
              ? { mimeType: entry.mimeType }
              : {}),
            ...(entry.updatedAt !== undefined
              ? { updatedAt: entry.updatedAt }
              : {}),
          };
        }
      }

      if (entries.length < pageSize) break;
      offset += entries.length;
    }
  }
}

/** Encode un chemin d'objet segment par segment : les `/` restent des `/`. */
export function encodeObjectPath(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

export async function downloadObject(
  client: ProjectClient,
  bucket: string,
  objectPath: string,
  signal?: AbortSignal
): Promise<Blob> {
  const path = `${STORAGE}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
  const response = await client.request(path, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await toApiError(response, path);
  return response.blob();
}

export async function uploadObject(
  client: ProjectClient,
  bucket: string,
  objectPath: string,
  body: Blob,
  options: { upsert: boolean; contentType?: string; signal?: AbortSignal }
): Promise<void> {
  const path = `${STORAGE}/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
  const response = await client.request(path, {
    method: 'POST',
    headers: {
      'content-type':
        options.contentType || body.type || 'application/octet-stream',
      'cache-control': 'max-age=3600',
      'x-upsert': options.upsert ? 'true' : 'false',
    },
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await toApiError(response, path);
  await response.text();
}
