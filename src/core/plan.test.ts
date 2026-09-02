import { describe, expect, it } from 'vitest';
import {
  buildCopyPlan,
  copyableTables,
  DEFAULT_OPTIONS,
  planWarnings,
  type BuildPlanInput,
} from './plan.ts';
import type { DatabaseSchema, TableInfo } from './schema.ts';

function table(
  name: string,
  columns: string[],
  primaryKey: string[] = ['id'],
  fks: Record<string, string> = {}
): TableInfo {
  return {
    name,
    columns: columns.map(column => ({
      name: column,
      type: 'text',
      required: false,
      primaryKey: primaryKey.includes(column),
      ...(fks[column]
        ? { foreignKey: { table: fks[column], column: 'id' } }
        : {}),
    })),
    primaryKey,
    insertable: true,
  };
}

const schema = (...tables: TableInfo[]): DatabaseSchema => ({ tables });

function input(overrides: Partial<BuildPlanInput> = {}): BuildPlanInput {
  return {
    sourceSchema: schema(
      table('clients', ['id', 'email']),
      table('commandes', ['id', 'client_id'], ['id'], { client_id: 'clients' })
    ),
    targetSchema: schema(
      table('clients', ['id', 'email']),
      table('commandes', ['id', 'client_id'], ['id'], { client_id: 'clients' })
    ),
    selectedTables: ['clients', 'commandes'],
    sourceBuckets: [],
    selectedBuckets: [],
    targetBucketNames: [],
    options: DEFAULT_OPTIONS,
    ...overrides,
  };
}

describe('buildCopyPlan', () => {
  it('range les tables dans leur ordre d’exécution', () => {
    const plan = buildCopyPlan(input());
    expect(plan.tables.map(t => t.table)).toEqual(['clients', 'commandes']);
  });

  it('demande une mise à jour sur la clé primaire', () => {
    const plan = buildCopyPlan(input());
    expect(plan.tables[0]?.mode).toBe('upsert');
    expect(plan.tables[0]?.onConflict).toBe('id');
  });

  it('retombe sur l’insertion, en le disant, sans clé primaire', () => {
    const journal = table('journal', ['message'], []);
    const plan = buildCopyPlan(
      input({
        sourceSchema: schema(journal),
        targetSchema: schema(journal),
        selectedTables: ['journal'],
      })
    );
    expect(plan.tables[0]?.mode).toBe('insert');
    expect(plan.tables[0]?.onConflict).toBeUndefined();
    expect(planWarnings(plan).join(' ')).toMatch(/doublons/);
  });

  it("n'envoie que les colonnes présentes des deux côtés", () => {
    const plan = buildCopyPlan(
      input({
        sourceSchema: schema(table('clients', ['id', 'email', 'secret'])),
        targetSchema: schema(table('clients', ['id', 'email'])),
        selectedTables: ['clients'],
      })
    );
    expect(plan.tables[0]?.columns).toEqual(['id', 'email']);
    expect(plan.issues.map(i => i.code)).toContain('column-missing');
  });

  it('écarte du travail une table sans colonne commune', () => {
    const plan = buildCopyPlan(
      input({
        sourceSchema: schema(table('a', ['id'])),
        targetSchema: schema(),
        selectedTables: ['a'],
      })
    );
    expect(copyableTables(plan)).toEqual([]);
  });

  it('remonte les cycles et les dépendances hors sélection en avertissements', () => {
    const plan = buildCopyPlan(
      input({
        selectedTables: ['commandes'],
      })
    );
    expect(planWarnings(plan).join(' ')).toMatch(/clients/);
  });

  it('prévoit la création des seaux absents et signale les seaux publics', () => {
    const plan = buildCopyPlan(
      input({
        sourceBuckets: [
          { name: 'photos', isPublic: true },
          { name: 'factures', isPublic: false },
        ],
        selectedBuckets: ['photos', 'factures'],
        targetBucketNames: ['factures'],
      })
    );
    expect(plan.buckets.map(b => [b.bucket, b.willCreate])).toEqual([
      ['photos', true],
      ['factures', false],
    ]);
    expect(planWarnings(plan).join(' ')).toMatch(/PUBLIC/);
  });

  it('ignore le stockage quand il est décoché', () => {
    const plan = buildCopyPlan(
      input({
        sourceBuckets: [{ name: 'photos', isPublic: false }],
        selectedBuckets: ['photos'],
        targetBucketNames: [],
        options: { ...DEFAULT_OPTIONS, copyStorage: false },
      })
    );
    expect(plan.buckets).toEqual([]);
  });

  it('écarte les colonnes demandées, sans jamais toucher à la clé primaire', () => {
    const plan = buildCopyPlan(
      input({
        sourceSchema: schema(
          table('clients', ['id', 'email', 'search_vector'])
        ),
        targetSchema: schema(
          table('clients', ['id', 'email', 'search_vector'])
        ),
        selectedTables: ['clients'],
        options: {
          ...DEFAULT_OPTIONS,
          excludedColumns: ['search_vector', ' id '],
        },
      })
    );
    expect(plan.tables[0]?.columns).toEqual(['id', 'email']);
    expect(planWarnings(plan).join(' ')).toMatch(/search_vector/);
  });

  it('simule par défaut : rien ne sera écrit sans décision explicite', () => {
    expect(DEFAULT_OPTIONS.dryRun).toBe(true);
  });
});
