import { describe, expect, it } from 'vitest';
import { ProjectClient } from '../api/http.ts';
import {
  DEFAULT_OPTIONS,
  type CopyPlan,
  type TablePlan,
} from '../core/plan.ts';
import { createFakeFetch, rows, type Handler } from '../test/fakeFetch.ts';
import { runCopy } from './runner.ts';
import type { CopyEvent } from './events.ts';

const SOURCE = 'https://source.supabase.co';
const TARGET = 'https://cible.supabase.co';

function tablePlan(table: string, columns = ['id', 'label']): TablePlan {
  return {
    table,
    columns,
    primaryKey: ['id'],
    orderBy: ['id'],
    strategy: 'keyset',
    mode: 'upsert',
    onConflict: 'id',
    warnings: [],
  };
}

function plan(
  tables: TablePlan[],
  overrides: Partial<CopyPlan> = {}
): CopyPlan {
  return {
    tables,
    buckets: [],
    order: {
      order: tables.map(t => t.table),
      cycles: [],
      selfReferencing: [],
      externalDependencies: [],
    },
    issues: [],
    options: { ...DEFAULT_OPTIONS, dryRun: false, pageSize: 100 },
    ...overrides,
  };
}

function build(handlers: Handler[]) {
  const fake = createFakeFetch(handlers);
  return {
    fake,
    source: new ProjectClient({
      base: SOURCE,
      key: 'k',
      readOnly: true,
      fetchImpl: fake.fetch,
      retries: 0,
    }),
    target: new ProjectClient({
      base: TARGET,
      key: 'k',
      fetchImpl: fake.fetch,
      retries: 0,
    }),
  };
}

const oneSmallPage: Handler = call =>
  call.url.startsWith(SOURCE) ? { body: rows(1, 2) } : { status: 201 };

describe('runCopy', () => {
  it('copie les tables dans l’ordre du plan et rend un bilan', async () => {
    const events: CopyEvent[] = [];
    const set = build([oneSmallPage]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('clients'), tablePlan('commandes')]),
      emit: e => events.push(e),
    });

    expect(summary.tables.map(t => t.table)).toEqual(['clients', 'commandes']);
    expect(summary.errorCount).toBe(0);
    expect(summary.aborted).toBe(false);

    const done = events
      .filter(e => e.type === 'table-done')
      .map(e => (e.type === 'table-done' ? e.table : ''));
    expect(done).toEqual(['clients', 'commandes']);
    expect(events[0]).toMatchObject({ type: 'run-start', dryRun: false });
    expect(events[events.length - 1]).toMatchObject({ type: 'run-done' });
  });

  it('écarte une table sans colonne commune sans la compter en erreur', async () => {
    const events: CopyEvent[] = [];
    const set = build([oneSmallPage]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('vide', []), tablePlan('clients')]),
      emit: e => events.push(e),
    });
    expect(summary.errorCount).toBe(0);
    expect(summary.tables[0]?.skipped).toBeDefined();
    expect(events.some(e => e.type === 'table-skipped')).toBe(true);
  });

  it('s’arrête à la première erreur quand on le lui demande', async () => {
    const events: CopyEvent[] = [];
    const set = build([
      call =>
        call.url.startsWith(TARGET)
          ? { status: 400, text: 'colonne inconnue' }
          : undefined,
      oneSmallPage,
    ]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('a'), tablePlan('b')], {
        options: { ...DEFAULT_OPTIONS, dryRun: false, stopOnError: true },
      }),
      emit: e => events.push(e),
    });
    expect(summary.tables).toHaveLength(1);
    expect(summary.tables[0]?.error).toContain('400');
    expect(summary.errorCount).toBe(1);
    // Les lignes lues avant l'échec sont rapportées : un bilan à zéro ferait
    // croire qu'une relance repart de rien.
    expect(summary.tables[0]?.read).toBe(2);
  });

  it("rapporte ce qui a été écrit avant l'échec, pas zéro", async () => {
    let posts = 0;
    const set = build([
      call => {
        if (!call.url.startsWith(TARGET)) return undefined;
        posts += 1;
        // Le premier lot passe, le second est refusé.
        return posts === 1 ? { status: 201 } : { status: 400, text: 'refus' };
      },
      call => (call.url.startsWith(SOURCE) ? { body: rows(1, 4) } : undefined),
    ]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('a')], {
        options: {
          ...DEFAULT_OPTIONS,
          dryRun: false,
          pageSize: 100,
          batchSize: 2,
        },
      }),
      emit: () => {},
    });
    expect(summary.tables[0]?.written).toBe(2);
    expect(summary.tables[0]?.read).toBe(4);
    expect(summary.tables[0]?.error).toContain('400');
  });

  it('poursuit et rapporte tout quand on ne lui demande pas de s’arrêter', async () => {
    const set = build([
      call =>
        call.url.startsWith(TARGET)
          ? { status: 400, text: 'refus' }
          : undefined,
      oneSmallPage,
    ]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('a'), tablePlan('b')], {
        options: { ...DEFAULT_OPTIONS, dryRun: false, stopOnError: false },
      }),
      emit: () => {},
    });
    expect(summary.tables).toHaveLength(2);
    expect(summary.errorCount).toBe(2);
  });

  it('s’interrompt proprement sur demande d’arrêt', async () => {
    const controller = new AbortController();
    const set = build([oneSmallPage]);
    const summary = await runCopy({
      source: set.source,
      target: set.target,
      plan: plan([tablePlan('a'), tablePlan('b')]),
      signal: controller.signal,
      emit: event => {
        if (event.type === 'table-done') controller.abort();
      },
    });
    expect(summary.aborted).toBe(true);
    expect(summary.tables).toHaveLength(1);
  });
});
