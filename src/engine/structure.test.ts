import { describe, expect, it } from 'vitest';
import { ManagementClient } from '../api/management.ts';
import type { Statement } from '../core/structure.ts';
import { createFakeFetch, type Handler } from '../test/fakeFetch.ts';
import { applyStatements, applySummary, readStructure } from './structure.ts';

const PROXY = 'https://relais.example/proxy';

function build(handlers: Handler[]) {
  const fake = createFakeFetch(handlers);
  return {
    fake,
    client: new ManagementClient({
      proxyBase: PROXY,
      token: 'sbp_FAKETESTFAKETESTFAKETESTFAKETEST',
      fetchImpl: fake.fetch,
      retries: 0,
    }),
  };
}

const statement = (object: string, sql = 'select 1'): Statement => ({
  phase: 'table',
  object,
  sql,
});

/** Lit la requête SQL envoyée dans le corps d'un appel. */
function sqlOf(body: string | undefined): string {
  return (JSON.parse(body ?? '{}') as { query?: string }).query ?? '';
}

describe('readStructure', () => {
  it('interroge la source en lecture seule, sans exception', async () => {
    const set = build([() => ({ status: 201, body: [] })]);
    await readStructure(set.client, 'abc', { schema: 'public' });
    expect(set.fake.calls.length).toBeGreaterThan(5);
    for (const call of set.fake.calls) {
      const body = JSON.parse(call.body ?? '{}') as { read_only?: boolean };
      expect(body.read_only).toBe(true);
    }
  });

  it('range les lignes sous la bonne clé', async () => {
    const set = build([
      call =>
        sqlOf(call.body).includes('pg_extension')
          ? { status: 201, body: [{ name: 'pgcrypto', schema: 'extensions' }] }
          : { status: 201, body: [] },
    ]);
    const rows = await readStructure(set.client, 'abc', { schema: 'public' });
    expect(rows.extensions).toEqual([
      { name: 'pgcrypto', schema: 'extensions' },
    ]);
    expect(rows.policies).toEqual([]);
  });

  it('rend compte de son avancement', async () => {
    const set = build([() => ({ status: 201, body: [] })]);
    const seen: number[] = [];
    await readStructure(set.client, 'abc', {
      schema: 'public',
      onProgress: done => seen.push(done),
    });
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(seen.length);
  });
});

describe('applyStatements', () => {
  it('envoie chaque instruction et rend un résultat par instruction', async () => {
    const set = build([() => ({ status: 201, body: [] })]);
    const results = await applyStatements(set.client, 'abc', [
      statement('a'),
      statement('b'),
    ]);
    expect(results.map(r => r.status)).toEqual(['applied', 'applied']);
    expect(set.fake.calls).toHaveLength(2);
  });

  it("n'envoie rien en simulation", async () => {
    const set = build([() => ({ status: 201, body: [] })]);
    const results = await applyStatements(set.client, 'abc', [statement('a')], {
      dryRun: true,
    });
    expect(results[0]?.status).toBe('applied');
    expect(set.fake.calls).toHaveLength(0);
  });

  it('poursuit après un échec et le rapporte', async () => {
    const set = build([
      call =>
        sqlOf(call.body).includes('casse')
          ? { status: 400, text: 'relation inconnue' }
          : { status: 201, body: [] },
    ]);
    const results = await applyStatements(set.client, 'abc', [
      statement('bon'),
      statement('mauvais', 'select casse'),
      statement('autre'),
    ]);
    expect(results.map(r => r.status)).toEqual([
      'applied',
      'failed',
      'applied',
    ]);
    expect(results[1]?.message).toContain('400');
    expect(applySummary(results)).toEqual({
      applied: 2,
      failed: 1,
      notAttempted: 0,
      retried: 0,
    });
  });

  it('arrête tout au premier refus de droits, sans seconde passe', async () => {
    // Constaté en vrai : treize instructions, treize fois le même 403 « votre
    // compte n'a pas les privilèges », puis treize de plus en seconde passe.
    // Un refus de droits ne dépend pas de l'instruction : le rejouer est du
    // bruit, et le rejouer DEUX fois est du bruit payant.
    const set = build([
      () => ({
        status: 403,
        body: {
          message:
            'Your account does not have the necessary privileges to access this endpoint.',
        },
      }),
    ]);
    const results = await applyStatements(set.client, 'abc', [
      statement('a'),
      statement('b'),
      statement('c'),
    ]);

    expect(results.map(r => r.status)).toEqual([
      'failed',
      'not-attempted',
      'not-attempted',
    ]);
    // Un seul appel : ni les suivantes, ni la seconde passe.
    expect(set.fake.calls).toHaveLength(1);
    // Et le message dit quoi faire, au lieu de recopier l'anglais de l'API.
    expect(results[0]?.message).toMatch(/Owner ou Administrator/);
    expect(results[0]?.message).toMatch(/éditeur SQL/);
    expect(applySummary(results)).toMatchObject({
      applied: 0,
      failed: 1,
      notAttempted: 2,
    });
  });

  it("n'arrête pas tout sur une erreur SQL ordinaire", async () => {
    let seen = 0;
    const set = build([
      () => {
        seen += 1;
        return seen === 1
          ? { status: 400, text: 'relation inconnue' }
          : { status: 201, body: [] };
      },
    ]);
    const results = await applyStatements(set.client, 'abc', [
      statement('a'),
      statement('b'),
    ]);
    expect(results.map(r => r.status)).toEqual(['applied', 'applied']);
  });

  it('rattrape en seconde passe ce qu’un ordre statique ne pouvait pas savoir', async () => {
    // La vue dépend d'une autre vue créée après elle : elle échoue d'abord,
    // puis passe au second essai. C'est le cas que la seconde passe existe pour.
    let created = false;
    const set = build([
      call => {
        const sql = sqlOf(call.body);
        if (sql.includes('vue_dependante')) {
          return created
            ? { status: 201, body: [] }
            : { status: 400, text: 'relation « base » inexistante' };
        }
        if (sql.includes('vue_base')) {
          created = true;
          return { status: 201, body: [] };
        }
        return { status: 201, body: [] };
      },
    ]);

    const results = await applyStatements(set.client, 'abc', [
      statement(
        'vue_dependante',
        'create view vue_dependante as select * from vue_base'
      ),
      statement('vue_base', 'create view vue_base as select 1'),
    ]);

    expect(results.map(r => r.status)).toEqual(['applied', 'applied']);
    expect(results[0]?.retried).toBe(true);
    expect(results[0]?.message).toBeUndefined();
    expect(applySummary(results).retried).toBe(1);
  });

  it('garde le premier message quand la seconde passe échoue aussi', async () => {
    const set = build([() => ({ status: 400, text: 'vraie erreur' })]);
    const results = await applyStatements(set.client, 'abc', [
      statement('perdu', 'select casse'),
    ]);
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.message).toContain('400');
    expect(set.fake.calls).toHaveLength(2); // première passe + seconde
  });

  it('s’arrête sur demande', async () => {
    const controller = new AbortController();
    const set = build([() => ({ status: 201, body: [] })]);
    const results = await applyStatements(
      set.client,
      'abc',
      [statement('a'), statement('b'), statement('c')],
      {
        signal: controller.signal,
        onProgress: done => {
          if (done === 1) controller.abort();
        },
      }
    );
    expect(results.length).toBeLessThan(3);
  });
});
