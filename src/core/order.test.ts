import { describe, expect, it } from 'vitest';
import { orderTables } from './order.ts';
import type { DatabaseSchema, TableInfo } from './schema.ts';

function table(
  name: string,
  fks: Record<string, string> = {},
  primaryKey: string[] = ['id']
): TableInfo {
  const columns = [
    { name: 'id', type: 'uuid', required: true, primaryKey: true },
    ...Object.entries(fks).map(([column, target]) => ({
      name: column,
      type: 'uuid',
      required: false,
      primaryKey: false,
      foreignKey: { table: target, column: 'id' },
    })),
  ];
  return { name, columns, primaryKey, insertable: true };
}

const schema = (...tables: TableInfo[]): DatabaseSchema => ({ tables });

describe('orderTables', () => {
  it('place les tables parentes avant leurs enfants', () => {
    const result = orderTables(
      schema(
        table('commandes', { client_id: 'clients' }),
        table('clients'),
        table('lignes', { commande_id: 'commandes' })
      ),
      ['commandes', 'clients', 'lignes']
    );
    expect(result.order).toEqual(['clients', 'commandes', 'lignes']);
    expect(result.cycles).toEqual([]);
  });

  it('rend un ordre stable quand rien ne départage deux tables', () => {
    const result = orderTables(schema(table('b'), table('a')), ['b', 'a']);
    expect(result.order).toEqual(['a', 'b']);
  });

  it('signale un cycle au lieu de rendre un ordre faux', () => {
    const result = orderTables(
      schema(
        table('a', { b_id: 'b' }),
        table('b', { a_id: 'a' }),
        table('libre')
      ),
      ['a', 'b', 'libre']
    );
    expect(result.cycles).toEqual([['a', 'b']]);
    // Les deux tables restent dans l'ordre : la copie est tentée, prévenue.
    expect(result.order).toHaveLength(3);
    expect(result.order).toContain('libre');
  });

  it('distingue une auto-référence d’un cycle', () => {
    const result = orderTables(
      schema(table('noeuds', { parent_id: 'noeuds' })),
      ['noeuds']
    );
    expect(result.selfReferencing).toEqual(['noeuds']);
    expect(result.cycles).toEqual([]);
    expect(result.order).toEqual(['noeuds']);
  });

  it('signale une dépendance vers une table écartée de la sélection', () => {
    const result = orderTables(
      schema(table('commandes', { client_id: 'clients' }), table('clients')),
      ['commandes']
    );
    expect(result.externalDependencies).toEqual([
      { table: 'commandes', dependsOn: 'clients' },
    ]);
    expect(result.order).toEqual(['commandes']);
  });

  it('ordonne une chaîne profonde de bout en bout', () => {
    const result = orderTables(
      schema(
        table('d', { c_id: 'c' }),
        table('c', { b_id: 'b' }),
        table('b', { a_id: 'a' }),
        table('a')
      ),
      ['d', 'c', 'b', 'a']
    );
    expect(result.order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('accepte plusieurs clés étrangères vers le même parent', () => {
    const result = orderTables(
      schema(
        table('messages', { auteur_id: 'profils', destinataire_id: 'profils' }),
        table('profils')
      ),
      ['messages', 'profils']
    );
    expect(result.order).toEqual(['profils', 'messages']);
  });
});
