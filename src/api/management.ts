/**
 * L'API de management, à travers le relais.
 *
 * C'est elle qui permet les deux choses que l'API de projet ne sait pas faire :
 * **créer un projet** et **exécuter du SQL**. Elle n'est jamais appelée
 * directement — `api.supabase.com` refuse le CORS à toute origine autre que
 * `supabase.com` — mais toujours via `?path=/v1/…` sur le relais
 * (`proxy/README.md`), qui est soit le serveur de développement, soit un Worker.
 *
 * Le jeton d'accès personnel (`sbp_…`) ouvre TOUT le compte, pas un projet :
 * plus sensible encore qu'une clé de service. Il suit la même règle — mémoire
 * seulement, masqué partout où il pourrait s'afficher.
 */

import {
  ApiError,
  sendWithRetry,
  toApiError,
  type RetryPolicy,
} from './http.ts';

export interface ManagementOptions {
  /** Base du relais : `/__supabase-management` en dev, l'URL du Worker sinon. */
  proxyBase: string;
  /** Jeton d'accès personnel Supabase. */
  token: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
}

export interface Organization {
  id?: string;
  slug: string;
  name: string;
}

export type ProjectStatus =
  | 'INACTIVE'
  | 'ACTIVE_HEALTHY'
  | 'ACTIVE_UNHEALTHY'
  | 'COMING_UP'
  | 'UNKNOWN'
  | 'GOING_DOWN'
  | 'INIT_FAILED'
  | 'REMOVED'
  | 'RESTORING'
  | 'UPGRADING'
  | 'PAUSING'
  | 'RESTORE_FAILED'
  | 'RESTARTING'
  | 'PAUSE_FAILED'
  | 'RESIZING';

export interface Project {
  ref: string;
  name: string;
  region: string;
  status: ProjectStatus;
  organization_slug?: string;
  created_at?: string;
}

export interface CreateProjectInput {
  name: string;
  organizationSlug: string;
  region: string;
  dbPass: string;
}

export interface ApiKey {
  api_key?: string;
  name: string;
  type?: string;
  prefix?: string;
}

/** Les régions publiées par l'API, avec un libellé lisible. */
export const REGIONS: { value: string; label: string }[] = [
  { value: 'eu-west-3', label: 'Europe (Paris)' },
  { value: 'eu-central-1', label: 'Europe (Francfort)' },
  { value: 'eu-central-2', label: 'Europe (Zurich)' },
  { value: 'eu-west-1', label: 'Europe (Irlande)' },
  { value: 'eu-west-2', label: 'Europe (Londres)' },
  { value: 'eu-north-1', label: 'Europe (Stockholm)' },
  { value: 'us-east-1', label: 'États-Unis (Virginie du Nord)' },
  { value: 'us-east-2', label: 'États-Unis (Ohio)' },
  { value: 'us-west-1', label: 'États-Unis (Californie du Nord)' },
  { value: 'us-west-2', label: 'États-Unis (Oregon)' },
  { value: 'ca-central-1', label: 'Canada (Centre)' },
  { value: 'sa-east-1', label: 'Amérique du Sud (São Paulo)' },
  { value: 'ap-south-1', label: 'Asie (Mumbai)' },
  { value: 'ap-southeast-1', label: 'Asie (Singapour)' },
  { value: 'ap-southeast-2', label: 'Asie (Sydney)' },
  { value: 'ap-northeast-1', label: 'Asie (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asie (Séoul)' },
  { value: 'ap-east-1', label: 'Asie (Hong Kong)' },
];

/** Statuts depuis lesquels un projet ne deviendra plus sain tout seul. */
const TERMINAL_FAILURES: ProjectStatus[] = [
  'INIT_FAILED',
  'REMOVED',
  'RESTORE_FAILED',
  'PAUSE_FAILED',
];

export class ManagementClient {
  private readonly proxyBase: string;
  private readonly token: string;
  private readonly policy: RetryPolicy;

  constructor(options: ManagementOptions) {
    this.proxyBase = options.proxyBase.replace(/\/+$/, '');
    this.token = options.token;
    this.policy = {
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      retries: options.retries ?? 2,
      // Une requête SQL de migration peut être longue ; deux minutes.
      timeoutMs: options.timeoutMs ?? 120_000,
    };
  }

