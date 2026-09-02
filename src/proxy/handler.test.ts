import { describe, expect, it, vi } from 'vitest';
import {
  handleProxy,
  isAllowedPath,
  parseOrigins,
  UPSTREAM,
} from './handler.ts';

const ORIGIN = 'https://mister-guiiug.github.io';
const env = { ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5234` };

/** Un faux jeton qui ne ressemble PAS à un vrai : `sbp_` + 40 hex déclenche la
 *  protection anti-secret de GitHub et fait refuser le dépôt (leçon supaboss). */
const TOKEN = 'Bearer sbp_FAKETESTFAKETESTFAKETESTFAKETEST';

function request(
  path: string,
  init: RequestInit & { origin?: string | null } = {}
): Request {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  return new Request(
    `https://relais.example/?path=${encodeURIComponent(path)}`,
    { ...init, headers }
  );
}

describe('parseOrigins', () => {
  it('refuse par défaut : rien ne vaut PERSONNE, pas TOUT LE MONDE', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
    expect(parseOrigins('   ,  ')).toEqual([]);
  });

  it('lit une liste séparée par des virgules', () => {
    expect(parseOrigins(' a , b ')).toEqual(['a', 'b']);
  });
});

describe('isAllowedPath', () => {
  it('accepte ce dont l’application a besoin', () => {
    expect(isAllowedPath('GET', '/v1/organizations')).toBe(true);
    expect(isAllowedPath('POST', '/v1/projects')).toBe(true);
    expect(isAllowedPath('GET', '/v1/projects/abcdefghijklmnop')).toBe(true);
    expect(isAllowedPath('GET', '/v1/projects/abcdefghijklmnop/api-keys')).toBe(
      true
    );
    expect(
      isAllowedPath('POST', '/v1/projects/abcdefghijklmnop/database/query')
    ).toBe(true);
  });

  it('refuse tout le reste, destruction en tête', () => {
    expect(isAllowedPath('DELETE', '/v1/projects/abcdefghijklmnop')).toBe(
      false
    );
    expect(isAllowedPath('PATCH', '/v1/projects/abcdefghijklmnop')).toBe(false);
    expect(isAllowedPath('POST', '/v1/projects/abcdefghijklmnop/pause')).toBe(
      false
    );
    expect(isAllowedPath('GET', '/v1/snippets')).toBe(false);
  });
});

describe('handleProxy', () => {
  it('relaie une requête légitime vers la seule cible prévue', async () => {
    const upstream = vi.fn(async () =>
      Promise.resolve(new Response('[{"slug":"acme"}]', { status: 200 }))
    );
    const response = await handleProxy(
      request('/v1/organizations', { headers: { authorization: TOKEN } }),
      env,
      upstream as unknown as typeof fetch
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const [url, init] = upstream.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${UPSTREAM}/v1/organizations`);
    expect((init.headers as Record<string, string>).authorization).toBe(TOKEN);
  });

  it('refuse une requête sans en-tête Origin (curl, serveur)', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      request('/v1/organizations', {
        origin: null,
        headers: { authorization: TOKEN },
      }),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuse une origine inconnue', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      request('/v1/organizations', {
        origin: 'https://ailleurs.example',
        headers: { authorization: TOKEN },
      }),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('ferme tout quand la liste d’origines est absente', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      request('/v1/organizations', { headers: { authorization: TOKEN } }),
      {},
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuse un chemin hors liste blanche', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      new Request(
        `https://relais.example/?path=${encodeURIComponent('/v1/projects/abcdefghijklmnop')}`,
        { method: 'DELETE', headers: { origin: ORIGIN, authorization: TOKEN } }
      ),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('ne se laisse pas détourner vers un autre hôte', async () => {
    const upstream = vi.fn(async () => Promise.resolve(new Response('{}')));
    const response = await handleProxy(
      new Request(
        `https://relais.example/?path=${encodeURIComponent('https://ailleurs.example/v1/organizations')}`,
        { headers: { origin: ORIGIN, authorization: TOKEN } }
      ),
      env,
      upstream as unknown as typeof fetch
    );
    // Le chemin doit commencer par `/v1/` : une URL absolue est rejetée.
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('exige un jeton', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      request('/v1/organizations'),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('répond au préflet sans rien relayer', async () => {
    const upstream = vi.fn();
    const response = await handleProxy(
      request('/v1/organizations', { method: 'OPTIONS' }),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'POST'
    );
    expect(upstream).not.toHaveBeenCalled();
  });

  it('transmet le corps et le statut d’erreur sans les réécrire', async () => {
    const upstream = vi.fn(async () =>
      Promise.resolve(
        new Response('{"message":"quota atteint"}', { status: 429 })
      )
    );
    const response = await handleProxy(
      request('/v1/projects', {
        method: 'POST',
        body: '{"name":"x"}',
        headers: { authorization: TOKEN, 'content-type': 'application/json' },
      }),
      env,
      upstream as unknown as typeof fetch
    );
    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toContain('quota atteint');
    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"name":"x"}');
  });
});
