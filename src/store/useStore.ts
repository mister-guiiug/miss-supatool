/**
 * L'état de l'application.
 *
 * Une décision structure tout le reste : **les clés ne sont jamais
 * persistées**. L'URL des projets, la sélection et les réglages survivent au
 * rechargement ; les clés de service, non — elles vivent en mémoire et
 * disparaissent avec l'onglet. Une clé `service_role` ouvre TOUTE la base sans
 * RLS ; la ranger dans `localStorage` en ferait une cible permanente pour le
 * premier script tiers ou la première extension, pour la seule économie d'un
 * copier-coller.
 *
 * L'avancement est agrégé hors de React et versé dans le store à intervalle
 * régulier : une copie de dix mille fichiers émet dix mille événements, et
 * autant de rendus figeraient l'écran qui doit justement montrer que ça avance.
 */

import { create } from 'zustand';
import type { DatabaseSchema } from '../core/schema.ts';
import type { CopyOptions, CopyPlan, SourceBucket } from '../core/plan.ts';
import { buildCopyPlan, DEFAULT_OPTIONS } from '../core/plan.ts';
import { checkConnection, isSameProject } from '../core/project.ts';
import { describeError } from '../core/errors.ts';
import { redact } from '../core/redact.ts';
import { ProjectClient } from '../api/http.ts';
import { fetchSchema } from '../api/postgrest.ts';
import { listBuckets } from '../api/storage.ts';
import { runCopy } from '../engine/runner.ts';
import type { CopyEvent, RunSummary } from '../engine/events.ts';

export interface Connection {
  url: string;
  key: string;
}

export type EntityStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface TableProgress {
  status: EntityStatus;
  read: number;
  written: number;
  estimated?: number;
  message?: string;
}

export interface BucketProgress {
  status: EntityStatus;
  objects: number;
  bytes: number;
  skipped: number;
  errors: number;
  message?: string;
}

export interface JournalLine {
  at: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** Le journal affiché est borné : au-delà, c'est le rapport qui fait foi. */
const JOURNAL_MAX = 300;

interface Persisted {
  sourceUrl: string;
  targetUrl: string;
  selectedTables: string[];
  selectedBuckets: string[];
  options: CopyOptions;
}

const STORAGE_KEY = 'miss-supatool-v1';

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<Persisted>)
      : {};
  } catch {
    return {};
  }
}

