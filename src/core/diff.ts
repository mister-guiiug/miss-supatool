/**
 * Comparaison des schémas source et cible.
 *
 * Miss Supatool copie des DONNÉES, pas des structures : créer les tables, les
 * contraintes et les politiques RLS de la cible demande du SQL, et le SQL n'est
 * pas joignable depuis un navigateur (voir `schema.ts`). La cible doit donc
 * déjà porter le schéma — par une migration, `supabase db push`, ou un dump de
 * structure. Le rôle de ce fichier est de le VÉRIFIER avant d'écrire quoi que
 * ce soit, parce qu'un écart se paie autrement en 400 au milieu d'une copie à
 * moitié faite.
 *
 * Trois niveaux, et la différence compte : `blocking` arrête, `warning` laisse
 * passer sous responsabilité de l'utilisateur, `info` ne fait que dire.
 */

import type { DatabaseSchema, TableInfo } from './schema.ts';
import { findTable } from './schema.ts';

export type IssueLevel = 'blocking' | 'warning' | 'info';

export interface SchemaIssue {
  level: IssueLevel;
  table: string;
  column?: string;
  code:
    | 'table-missing'
    | 'table-not-insertable'
    | 'column-missing'
    | 'column-required-missing'
    | 'type-mismatch'
    | 'no-primary-key'
    | 'primary-key-mismatch'
    | 'extra-required-column';
  message: string;
}

/**
 * Colonnes que la source et la cible partagent : ce sont les seules qu'on
 * envoie. Une colonne présente uniquement chez l'une est traitée ailleurs, par
 * une anomalie.
 */
export function commonColumns(source: TableInfo, target: TableInfo): string[] {
  const targetNames = new Set(target.columns.map(c => c.name));
  return source.columns.map(c => c.name).filter(name => targetNames.has(name));
}

export function diffTable(
  source: TableInfo,
  target: TableInfo | undefined
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!target) {
    return [
      {
        level: 'blocking',
        table: source.name,
        code: 'table-missing',
        message: `La table « ${source.name} » n'existe pas dans le projet cible. Appliquez d'abord vos migrations.`,
      },
    ];
  }

  if (!target.insertable) {
    issues.push({
      level: 'blocking',
      table: source.name,
      code: 'table-not-insertable',
      message: `« ${source.name} » n'accepte pas d'insertion dans le projet cible (vue non modifiable, ou droits insuffisants).`,
    });
  }

  const targetByName = new Map(target.columns.map(c => [c.name, c]));
  for (const column of source.columns) {
    const twin = targetByName.get(column.name);
    if (!twin) {
      issues.push({
        level: 'blocking',
        table: source.name,
        column: column.name,
        code: 'column-missing',
        message: `Colonne « ${column.name} » absente de la table cible : les lignes seraient refusées (400).`,
      });
      continue;
    }
    if (twin.type !== column.type) {
      issues.push({
        level: 'warning',
        table: source.name,
        column: column.name,
        code: 'type-mismatch',
        message: `Type différent pour « ${column.name} » : ${column.type} à la source, ${twin.type} à la cible.`,
      });
    }
  }

  const sourceByName = new Map(source.columns.map(c => [c.name, c]));
  for (const column of target.columns) {
    if (sourceByName.has(column.name)) continue;
    issues.push({
      level: column.required ? 'blocking' : 'info',
      table: source.name,
      column: column.name,
      code: column.required
        ? 'extra-required-column'
        : 'column-required-missing',
      message: column.required
        ? `La cible exige « ${column.name} », que la source ne fournit pas (NOT NULL sans valeur par défaut).`
        : `« ${column.name} » n'existe que dans la cible : elle restera à sa valeur par défaut.`,
    });
  }

  if (source.primaryKey.length === 0) {
    issues.push({
      level: 'warning',
      table: source.name,
      code: 'no-primary-key',
      message: `« ${source.name} » n'a pas de clé primaire : la reprise après interruption et la mise à jour (upsert) ne sont pas disponibles, et une copie relancée créera des doublons.`,
    });
  } else if (
    target.primaryKey.length > 0 &&
    source.primaryKey.join(',') !== target.primaryKey.join(',')
  ) {
    issues.push({
      level: 'warning',
      table: source.name,
      code: 'primary-key-mismatch',
      message: `Clés primaires différentes : (${source.primaryKey.join(', ')}) à la source, (${target.primaryKey.join(', ')}) à la cible.`,
    });
  }

  return issues;
}

export function diffSchemas(
  source: DatabaseSchema,
  target: DatabaseSchema,
  selected: readonly string[]
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  for (const name of selected) {
    const sourceTable = findTable(source, name);
    if (!sourceTable) continue;
    issues.push(...diffTable(sourceTable, findTable(target, name)));
  }
  return issues;
}

export function hasBlocking(issues: readonly SchemaIssue[]): boolean {
  return issues.some(i => i.level === 'blocking');
}

export function countByLevel(
  issues: readonly SchemaIssue[]
): Record<IssueLevel, number> {
  const counts: Record<IssueLevel, number> = {
    blocking: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) counts[issue.level] += 1;
  return counts;
}
