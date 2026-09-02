import { describe, expect, it } from 'vitest';
import { ProjectClient } from '../api/http.ts';
import { DEFAULT_OPTIONS, type TablePlan } from '../core/plan.ts';
import { createFakeFetch, rows, type Handler } from '../test/fakeFetch.ts';
import { copyTable } from './copyTables.ts';
import type { CopyEvent } from './events.ts';

const SOURCE = 'https://source.supabase.co';
const TARGET = 'https://cible.supabase.co';

const plan: TablePlan = {
  table: 'clients',
  columns: ['id', 'label'],
  primaryKey: ['id'],
  orderBy: ['id'],
  strategy: 'keyset',
  mode: 'upsert',
  onConflict: 'id',
  warnings: [],
};

/** Compte les lignes : `Prefer: count=…` renvoie le total dans `Content-Range`. */
const countHandler =
  (total: number): Handler =>
  call =>
    call.path.includes('limit=1') && call.headers.prefer?.startsWith('count=')
      ? { body: [], headers: { 'content-range': `0-0/${total}` } }
      : undefined;

function makeClients(handlers: Handler[]): {
  source: ProjectClient;
  target: ProjectClient;
  fake: ReturnType<typeof createFakeFetch>;
} {
  const fake = createFakeFetch(handlers);
  // `retries: 0` : les reprises sont éprouvées dans `api/http.test.ts`, elles
  // n'ajouteraient ici que des secondes d'attente.
  return {
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
    fake,
  };
}

function context(
  fake: ReturnType<typeof createFakeFetch>,
  clients: { source: ProjectClient; target: ProjectClient },
  options = DEFAULT_OPTIONS,
  events: CopyEvent[] = []
) {
  return {
    ctx: {
      source: clients.source,
      target: clients.target,
      options,
      schema: 'public',
      countStrategy: 'estimated' as const,
      emit: (event: CopyEvent) => events.push(event),
    },
    events,
    fake,
  };
}

describe('copyTable', () => {
  it('parcourt les pages au curseur et écrit par lots', async () => {
    const pages: Handler = call => {
      if (!call.url.startsWith(SOURCE) || !call.path.includes('select=')) {
        return undefined;
      }
      if (call.path.includes('limit=1')) return undefined;
      const params = new URLSearchParams(call.path.split('?')[1] ?? '');
      const after = params.get('id');
      if (!after) return { body: rows(1, 3) };
      if (after === 'gt.3') return { body: rows(4, 3) };
      if (after === 'gt.6') return { body: rows(7, 1) };
      return { body: [] };
    };
    const writes: Handler = call =>
      call.url.startsWith(TARGET) && call.method === 'POST'
        ? { status: 201 }
        : undefined;

    const clients = makeClients([countHandler(7), pages, writes]);
    const { ctx, events } = context(clients.fake, clients, {
      ...DEFAULT_OPTIONS,
      dryRun: false,
      pageSize: 3,
      batchSize: 2,
    });

    const outcome = await copyTable(plan, ctx);

    expect(outcome.read).toBe(7);
    expect(outcome.written).toBe(7);
    // 3 lignes en lots de 2 → 2 requêtes par page pleine, 1 pour la dernière.
    const posts = clients.fake.calls.filter(
      c => c.method === 'POST' && c.url.startsWith(TARGET)
    );
    expect(posts).toHaveLength(5);
    expect(posts[0]?.path).toContain('on_conflict=id');
    expect(posts[0]?.headers.prefer).toContain('resolution=merge-duplicates');
    expect(events.find(e => e.type === 'table-start')).toMatchObject({
      estimated: 7,
    });
  });

  it('ne touche jamais la source : aucune écriture ne part vers elle', async () => {
    const clients = makeClients([
      countHandler(2),
      call =>
        call.url.startsWith(SOURCE) ? { body: rows(1, 2) } : { status: 201 },
    ]);
    const { ctx } = context(clients.fake, clients, {
      ...DEFAULT_OPTIONS,
      dryRun: false,
      pageSize: 10,
    });
    await copyTable(plan, ctx);
    expect(clients.fake.writes.filter(c => c.url.startsWith(SOURCE))).toEqual(
      []
    );
  });

  it('en simulation, lit tout et n’écrit rien', async () => {
    const clients = makeClients([
      countHandler(2),
      call => (call.url.startsWith(SOURCE) ? { body: rows(1, 2) } : undefined),
    ]);
    const { ctx } = context(clients.fake, clients, {
      ...DEFAULT_OPTIONS,
      dryRun: true,
      pageSize: 10,
    });
    const outcome = await copyTable(plan, ctx);
    expect(outcome.read).toBe(2);
    expect(outcome.written).toBe(0);
    expect(clients.fake.calls.some(c => c.url.startsWith(TARGET))).toBe(false);
  });

  it('bascule sur le décalage quand la clé primaire ne peut pas servir de curseur', async () => {
    // Deux pages pleines dont la dernière ligne porte un identifiant NULL :
    // continuer au curseur redemanderait la même page indéfiniment.
    let page = 0;
    const clients = makeClients([
      countHandler(4),
      call => {
        if (!call.url.startsWith(SOURCE)) return { status: 201 };
        if (call.path.includes('limit=1')) return undefined;
        page += 1;
        if (page === 1)
          return {
            body: [
              { id: 1, label: 'a' },
              { id: null, label: 'b' },
            ],
          };
        if (page === 2)
          return {
            body: [
              { id: 3, label: 'c' },
              { id: 4, label: 'd' },
            ],
          };
        return { body: [] };
      },
    ]);
    const { ctx } = context(clients.fake, clients, {
      ...DEFAULT_OPTIONS,
      dryRun: true,
      pageSize: 2,
    });

    const outcome = await copyTable(plan, ctx);
    expect(outcome.read).toBe(4);
    const reads = clients.fake.calls.filter(
      c => c.url.startsWith(SOURCE) && !c.path.includes('limit=1')
    );
    expect(reads[1]?.path).toContain('offset=2');
  });

  it('copie quand même si le comptage échoue', async () => {
    const clients = makeClients([
      call =>
        call.headers.prefer?.startsWith('count=') ? { status: 500 } : undefined,
      call => (call.url.startsWith(SOURCE) ? { body: rows(1, 1) } : undefined),
    ]);
    const { ctx, events } = context(clients.fake, clients, {
      ...DEFAULT_OPTIONS,
      dryRun: true,
      pageSize: 10,
    });
    const outcome = await copyTable(plan, ctx);
    expect(outcome.read).toBe(1);
    expect(events[0]).toMatchObject({ type: 'table-start' });
    expect(events[0]).not.toHaveProperty('estimated');
  });
});
