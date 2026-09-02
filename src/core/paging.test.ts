import { describe, expect, it } from 'vitest';
import {
  buildSelectQuery,
  chunk,
  cursorValue,
  pagingStrategy,
  parseContentRange,
  quoteFilterValue,
} from './paging.ts';

describe('buildSelectQuery', () => {
  it('demande les colonnes, le tri et la taille de page', () => {
    const query = new URLSearchParams(
      buildSelectQuery({
        columns: ['id', 'nom'],
        orderBy: ['id'],
        limit: 500,
      })
    );
    expect(query.get('select')).toBe('id,nom');
    expect(query.get('order')).toBe('id.asc');
    expect(query.get('limit')).toBe('500');
    expect(query.get('offset')).toBeNull();
  });

  it('pose un filtre « après la dernière valeur » en pagination par curseur', () => {
    const query = new URLSearchParams(
      buildSelectQuery({
        columns: ['id'],
        orderBy: ['id'],
        limit: 100,
        after: { column: 'id', value: '42' },
      })
    );
    expect(query.get('id')).toBe('gt.42');
    expect(query.get('offset')).toBeNull();
  });

  it('retombe sur le décalage quand il est fourni', () => {
    const query = new URLSearchParams(
      buildSelectQuery({
        columns: ['id'],
        orderBy: [],
        limit: 100,
        offset: 300,
      })
    );
    expect(query.get('offset')).toBe('300');
    expect(query.get('order')).toBeNull();
  });

  it('protège une valeur de curseur qui contient des caractères réservés', () => {
    const query = new URLSearchParams(
      buildSelectQuery({
        columns: ['created_at'],
        orderBy: ['created_at'],
        limit: 10,
        after: { column: 'created_at', value: '2026-09-02T10:00:00.123Z' },
      })
    );
    expect(query.get('created_at')).toBe('gt."2026-09-02T10:00:00.123Z"');
  });
});

describe('quoteFilterValue', () => {
  it('laisse nus les identifiants simples', () => {
    expect(quoteFilterValue('42')).toBe('42');
    expect(quoteFilterValue('3f1c9a2e-0000-4aaa-bbbb-cccccccccccc')).toBe(
      '3f1c9a2e-0000-4aaa-bbbb-cccccccccccc'
    );
  });

  it('échappe les guillemets et les antislashs', () => {
    expect(quoteFilterValue('a"b')).toBe('"a\\"b"');
    expect(quoteFilterValue('a\\b')).toBe('"a\\\\b"');
  });
});

describe('parseContentRange', () => {
  it('lit le total', () => {
    expect(parseContentRange('0-999/12345')).toBe(12345);
  });

  it('rend undefined quand le total est inconnu ou absent', () => {
    expect(parseContentRange('0-9/*')).toBeUndefined();
    expect(parseContentRange(null)).toBeUndefined();
    expect(parseContentRange('bizarre')).toBeUndefined();
  });
});

describe('pagingStrategy', () => {
  it('choisit le curseur pour une clé primaire simple', () => {
    expect(pagingStrategy(['id'])).toBe('keyset');
  });

  it('retombe sur le décalage sans clé primaire ou en clé composite', () => {
    expect(pagingStrategy([])).toBe('offset');
    expect(pagingStrategy(['a', 'b'])).toBe('offset');
  });
});

describe('chunk', () => {
  it('découpe en lots, dernier lot plus court', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('refuse une taille nulle plutôt que de boucler', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('cursorValue', () => {
  it('accepte les valeurs simples', () => {
    expect(cursorValue({ id: 7 }, 'id')).toBe('7');
    expect(cursorValue({ id: 'abc' }, 'id')).toBe('abc');
  });

  it('rend null sur une valeur inutilisable comme curseur', () => {
    expect(cursorValue({ id: null }, 'id')).toBeNull();
    expect(cursorValue({}, 'id')).toBeNull();
    expect(cursorValue({ id: { a: 1 } }, 'id')).toBeNull();
  });
});
