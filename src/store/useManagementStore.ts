/**
 * L'état du volet « management » : créer le projet cible, copier la structure.
 *
 * Un store distinct de celui de la copie de données, et ce n'est pas un détail
 * d'organisation : ce volet est **facultatif**. Il exige un relais déployé et
 * un jeton d'accès personnel, là où la copie de données ne demande que deux
 * clés de projet. Les garder séparés, c'est garantir que l'absence de l'un
 * n'empêche jamais l'autre — et que le code de la copie, éprouvé, n'est pas
 * remanié pour accueillir une fonctionnalité qu'il n'utilise pas.
 *
 * Le jeton d'accès personnel (`sbp_…`) ouvre TOUT le compte. Comme les clés de
 * service, il n'est **jamais persisté** : mémoire seulement.
 */

import { create } from 'zustand';
import {
  ManagementClient,
  pickServiceKey,
  waitForProject,
  type Organization,
  type Project,
  type ProjectStatus,
} from '../api/management.ts';
import { MANAGEMENT_AVAILABLE, PROXY_BASE } from '../api/managementBase.ts';
import { describeError } from '../core/errors.ts';
import { normalizeProjectUrl } from '../core/project.ts';
import {
  buildStructureSql,
  PHASE_ORDER,
  sequenceResetSql,
  type Statement,
  type StructurePhase,
  type StructureRows,
} from '../core/structure.ts';
import {
  applyStatements,
  readStructure,
  type ApplyResult,
} from '../engine/structure.ts';
import { useStore } from './useStore.ts';

export interface CreateProjectDraft {
  name: string;
  organizationSlug: string;
  region: string;
  dbPass: string;
}

export interface ManagementState {
  available: boolean;
  token: string;

  organizations: Organization[];
  loadingOrganizations: boolean;
  organizationsError?: string;

  creating: boolean;
  creationStep?: string;
  creationError?: string;
  createdProject?: Project;

  reading: boolean;
  readProgress: { done: number; total: number };
  rows?: StructureRows;
  phases: StructurePhase[];
  structureError?: string;

  applying: boolean;
  applyProgress: { done: number; total: number; current?: string };
  results: ApplyResult[];
  /** Simulation : les instructions sont produites, aucune n'est envoyée. */
  dryRun: boolean;

  setToken: (token: string) => void;
  togglePhase: (phase: StructurePhase) => void;
  setDryRun: (dryRun: boolean) => void;
  loadOrganizations: () => Promise<void>;
  createProject: (draft: CreateProjectDraft) => Promise<void>;
  readSourceStructure: () => Promise<void>;
  statements: () => Statement[];
  applyStructure: () => Promise<void>;
  resetSequences: () => Promise<void>;
  abort: () => void;
  clear: () => void;
}

let abortController: AbortController | undefined;

/**
 * Référence de projet à partir d'une URL. `undefined` pour un domaine
 * personnalisé ou une instance auto-hébergée : l'API de management ne les
 * connaît pas, et l'appelant doit le dire plutôt que d'échouer en 404.
 */
export function refOf(url: string): string | undefined {
  return normalizeProjectUrl(url)?.ref;
}

function clientOrThrow(token: string): ManagementClient {
  if (!MANAGEMENT_AVAILABLE) {
    throw new Error(
      'Aucun relais configuré : la création de projet et la copie de structure sont indisponibles sur ce déploiement (voir proxy/README.md).'
    );
  }
  if (token.trim() === '') {
    throw new Error("Renseignez votre jeton d'accès personnel Supabase.");
  }
  return new ManagementClient({ proxyBase: PROXY_BASE, token: token.trim() });
}

