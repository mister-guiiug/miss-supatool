import { describe, expect, it } from 'vitest';
import { describeError } from './errors.ts';

describe('describeError', () => {
  it("remplace « Failed to fetch » par les causes qu'on peut vérifier", () => {
    const message = describeError(new TypeError('Failed to fetch'));
    expect(message).not.toContain('Failed to fetch');
    expect(message).toMatch(/pause/);
  });

  it('nomme le délai dépassé', () => {
    expect(
      describeError(new DOMException('Délai dépassé', 'TimeoutError'))
    ).toMatch(/Délai dépassé/);
  });

  it("distingue l'arrêt demandé d'une panne", () => {
    expect(describeError(new DOMException('stop', 'AbortError'))).toMatch(
      /interrompue/
    );
  });

  it('traduit le refus de droits de l’API de management en marche à suivre', () => {
    const message = describeError(
      new Error(
        'HTTP 403 sur /v1/projects/abc/database/query — {"message":"Your account does not have the necessary privileges to access this endpoint. For more details, refer to our documentation https://supabase.com/docs/guides/platform/access-control"}'
      )
    );
    // Le rôle attendu, et surtout l'issue : le SQL est téléchargeable.
    expect(message).toMatch(/Owner ou Administrator/);
    expect(message).toMatch(/éditeur SQL/);
    expect(message).not.toMatch(/necessary privileges/);
  });

  it('laisse passer un message applicatif, secrets masqués', () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(30)}`;
    const message = describeError(new Error(`HTTP 401 avec ${jwt}`));
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain(jwt);
  });
});
