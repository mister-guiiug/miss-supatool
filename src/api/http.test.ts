import { describe, expect, it } from 'vitest';
import { ApiError, ProjectClient } from './http.ts';
import { SourceWriteError } from '../core/guard.ts';
import { createFakeFetch } from '../test/fakeFetch.ts';

const BASE = 'https://exemple.supabase.co';

describe('ProjectClient', () => {
  it('joint la clé aux deux en-têtes attendus par Supabase', async () => {
    const fake = createFakeFetch([() => ({ body: [] })]);
    const client = new ProjectClient({
      base: `${BASE}/`,
      key: 'clé-de-test',
      fetchImpl: fake.fetch,
    });
    await client.requestJson('/rest/v1/clients');
    expect(fake.calls[0]?.headers.apikey).toBe('clé-de-test');
    expect(fake.calls[0]?.headers.authorization).toBe('Bearer clé-de-test');
    // La barre finale de la base ne doit pas produire d'URL à double barre.
    expect(fake.calls[0]?.url).toBe(`${BASE}/rest/v1/clients`);
  });

  it('refuse une écriture sur un client déclaré en lecture seule', async () => {
    const fake = createFakeFetch([() => ({ body: [] })]);
    const client = new ProjectClient({
      base: BASE,
      key: 'k',
      readOnly: true,
      fetchImpl: fake.fetch,
    });
    await expect(
      client.request('/rest/v1/clients', { method: 'POST', body: '[]' })
    ).rejects.toBeInstanceOf(SourceWriteError);
    // Rien n'est parti : le refus a lieu AVANT l'envoi.
    expect(fake.calls).toHaveLength(0);
  });

  it('reprend après un 503 puis rend la réponse', async () => {
    let seen = 0;
    const fake = createFakeFetch([
      () => {
        seen += 1;
        return seen === 1 ? { status: 503, body: {} } : { body: { ok: true } };
      },
    ]);
    const client = new ProjectClient({
      base: BASE,
      key: 'k',
      fetchImpl: fake.fetch,
      retries: 2,
    });
    const result = await client.requestJson<{ ok: boolean }>('/rest/v1/x');
    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it('ne reprend pas une erreur définitive', async () => {
    const fake = createFakeFetch([
      () => ({ status: 400, body: { message: 'non' } }),
    ]);
    const client = new ProjectClient({
      base: BASE,
      key: 'k',
      fetchImpl: fake.fetch,
      retries: 3,
    });
    await expect(client.requestJson('/rest/v1/x')).rejects.toBeInstanceOf(
      ApiError
    );
    expect(fake.calls).toHaveLength(1);
  });

  it('masque la clé dans le message d’erreur', async () => {
    const key = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(30)}`;
    const fake = createFakeFetch([
      () => ({ status: 401, text: `Invalid API key: ${key}` }),
    ]);
    const client = new ProjectClient({
      base: BASE,
      key,
      fetchImpl: fake.fetch,
      retries: 0,
    });
    const error = await client
      .requestJson('/rest/v1/x')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).not.toContain(key);
    expect((error as ApiError).status).toBe(401);
  });
});
