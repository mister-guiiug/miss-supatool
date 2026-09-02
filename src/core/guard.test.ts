import { describe, expect, it } from 'vitest';
import {
  assertReadOnly,
  isReadOnlyRequest,
  SourceWriteError,
} from './guard.ts';

describe('invariant de lecture seule sur la source', () => {
  it('laisse passer les lectures', () => {
    expect(isReadOnlyRequest('GET', '/rest/v1/clients?select=*')).toBe(true);
    expect(isReadOnlyRequest('head', '/rest/v1/clients')).toBe(true);
    expect(isReadOnlyRequest('GET', '/storage/v1/object/photos/a.png')).toBe(
      true
    );
  });

  it('autorise le POST de listage du stockage, et lui seul', () => {
    expect(isReadOnlyRequest('POST', '/storage/v1/object/list/photos')).toBe(
      true
    );
    expect(isReadOnlyRequest('POST', '/storage/v1/object/photos/a.png')).toBe(
      false
    );
  });

  it('refuse toute écriture, y compris déguisée en fonction', () => {
    expect(isReadOnlyRequest('POST', '/rest/v1/clients')).toBe(false);
    expect(isReadOnlyRequest('PATCH', '/rest/v1/clients?id=eq.1')).toBe(false);
    expect(isReadOnlyRequest('DELETE', '/rest/v1/clients')).toBe(false);
    // Une fonction Postgres peut écrire : rien dans l'URL ne le dit.
    expect(isReadOnlyRequest('POST', '/rest/v1/rpc/vider_tout')).toBe(false);
    expect(isReadOnlyRequest('POST', '/storage/v1/bucket')).toBe(false);
  });

  it('lève une erreur nommée, pas une erreur générique', () => {
    expect(() => assertReadOnly('DELETE', '/rest/v1/clients')).toThrow(
      SourceWriteError
    );
    expect(() => assertReadOnly('GET', '/rest/v1/clients')).not.toThrow();
  });
});
