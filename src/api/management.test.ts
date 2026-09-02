import { describe, expect, it } from 'vitest';
import {
  ManagementClient,
  pickServiceKey,
  waitForProject,
  type Project,
} from './management.ts';
import { createFakeFetch, type Handler } from '../test/fakeFetch.ts';

const PROXY = 'https://relais.example/proxy';
const TOKEN = 'sbp_FAKETESTFAKETESTFAKETESTFAKETEST';

function client(handlers: Handler[]) {
  const fake = createFakeFetch(handlers);
  return {
    fake,
    client: new ManagementClient({
      proxyBase: PROXY,
      token: TOKEN,
      fetchImpl: fake.fetch,
      retries: 0,
    }),
  };
}

describe('ManagementClient', () => {
  it('adresse le relais avec le chemin en paramètre, jamais l’API directement', async () => {
    const set = client([() => ({ body: [{ slug: 'acme', name: 'Acme' }] })]);
    await set.client.listOrganizations();
    const call = set.fake.calls[0];
    expect(call?.url).toBe(
      `${PROXY}?path=${encodeURIComponent('/v1/organizations')}`
    );
    expect(call?.url).not.toContain('api.supabase.com');
    expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('crée un projet avec les champs attendus par l’API', async () => {
    const set = client([
      () => ({ status: 201, body: { ref: 'abc', status: 'COMING_UP' } }),
    ]);
    await set.client.createProject({
      name: 'Cible',
      organizationSlug: 'acme',
      region: 'eu-west-3',
      dbPass: 'un-mot-de-passe',
    });
    const call = set.fake.calls[0];
    expect(call?.method).toBe('POST');
    const body = JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({
      name: 'Cible',
      organization_slug: 'acme',
      region: 'eu-west-3',
      db_pass: 'un-mot-de-passe',
    });
  });

  it('demande explicitement la lecture seule pour le relevé', async () => {
    const set = client([() => ({ status: 201, body: [] })]);
    await set.client.runQuery('abc', 'select 1', { readOnly: true });
    const body = JSON.parse(set.fake.calls[0]?.body ?? '{}') as {
      read_only: boolean;
      query: string;
    };
    expect(body.read_only).toBe(true);
    expect(body.query).toBe('select 1');
  });

  it('révèle les clés pour pouvoir remplir la connexion cible', async () => {
    const set = client([() => ({ body: [] })]);
    await set.client.listApiKeys('abcdefghijklmnop');
    expect(decodeURIComponent(set.fake.calls[0]?.url ?? '')).toContain(
      '/v1/projects/abcdefghijklmnop/api-keys?reveal=true'
    );
  });
});

describe('pickServiceKey', () => {
  it('préfère la clé service_role, même quand la nouvelle existe', () => {
    // Constaté sur un projet réellement créé par l'application : la connexion
    // renseignée avec la clé `sb_secret_…` ne fonctionnait pas, celle avec la
    // clé `service_role` du même projet, si. L'ordre inverse était un pari sur
    // l'équivalence des deux formats ; il est perdu.
    expect(
      pickServiceKey([
        { name: 'default', type: 'secret', api_key: 'sb_secret_nouvelle' },
        { name: 'service_role', type: 'legacy', api_key: 'ancienne' },
      ])
    ).toBe('ancienne');
  });

  it('retombe sur la clé nouveau format quand elle est seule', () => {
    expect(
      pickServiceKey([
        { name: 'anon', type: 'legacy', api_key: 'publique' },
        { name: 'default', type: 'secret', api_key: 'sb_secret_nouvelle' },
      ])
    ).toBe('sb_secret_nouvelle');
  });

  it('ne prend jamais une clé publique', () => {
    expect(
      pickServiceKey([
        { name: 'anon', type: 'legacy', api_key: 'publique' },
        { name: 'default', type: 'publishable', api_key: 'sb_publishable_x' },
      ])
    ).toBeUndefined();
  });

  it('rend undefined quand rien ne convient', () => {
    expect(
      pickServiceKey([{ name: 'anon', api_key: 'publique' }])
    ).toBeUndefined();
  });
});

describe('waitForProject', () => {
  const project = (status: Project['status']): Project => ({
    ref: 'abc',
    name: 'Cible',
    region: 'eu-west-3',
    status,
  });

  it('attend que le projet soit sain', async () => {
    const statuses: Project['status'][] = [
      'COMING_UP',
      'COMING_UP',
      'ACTIVE_HEALTHY',
    ];
    let index = 0;
    const set = client([
      () => ({ body: project(statuses[index++] ?? 'ACTIVE_HEALTHY') }),
    ]);
    const seen: string[] = [];
    const result = await waitForProject(set.client, 'abc', {
      wait: async () => Promise.resolve(),
      onStatus: s => seen.push(s),
    });
    expect(result.status).toBe('ACTIVE_HEALTHY');
    expect(seen).toEqual(['COMING_UP', 'COMING_UP', 'ACTIVE_HEALTHY']);
  });

  it('abandonne sur un état sans retour', async () => {
    const set = client([() => ({ body: project('INIT_FAILED') })]);
    await expect(
      waitForProject(set.client, 'abc', { wait: async () => Promise.resolve() })
    ).rejects.toThrow(/INIT_FAILED/);
  });

  it('rend la main après le délai plutôt que de boucler', async () => {
    const set = client([() => ({ body: project('COMING_UP') })]);
    await expect(
      waitForProject(set.client, 'abc', {
        wait: async () => Promise.resolve(),
        timeoutMs: -1,
      })
    ).rejects.toThrow(/délai/i);
  });
});
