import { describe, expect, it } from 'vitest';
import { ProjectClient } from '../api/http.ts';
import { DEFAULT_OPTIONS, type BucketPlan } from '../core/plan.ts';
import { createFakeFetch, type Handler } from '../test/fakeFetch.ts';
import { copyBucket } from './copyStorage.ts';
import type { CopyEvent } from './events.ts';

const SOURCE = 'https://source.supabase.co';
const TARGET = 'https://cible.supabase.co';

const bucketPlan: BucketPlan = {
  bucket: 'photos',
  isPublic: false,
  existsOnTarget: true,
  willCreate: false,
  warnings: [],
};

/**
 * Arborescence de test : un fichier à la racine, un dossier, un fichier
 * dedans. Le listage n'étant pas récursif, c'est le parcours qu'on éprouve.
 */
const listing: Handler = call => {
  if (!call.url.startsWith(SOURCE)) return undefined;
  if (!call.path.startsWith('/storage/v1/object/list/')) return undefined;
  const body = JSON.parse(call.body ?? '{}') as {
    prefix: string;
    offset: number;
  };
  if (body.offset > 0) return { body: [] };
  if (body.prefix === '') {
    return {
      body: [
        {
          name: 'racine.png',
          id: 'o1',
          metadata: { size: 10, mimetype: 'image/png' },
        },
        { name: '2026', id: null, metadata: null },
      ],
    };
  }
  if (body.prefix === '2026/') {
    return {
      body: [
        {
          name: 'ete.jpg',
          id: 'o2',
          metadata: { size: 20, mimetype: 'image/jpeg' },
        },
      ],
    };
  }
  return { body: [] };
};

function clients(handlers: Handler[]) {
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

describe('copyBucket', () => {
  it('descend dans les dossiers et copie chaque fichier', async () => {
    const events: CopyEvent[] = [];
    const set = clients([
      listing,
      call =>
        call.url.startsWith(SOURCE) && call.method === 'GET'
          ? { text: 'contenu' }
          : undefined,
      call =>
        call.url.startsWith(TARGET) ? { status: 200, body: {} } : undefined,
    ]);

    const outcome = await copyBucket(bucketPlan, {
      source: set.source,
      target: set.target,
      options: { ...DEFAULT_OPTIONS, dryRun: false, concurrency: 1 },
      emit: e => events.push(e),
    });

    expect(outcome.objects).toBe(2);
    const copied = events
      .filter(e => e.type === 'object-copied')
      .map(e => (e.type === 'object-copied' ? e.path : ''));
    expect(copied.sort()).toEqual(['2026/ete.jpg', 'racine.png']);

    const uploads = set.fake.calls.filter(
      c => c.url.startsWith(TARGET) && c.method === 'POST'
    );
    expect(uploads.map(u => u.path)).toContain(
      '/storage/v1/object/photos/2026/ete.jpg'
    );
    expect(uploads[0]?.headers['x-upsert']).toBe('false');
  });

  it('compte un fichier déjà présent comme laissé en place, pas comme une erreur', async () => {
    const events: CopyEvent[] = [];
    const set = clients([
      listing,
      call =>
        call.url.startsWith(SOURCE) && call.method === 'GET'
          ? { text: 'contenu' }
          : undefined,
      call =>
        call.url.startsWith(TARGET)
          ? { status: 409, body: { message: 'Duplicate' } }
          : undefined,
    ]);

    const outcome = await copyBucket(bucketPlan, {
      source: set.source,
      target: set.target,
      options: { ...DEFAULT_OPTIONS, dryRun: false, concurrency: 1 },
      emit: e => events.push(e),
    });

    expect(outcome.errors).toBe(0);
    expect(outcome.skippedObjects).toBe(2);
    expect(outcome.objects).toBe(0);
    expect(events.some(e => e.type === 'object-skipped')).toBe(true);
  });

  it('en simulation, ne télécharge ni n’envoie rien', async () => {
    const set = clients([listing]);
    const outcome = await copyBucket(bucketPlan, {
      source: set.source,
      target: set.target,
      options: { ...DEFAULT_OPTIONS, dryRun: true, concurrency: 2 },
      emit: () => {},
    });
    expect(outcome.objects).toBe(2);
    // Les tailles annoncées par le listage suffisent à estimer le volume.
    expect(outcome.bytes).toBe(30);
    expect(set.fake.calls.some(c => c.url.startsWith(TARGET))).toBe(false);
  });

  it('crée le seau manquant en reprenant ses réglages', async () => {
    const set = clients([
      listing,
      call => (call.url.startsWith(TARGET) ? { body: {} } : undefined),
      call =>
        call.url.startsWith(SOURCE) && call.method === 'GET'
          ? { text: 'x' }
          : undefined,
    ]);
    const outcome = await copyBucket(
      {
        ...bucketPlan,
        existsOnTarget: false,
        willCreate: true,
        isPublic: true,
      },
      {
        source: set.source,
        target: set.target,
        options: { ...DEFAULT_OPTIONS, dryRun: false, concurrency: 1 },
        sourceBucket: { name: 'photos', isPublic: true, fileSizeLimit: 1024 },
        emit: () => {},
      }
    );
    expect(outcome.created).toBe(true);
    const creation = set.fake.calls.find(
      c => c.path === '/storage/v1/bucket' && c.method === 'POST'
    );
    expect(creation?.body).toContain('"public":true');
    expect(creation?.body).toContain('"file_size_limit":1024');
  });

  it('ignore le seau absent quand la création est refusée', async () => {
    const events: CopyEvent[] = [];
    const set = clients([listing]);
    const outcome = await copyBucket(
      { ...bucketPlan, existsOnTarget: false, willCreate: false },
      {
        source: set.source,
        target: set.target,
        options: {
          ...DEFAULT_OPTIONS,
          dryRun: false,
          createMissingBuckets: false,
        },
        emit: e => events.push(e),
      }
    );
    expect(outcome.objects).toBe(0);
    expect(events[0]).toMatchObject({ type: 'bucket-skipped' });
    expect(set.fake.calls).toHaveLength(0);
  });
});