function savePersisted(state: AppState): void {
  try {
    const payload: Persisted = {
      sourceUrl: state.source.url,
      targetUrl: state.target.url,
      selectedTables: state.selectedTables,
      selectedBuckets: state.selectedBuckets,
      options: state.options,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Stockage plein ou refusé : l'app fonctionne, elle oublie seulement.
  }
}

export interface AppState {
  source: Connection;
  target: Connection;
  schemaName: string;
  countStrategy: 'exact' | 'estimated';

  analyzing: boolean;
  analysisError?: string;
  analyzedAt?: number;
  sourceSchema?: DatabaseSchema;
  targetSchema?: DatabaseSchema;
  sourceBuckets: SourceBucket[];
  targetBucketNames: string[];
  /** Le stockage a-t-il pu être interrogé ? (droits, service désactivé) */
  storageError?: string;

  selectedTables: string[];
  selectedBuckets: string[];
  options: CopyOptions;

  running: boolean;
  tableProgress: Record<string, TableProgress>;
  bucketProgress: Record<string, BucketProgress>;
  journal: JournalLine[];
  summary?: RunSummary;

  setConnection: (
    role: 'source' | 'target',
    patch: Partial<Connection>
  ) => void;
  setSchemaName: (schema: string) => void;
  setCountStrategy: (strategy: 'exact' | 'estimated') => void;
  setOptions: (patch: Partial<CopyOptions>) => void;
  toggleTable: (table: string) => void;
  setSelectedTables: (tables: string[]) => void;
  toggleBucket: (bucket: string) => void;
  setSelectedBuckets: (buckets: string[]) => void;
  analyze: () => Promise<void>;
  plan: () => CopyPlan | undefined;
  start: () => Promise<void>;
  abort: () => void;
  reset: () => void;
  forgetKeys: () => void;
}

let abortController: AbortController | undefined;

export function clientFor(
  connection: Connection,
  readOnly: boolean
): ProjectClient | undefined {
  const check = checkConnection(connection, readOnly ? 'source' : 'target');
  if (!check.ok || !check.normalized) return undefined;
  return new ProjectClient({
    base: check.normalized.base,
    key: check.normalized.key,
    readOnly,
  });
}

const persisted = loadPersisted();

export const useStore = create<AppState>()((set, get) => ({
  source: { url: persisted.sourceUrl ?? '', key: '' },
  target: { url: persisted.targetUrl ?? '', key: '' },
  schemaName: 'public',
  countStrategy: 'estimated',

  analyzing: false,
  sourceBuckets: [],
  targetBucketNames: [],

  selectedTables: persisted.selectedTables ?? [],
  selectedBuckets: persisted.selectedBuckets ?? [],
  options: { ...DEFAULT_OPTIONS, ...persisted.options },

  running: false,
  tableProgress: {},
  bucketProgress: {},
  journal: [],

  setConnection: (role, patch) => {
    set(
      state => ({ [role]: { ...state[role], ...patch } }) as Partial<AppState>
    );
    savePersisted(get());
  },

  setSchemaName: schemaName => set({ schemaName }),
  setCountStrategy: countStrategy => set({ countStrategy }),

  setOptions: patch => {
    set(state => ({ options: { ...state.options, ...patch } }));
    savePersisted(get());
  },

  toggleTable: table => {
    set(state => ({
      selectedTables: state.selectedTables.includes(table)
        ? state.selectedTables.filter(t => t !== table)
        : [...state.selectedTables, table],
    }));
    savePersisted(get());
  },

  setSelectedTables: selectedTables => {
    set({ selectedTables });
    savePersisted(get());
  },

  toggleBucket: bucket => {
    set(state => ({
      selectedBuckets: state.selectedBuckets.includes(bucket)
        ? state.selectedBuckets.filter(b => b !== bucket)
        : [...state.selectedBuckets, bucket],
    }));
    savePersisted(get());
  },

  setSelectedBuckets: selectedBuckets => {
    set({ selectedBuckets });
    savePersisted(get());
  },

  analyze: async () => {
    const state = get();
    if (isSameProject(state.source.url, state.target.url)) {
      set({
        analysisError:
          'Source et cible désignent le MÊME projet. Miss Supatool refuse de copier un projet sur lui-même.',
      });
      return;
    }
    const source = clientFor(state.source, true);
    const target = clientFor(state.target, false);
    if (!source || !target) {
      set({
        analysisError:
          'Renseignez une URL et une clé valides pour les deux projets.',
      });
      return;
    }

    set({ analyzing: true, analysisError: undefined, storageError: undefined });
    try {
      const [sourceSchema, targetSchema] = await Promise.all([
        fetchSchema(source, { schema: state.schemaName }),
        fetchSchema(target, { schema: state.schemaName }),
      ]);

      let sourceBuckets: SourceBucket[] = [];
      let targetBucketNames: string[] = [];
      let storageError: string | undefined;
      try {
        const [from, to] = await Promise.all([
          listBuckets(source),
          listBuckets(target),
        ]);
        sourceBuckets = from.map(b => ({
          name: b.name,
          isPublic: b.public,
          fileSizeLimit: b.file_size_limit ?? null,
          allowedMimeTypes: b.allowed_mime_types ?? null,
        }));
        targetBucketNames = to.map(b => b.name);
      } catch (error) {
        storageError = describeError(error);
      }

      // Sélection par défaut : ce qui existe des DEUX côtés. Proposer de
      // copier une table absente de la cible ne mènerait qu'à un échec.
      const targetNames = new Set(targetSchema.tables.map(t => t.name));
      const previous = new Set(get().selectedTables);
      const candidates = sourceSchema.tables
        .filter(t => t.insertable && targetNames.has(t.name))
        .map(t => t.name);
      const selectedTables =
        previous.size > 0
          ? candidates.filter(name => previous.has(name))
          : candidates;

      const previousBuckets = new Set(get().selectedBuckets);
      const bucketNames = sourceBuckets.map(b => b.name);
      const selectedBuckets =
        previousBuckets.size > 0
          ? bucketNames.filter(name => previousBuckets.has(name))
          : bucketNames;

      set({
        sourceSchema,
        targetSchema,
        sourceBuckets,
        targetBucketNames,
        selectedTables,
        selectedBuckets,
        analyzedAt: Date.now(),
        ...(storageError ? { storageError } : {}),
      });
      savePersisted(get());
    } catch (error) {
      set({ analysisError: describeError(error) });
    } finally {
      set({ analyzing: false });
    }
  },

  plan: () => {
    const state = get();
    if (!state.sourceSchema || !state.targetSchema) return undefined;
    return buildCopyPlan({
      sourceSchema: state.sourceSchema,
      targetSchema: state.targetSchema,
      selectedTables: state.selectedTables,
      sourceBuckets: state.sourceBuckets,
      selectedBuckets: state.selectedBuckets,
      targetBucketNames: state.targetBucketNames,
      options: state.options,
    });
  },

  start: async () => {
    const state = get();
    const plan = state.plan();
    if (!plan || state.running) return;
    const source = clientFor(state.source, true);
    const target = clientFor(state.target, false);
    if (!source || !target) return;

    abortController = new AbortController();
    const tableProgress: Record<string, TableProgress> = {};
    for (const table of plan.tables) {
      tableProgress[table.table] = { status: 'pending', read: 0, written: 0 };
    }
    const bucketProgress: Record<string, BucketProgress> = {};
    for (const bucket of plan.buckets) {
      bucketProgress[bucket.bucket] = {
        status: 'pending',
        objects: 0,
        bytes: 0,
        skipped: 0,
        errors: 0,
      };
    }
    set({
      running: true,
      summary: undefined,
      journal: [],
      tableProgress,
      bucketProgress,
    });

    // Accumulateurs hors React : le rendu suit à son rythme.
    const journal: JournalLine[] = [];
    let dirty = false;
    const log = (level: JournalLine['level'], text: string): void => {
      journal.push({ at: Date.now(), level, text: redact(text) });
      if (journal.length > JOURNAL_MAX) journal.shift();
      dirty = true;
    };

    const flush = (): void => {
      if (!dirty) return;
      dirty = false;
      set({
        tableProgress: { ...tableProgress },
        bucketProgress: { ...bucketProgress },
        journal: [...journal],
      });
    };
    const timer = setInterval(flush, 200);

    const emit = (event: CopyEvent): void => {
      switch (event.type) {
        case 'run-start':
          log(
            'info',
            event.dryRun
              ? 'Simulation : rien ne sera écrit dans le projet cible.'
              : 'Copie réelle démarrée.'
          );
          break;
        case 'table-start': {
          const entry = tableProgress[event.table];
          if (entry) {
            entry.status = 'running';
            if (event.estimated !== undefined)
              entry.estimated = event.estimated;
          }
          log('info', `Table ${event.table} — début.`);
          break;
        }
        case 'table-progress': {
          const entry = tableProgress[event.table];
          if (entry) {
            entry.read = event.read;
            entry.written = event.written;
          }
          dirty = true;
          break;
        }
        case 'table-done': {
          const entry = tableProgress[event.table];
          if (entry) {
            entry.status = 'done';
            entry.read = event.read;
            entry.written = event.written;
          }
          log(
            'info',
            `Table ${event.table} — ${event.read} ligne(s) lue(s), ${event.written} écrite(s).`
          );
          break;
        }
        case 'table-skipped': {
          const entry = tableProgress[event.table];
          if (entry) {
            entry.status = 'skipped';
            entry.message = event.reason;
          }
          log('warn', `Table ${event.table} ignorée — ${event.reason}.`);
          break;
        }
        case 'table-error': {
          const entry = tableProgress[event.table];
          if (entry) {
            entry.status = 'error';
            entry.message = event.message;
          }
          log('error', `Table ${event.table} — ${event.message}`);
          break;
        }
        case 'bucket-start': {
          const entry = bucketProgress[event.bucket];
          if (entry) entry.status = 'running';
          log('info', `Seau ${event.bucket} — début.`);
          break;
        }
        case 'bucket-created':
          log('info', `Seau ${event.bucket} créé dans le projet cible.`);
          break;
        case 'bucket-skipped': {
          const entry = bucketProgress[event.bucket];
          if (entry) {
            entry.status = 'skipped';
            entry.message = event.reason;
          }
          log('warn', `Seau ${event.bucket} ignoré — ${event.reason}.`);
          break;
        }
        case 'object-copied': {
          const entry = bucketProgress[event.bucket];
          if (entry) {
            entry.objects += 1;
            entry.bytes += event.bytes;
          }
          dirty = true;
          break;
        }
        case 'object-skipped': {
          const entry = bucketProgress[event.bucket];
          if (entry) entry.skipped += 1;
          dirty = true;
          break;
        }
        case 'object-error': {
          const entry = bucketProgress[event.bucket];
          if (entry) entry.errors += 1;
          log('error', `${event.bucket}/${event.path} — ${event.message}`);
          break;
        }
        case 'bucket-done': {
          const entry = bucketProgress[event.bucket];
          if (entry) entry.status = 'done';
          log(
            'info',
            `Seau ${event.bucket} — ${event.objects} fichier(s) copié(s).`
          );
          break;
        }
        case 'bucket-error': {
          const entry = bucketProgress[event.bucket];
          if (entry) {
            entry.status = 'error';
            entry.message = event.message;
          }
          log('error', `Seau ${event.bucket} — ${event.message}`);
          break;
        }
        case 'run-done':
          log(
            event.aborted ? 'warn' : 'info',
            event.aborted ? 'Arrêt demandé.' : 'Terminé.'
          );
          break;
      }
    };

    try {
      const summary = await runCopy({
        source,
        target,
        plan,
        sourceBuckets: state.sourceBuckets,
        schema: state.schemaName,
        countStrategy: state.countStrategy,
        signal: abortController.signal,
        emit,
      });
      set({ summary });
    } catch (error) {
      log('error', describeError(error));
    } finally {
      clearInterval(timer);
      dirty = true;
      flush();
      set({ running: false });
      abortController = undefined;
    }
  },

  abort: () => {
    abortController?.abort();
  },

  reset: () => {
    set({
      sourceSchema: undefined,
      targetSchema: undefined,
      sourceBuckets: [],
      targetBucketNames: [],
      selectedTables: [],
      selectedBuckets: [],
      analysisError: undefined,
      storageError: undefined,
      analyzedAt: undefined,
      summary: undefined,
      journal: [],
      tableProgress: {},
      bucketProgress: {},
    });
    savePersisted(get());
  },

  forgetKeys: () => {
    set(state => ({
      source: { ...state.source, key: '' },
      target: { ...state.target, key: '' },
    }));
  },
}));