export const useManagementStore = create<ManagementState>()((set, get) => ({
  available: MANAGEMENT_AVAILABLE,
  token: '',

  organizations: [],
  loadingOrganizations: false,

  creating: false,

  reading: false,
  readProgress: { done: 0, total: 0 },
  phases: [...PHASE_ORDER],

  applying: false,
  applyProgress: { done: 0, total: 0 },
  results: [],
  dryRun: true,

  setToken: token => set({ token, organizationsError: undefined }),

  setDryRun: dryRun => set({ dryRun }),

  togglePhase: phase =>
    set(state => ({
      phases: state.phases.includes(phase)
        ? state.phases.filter(p => p !== phase)
        : [...state.phases, phase],
    })),

  loadOrganizations: async () => {
    set({ loadingOrganizations: true, organizationsError: undefined });
    try {
      const client = clientOrThrow(get().token);
      const organizations = await client.listOrganizations();
      set({ organizations });
    } catch (error) {
      set({ organizationsError: describeError(error), organizations: [] });
    } finally {
      set({ loadingOrganizations: false });
    }
  },

  createProject: async draft => {
    set({ creating: true, creationError: undefined, creationStep: undefined });
    abortController = new AbortController();
    try {
      const client = clientOrThrow(get().token);
      set({ creationStep: 'Création du projet…' });
      const created = await client.createProject(
        {
          name: draft.name.trim(),
          organizationSlug: draft.organizationSlug,
          region: draft.region,
          dbPass: draft.dbPass,
        },
        abortController.signal
      );

      set({ createdProject: created, creationStep: 'Démarrage du projet…' });
      const ready = await waitForProject(client, created.ref, {
        signal: abortController.signal,
        onStatus: (status: ProjectStatus) =>
          set({ creationStep: `Démarrage du projet… (${status})` }),
      });

      set({ creationStep: 'Récupération de la clé de service…' });
      const keys = await client.listApiKeys(ready.ref, abortController.signal);
      const serviceKey = pickServiceKey(keys);

      // Le projet cible est branché tout seul : c'est le seul moment où
      // l'application connaît une clé sans que l'utilisateur l'ait collée.
      useStore.getState().setConnection('target', {
        url: `https://${ready.ref}.supabase.co`,
        ...(serviceKey ? { key: serviceKey } : {}),
      });

      set({
        createdProject: ready,
        creationStep: !serviceKey
          ? "Projet prêt. La clé de service n'a pas pu être lue : collez-la à la main."
          : serviceKey.startsWith('sb_secret_')
            ? 'Projet prêt. Ce projet n’expose qu’une clé « sb_secret_… » : si les appels échouent, remplacez-la par la clé service_role (Settings → API).'
            : 'Projet prêt, connexion cible renseignée.',
      });
    } catch (error) {
      set({ creationError: describeError(error), creationStep: undefined });
    } finally {
      set({ creating: false });
      abortController = undefined;
    }
  },

  readSourceStructure: async () => {
    const sourceRef = refOf(useStore.getState().source.url);
    if (!sourceRef) {
      set({
        structureError:
          "Le projet source n'est pas identifiable (domaine personnalisé ou instance auto-hébergée) : l'API de management ne peut pas le décrire.",
      });
      return;
    }
    set({
      reading: true,
      structureError: undefined,
      readProgress: { done: 0, total: 0 },
    });
    abortController = new AbortController();
    try {
      const client = clientOrThrow(get().token);
      const rows = await readStructure(client, sourceRef, {
        schema: useStore.getState().schemaName,
        signal: abortController.signal,
        onProgress: (done, total) => set({ readProgress: { done, total } }),
      });
      set({ rows, results: [] });
    } catch (error) {
      set({ structureError: describeError(error) });
    } finally {
      set({ reading: false });
      abortController = undefined;
    }
  },

  statements: () => {
    const { rows, phases } = get();
    if (!rows) return [];
    return buildStructureSql(rows, {
      schema: useStore.getState().schemaName,
      phases,
    });
  },

  applyStructure: async () => {
    const targetRef = refOf(useStore.getState().target.url);
    if (!targetRef) {
      set({
        structureError:
          "Le projet cible n'est pas identifiable : l'API de management ne peut pas y écrire.",
      });
      return;
    }
    const statements = get().statements();
    if (statements.length === 0) return;

    set({
      applying: true,
      structureError: undefined,
      results: [],
      applyProgress: { done: 0, total: statements.length },
    });
    abortController = new AbortController();
    try {
      const client = clientOrThrow(get().token);
      const results = await applyStatements(client, targetRef, statements, {
        signal: abortController.signal,
        dryRun: get().dryRun,
        onProgress: (done, total, current) =>
          set({ applyProgress: { done, total, current: current.object } }),
      });
      set({ results });
    } catch (error) {
      set({ structureError: describeError(error) });
    } finally {
      set({ applying: false });
      abortController = undefined;
    }
  },

  resetSequences: async () => {
    const targetRef = refOf(useStore.getState().target.url);
    if (!targetRef) {
      set({
        structureError:
          "Le projet cible n'est pas identifiable : impossible de remettre les séquences à niveau.",
      });
      return;
    }
    set({ applying: true, structureError: undefined });
    abortController = new AbortController();
    try {
      const client = clientOrThrow(get().token);
      let rows = get().rows;
      if (!rows) {
        // Les séquences se déduisent des colonnes : inutile d'exiger un relevé
        // complet pour cette seule opération.
        await get().readSourceStructure();
        rows = get().rows;
      }
      if (!rows) return;
      const statements = sequenceResetSql(
        rows.columns,
        useStore.getState().selectedTables
      );
      const results = await applyStatements(client, targetRef, statements, {
        signal: abortController.signal,
        secondPass: false,
        onProgress: (done, total, current) =>
          set({ applyProgress: { done, total, current: current.object } }),
      });
      set({ results });
    } catch (error) {
      set({ structureError: describeError(error) });
    } finally {
      set({ applying: false });
      abortController = undefined;
    }
  },

  abort: () => abortController?.abort(),

  clear: () =>
    set({
      rows: undefined,
      results: [],
      structureError: undefined,
      createdProject: undefined,
      creationError: undefined,
      creationStep: undefined,
      applyProgress: { done: 0, total: 0 },
      readProgress: { done: 0, total: 0 },
    }),
}));
