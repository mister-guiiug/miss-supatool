import { describe, expect, it } from 'vitest';
import { commonColumns, countByLevel, diffTable, hasBlocking } from './diff.ts';
import type { ColumnInfo, TableInfo } from './schema.ts';

function column(name: string, type = 'text', required = false): ColumnInfo {
  return { name, type, required, primaryKey: false };
}

function table(
  name: string,
  columns: ColumnInfo[],
  pk: string[] = []
): TableInfo {
  return {
    name,
    columns: columns.map(c => ({ ...c, primaryKey: pk.includes(c.name) })),
    primaryKey: pk,
    insertable: true,
  };
}

describe('diffTable', () => {
  it('bloque quand la table manque à la cible', () => {
    const issues = diffTable(
      table('clients', [column('id')], ['id']),
      undefined
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('table-missing');
    expect(hasBlocking(issues)).toBe(true);
  });

  it('bloque sur une colonne absente de la cible', () => {
    const issues = diffTable(
      table('clients', [column('id'), column('email')], ['id']),
      table('clients', [column('id')], ['id'])
    );
    expect(issues.map(i => i.code)).toContain('column-missing');
    expect(hasBlocking(issues)).toBe(true);
  });

  it("bloque quand la cible exige une colonne que la source n'a pas", () => {
    const issues = diffTable(
      table('clients', [column('id')], ['id']),
      table(
        'clients',
        [column('id'), column('tenant_id', 'uuid', true)],
        ['id']
      )
    );
    expect(issues.map(i => i.code)).toContain('extra-required-column');
    expect(hasBlocking(issues)).toBe(true);
  });

  it('tolère une colonne supplémentaire facultative à la cible', () => {
    const issues = diffTable(
      table('clients', [column('id')], ['id']),
      table('clients', [column('id'), column('note')], ['id'])
    );
    expect(hasBlocking(issues)).toBe(false);
    expect(countByLevel(issues).info).toBe(1);
  });

  it('avertit sur un type différent sans bloquer', () => {
    const issues = diffTable(
      table('clients', [column('id'), column('age', 'int4')], ['id']),
      table('clients', [column('id'), column('age', 'text')], ['id'])
    );
    expect(countByLevel(issues)).toMatchObject({ blocking: 0, warning: 1 });
  });

  it("avertit qu'une table sans clé primaire n'est pas rejouable", () => {
    const issues = diffTable(
      table('journal', [column('message')]),
      table('journal', [column('message')])
    );
    expect(issues.map(i => i.code)).toContain('no-primary-key');
  });

  it('bloque sur une vue non modifiable à la cible', () => {
    const target = table('vue', [column('id')], ['id']);
    const issues = diffTable(table('vue', [column('id')], ['id']), {
      ...target,
      insertable: false,
    });
    expect(issues.map(i => i.code)).toContain('table-not-insertable');
  });
});

describe('commonColumns', () => {
  it("ne garde que l'intersection, dans l'ordre de la source", () => {
    expect(
      commonColumns(
        table('t', [column('a'), column('b'), column('c')]),
        table('t', [column('c'), column('a')])
      )
    ).toEqual(['a', 'c']);
  });
});
