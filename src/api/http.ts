/**
 * Le transport : un client HTTP par projet.
 *
 * `fetch` est INJECTÉ. C'est ce qui permet aux tests d'éprouver la pagination,
 * les reprises et l'invariant de lecture seule sans réseau ni serveur factice,
 * et c'est aussi ce qui laisse la porte ouverte à un client instrumenté.
 *
 * Trois comportements valent d'être écrits ici plutôt que dans chaque appel :
 * le délai maximal (une requête qui ne revient jamais fige une copie), la
 * reprise sur 429/5xx avec respect de `Retry-After` (Supabase limite le débit,
 * et une copie est exactement le trafic qui déclenche cette limite), et le
 * masquage des clés dans les messages d'erreur.
 */

import { assertReadOnly } from '../core/guard.ts';
import { redact } from '../core/redact.ts';

export interface ProjectClientOptions {
  /** `https://abc.supabase.co`, sans barre finale. */
  base: string;
  key: string;
  /** Applique l'invariant de lecture seule (projet source). */
  readOnly?: boolean;
  fetchImpl?: typeof fetch;
  /** Tentatives supplémentaires après un échec reprenable. */
  retries?: number;
  timeoutMs?: number;
}

export class ApiError extends Error {
  status: number;
  path: string;
  details: string;

  constructor(status: number, path: string, details: string) {
    super(redact(`HTTP ${status} sur ${path} — ${details}`));
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.details = redact(details);
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function backoffDelay(attempt: number): number {
  // 400 ms, 800, 1600… plafonné à 8 s, avec une part aléatoire pour ne pas
  // faire repartir toutes les requêtes suspendues au même instant.
  const base = Math.min(400 * 2 ** attempt, 8000);
  return base + Math.random() * 250;
}

function retryAfterDelay(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Annulation demandée par l'utilisateur (bouton « Arrêter »). */
  signal?: AbortSignal;
  /** Ne pas reprendre : utile pour les sondes de connexion. */
  noRetry?: boolean;
}

export interface RetryPolicy {
  fetchImpl: typeof fetch;
  retries: number;
  timeoutMs: number;
}

/**
 * L'envoi, avec délai maximal et reprises — partagé par les deux clients (API
 * de projet et API de management). Extrait pour n'avoir qu'un seul endroit où
 * se trompe la politique de reprise.
 */
export async function sendWithRetry(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: BodyInit | null;
    signal?: AbortSignal;
  },
  policy: RetryPolicy,
  noRetry = false
): Promise<Response> {
  const attempts = noRetry ? 1 : policy.retries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new DOMException('Délai dépassé', 'TimeoutError'));
    }, policy.timeoutMs);
    const onAbort = (): void => {
      timeout.abort(init.signal?.reason);
    };
    init.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await policy.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body ?? null,
        signal: timeout.signal,
      });
      if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
        return response;
      }
      if (attempt === attempts - 1) return response;
      await sleep(retryAfterDelay(response) ?? backoffDelay(attempt));
    } catch (error) {
      // Une annulation VOULUE ne se reprend pas : elle remonte telle quelle.
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await sleep(backoffDelay(attempt));
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Échec de la requête');
}

export class ProjectClient {
  readonly base: string;
  private readonly key: string;
  private readonly readOnly: boolean;
  private readonly policy: RetryPolicy;

  constructor(options: ProjectClientOptions) {
    this.base = options.base.replace(/\/+$/, '');
    this.key = options.key;
    this.readOnly = options.readOnly ?? false;
    this.policy = {
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      retries: options.retries ?? 3,
      timeoutMs: options.timeoutMs ?? 60_000,
    };
  }

  /**
   * Une requête, reprises comprises. `path` commence par `/` et porte déjà sa
   * chaîne de recherche.
   */
  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const method = (options.method ?? 'GET').toUpperCase();
    if (this.readOnly) assertReadOnly(method, path);

    return sendWithRetry(
      `${this.base}${path}`,
      {
        method,
        headers: {
          apikey: this.key,
          authorization: `Bearer ${this.key}`,
          ...options.headers,
        },
        body: options.body ?? null,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      this.policy,
      options.noRetry ?? false
    );
  }

  /** Requête attendue en JSON ; lève `ApiError` sur réponse non 2xx. */
  async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(path, options);
    if (!response.ok) throw await toApiError(response, path);
    const text = await response.text();
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }
}

export async function toApiError(
  response: Response,
  path: string
): Promise<ApiError> {
  let details = response.statusText;
  try {
    const text = await response.text();
    if (text !== '') details = text.slice(0, 600);
  } catch {
    // Corps illisible : le statut suffit.
  }
  return new ApiError(response.status, path, details);
}
