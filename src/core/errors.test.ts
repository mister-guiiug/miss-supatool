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

  it('laisse passer un message applicatif, secrets masqués', () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(30)}`;
    const message = describeError(new Error(`HTTP 401 avec ${jwt}`));
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain(jwt);
  });
});