  private url(path: string): string {
    return `${this.proxyBase}?path=${encodeURIComponent(path)}`;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const response = await sendWithRetry(
      this.url(path),
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? null : JSON.stringify(options.body),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      this.policy
    );
    if (!response.ok) throw await toApiError(response, path);
    const text = await response.text();
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }

  listOrganizations(signal?: AbortSignal): Promise<Organization[]> {
    return this.request<Organization[]>('/v1/organizations', {
      ...(signal ? { signal } : {}),
    });
  }

  listProjects(signal?: AbortSignal): Promise<Project[]> {
    return this.request<Project[]>('/v1/projects', {
      ...(signal ? { signal } : {}),
    });
  }

  getProject(ref: string, signal?: AbortSignal): Promise<Project> {
    return this.request<Project>(`/v1/projects/${ref}`, {
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Crée un projet. **Action facturable et irréversible depuis ici** : le relais
   * ne sait pas supprimer un projet, seulement en créer un. L'appelant doit
   * avoir demandé confirmation.
   */
  createProject(
    input: CreateProjectInput,
    signal?: AbortSignal
  ): Promise<Project> {
    return this.request<Project>('/v1/projects', {
      method: 'POST',
      body: {
        name: input.name,
        organization_slug: input.organizationSlug,
        region: input.region,
        db_pass: input.dbPass,
      },
      ...(signal ? { signal } : {}),
    });
  }

  listApiKeys(ref: string, signal?: AbortSignal): Promise<ApiKey[]> {
    return this.request<ApiKey[]>(`/v1/projects/${ref}/api-keys?reveal=true`, {
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Exécute du SQL. `readOnly` sert l'introspection de la source : le serveur
   * refuse alors toute écriture, ce qui rend le relevé de structure incapable
   * de modifier la base qu'il décrit.
   */
  runQuery<T = Record<string, unknown>>(
    ref: string,
    query: string,
    options: { readOnly?: boolean; signal?: AbortSignal } = {}
  ): Promise<T[]> {
    return this.request<T[]>(`/v1/projects/${ref}/database/query`, {
      method: 'POST',
      body: { query, read_only: options.readOnly ?? false },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
}

/**
 * Choisit la clé de service parmi celles du projet.
 *
 * Deux générations coexistent : la clé historique, un JWT reconnaissable à son
 * `name` (`service_role`), et la nouvelle, reconnaissable à son `type`
 * (`secret`, préfixe `sb_secret_`).
 *
 * **La clé historique passe d'abord**, et l'ordre inverse a été essayé : sur un
 * projet réellement créé par cette application, la connexion renseignée avec
 * une clé `sb_secret_…` ne fonctionnait pas. Le format nouveau n'est pas
 * accepté partout où l'ancien l'est — et l'outil parle à PostgREST et à l'API
 * Storage, pas seulement au portail. On prend donc celle qui marche, et la
 * nouvelle reste un repli pour les projets qui n'auraient plus que celle-là.
 */
export function pickServiceKey(keys: readonly ApiKey[]): string | undefined {
  const legacy = keys.find(key => key.name === 'service_role' && key.api_key);
  if (legacy?.api_key) return legacy.api_key;
  const secret = keys.find(key => key.type === 'secret' && key.api_key);
  return secret?.api_key;
}

export interface WaitOptions {
  /** Millisecondes entre deux sondes. */
  intervalMs?: number;
  /** Abandon au-delà. Un projet neuf est prêt en une à deux minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: ProjectStatus) => void;
  /** Injectable pour les tests : rend la main immédiatement. */
  wait?: (ms: number) => Promise<void>;
}

/** Attend qu'un projet neuf soit prêt à recevoir des requêtes. */
export async function waitForProject(
  client: ManagementClient,
  ref: string,
  options: WaitOptions = {}
): Promise<Project> {
  const interval = options.intervalMs ?? 5000;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  for (;;) {
    const project = await client.getProject(ref, options.signal);
    options.onStatus?.(project.status);
    if (project.status === 'ACTIVE_HEALTHY') return project;
    if (TERMINAL_FAILURES.includes(project.status)) {
      throw new ApiError(
        409,
        `/v1/projects/${ref}`,
        `Le projet est en état ${project.status} : il ne deviendra pas actif.`
      );
    }
    if (Date.now() >= deadline) {
      throw new ApiError(
        504,
        `/v1/projects/${ref}`,
        `Le projet est encore en état ${project.status} après le délai d'attente. Il finira sans doute de démarrer : rouvrez l'application dans quelques minutes.`
      );
    }
    await wait(interval);
  }
}
