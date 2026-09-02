import { describe, expect, it } from 'vitest';
import {
  checkConnection,
  inspectKey,
  isSameProject,
  normalizeProjectUrl,
} from './project.ts';

/**
 * Les jetons sont FABRIQUÉS à l'exécution, jamais écrits en dur : un JWT de
 * démonstration collé dans un test ressemble assez à une vraie clé pour que la
 * protection anti-secret de GitHub refuse le dépôt (leçon de miss-supaboss).
 */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature-de-test`;
}

describe('normalizeProjectUrl', () => {
  it('accepte une référence de projet nue', () => {
    expect(normalizeProjectUrl('abcdefghijklmnop')).toEqual({
      base: 'https://abcdefghijklmnop.supabase.co',
      ref: 'abcdefghijklmnop',
    });
  });

  it('ajoute le schéma et retire le chemin collé par mégarde', () => {
    expect(normalizeProjectUrl('abcdefghijklmnop.supabase.co/rest/v1')).toEqual(
      {
        base: 'https://abcdefghijklmnop.supabase.co',
        ref: 'abcdefghijklmnop',
      }
    );
  });

  it('accepte un domaine personnalisé, sans référence', () => {
    expect(normalizeProjectUrl('https://db.exemple.fr/')).toEqual({
      base: 'https://db.exemple.fr',
    });
  });

  it('refuse ce qui n’est pas une URL', () => {
    expect(normalizeProjectUrl('   ')).toBeUndefined();
    expect(normalizeProjectUrl('ftp://exemple.fr')).toBeUndefined();
  });
});

describe('inspectKey', () => {
  it('lit le rôle et le projet dans un JWT', () => {
    const key = makeJwt({ role: 'service_role', ref: 'abcdefghijklmnop' });
    expect(inspectKey(key)).toMatchObject({
      role: 'service_role',
      ref: 'abcdefghijklmnop',
    });
  });

  it('reconnaît les clés nommées', () => {
    expect(inspectKey('sb_secret_' + 'A'.repeat(20)).role).toBe('service_role');
    expect(inspectKey('sb_publishable_' + 'A'.repeat(20)).role).toBe(
      'publishable'
    );
  });

  it('ne prétend rien sur une chaîne quelconque', () => {
    expect(inspectKey('bonjour').role).toBe('unknown');
  });
});

describe('checkConnection', () => {
  const url = 'https://abcdefghijklmnop.supabase.co';

  it('accepte une clé de service cohérente avec le projet', () => {
    const check = checkConnection(
      { url, key: makeJwt({ role: 'service_role', ref: 'abcdefghijklmnop' }) },
      'source'
    );
    expect(check.ok).toBe(true);
    expect(check.warnings).toEqual([]);
    expect(check.normalized?.base).toBe(url);
  });

  it('avertit qu’une clé publique ne verra pas tout', () => {
    const check = checkConnection(
      { url, key: makeJwt({ role: 'anon', ref: 'abcdefghijklmnop' }) },
      'source'
    );
    expect(check.ok).toBe(true);
    expect(check.warnings.join(' ')).toMatch(/PUBLIQUE/);
  });

  it('refuse une clé qui appartient à un autre projet', () => {
    const check = checkConnection(
      { url, key: makeJwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzz' }) },
      'target'
    );
    expect(check.ok).toBe(false);
    expect(check.errors.join(' ')).toMatch(/zzzzzzzzzzzzzzzz/);
  });

  it('refuse une clé expirée', () => {
    const check = checkConnection(
      {
        url,
        key: makeJwt({
          role: 'service_role',
          ref: 'abcdefghijklmnop',
          exp: 1,
        }),
      },
      'target'
    );
    expect(check.ok).toBe(false);
    expect(check.errors.join(' ')).toMatch(/expiré/);
  });

  it('refuse une URL vide', () => {
    const check = checkConnection({ url: '', key: 'x' }, 'source');
    expect(check.ok).toBe(false);
  });
});

describe('isSameProject', () => {
  it('reconnaît le même projet malgré la casse et la barre finale', () => {
    expect(
      isSameProject(
        'https://abcdefghijklmnop.supabase.co/',
        'ABCDEFGHIJKLMNOP.supabase.co'
      )
    ).toBe(true);
  });

  it('distingue deux projets différents', () => {
    expect(
      isSameProject(
        'https://abcdefghijklmnop.supabase.co',
        'https://qrstuvwxyzabcdef.supabase.co'
      )
    ).toBe(false);
  });
});
