/**
 * Le plan de copie : tout ce qui sera fait, décidé AVANT de le faire.
 *
 * Séparer le plan de son exécution n'est pas une élégance d'architecture. C'est
 * ce qui rend l'outil relisible : l'écran de vérification montre le plan, la
 * simulation l'exécute sans écrire, et les tests le construisent sans réseau.
 * Une décision prise au milieu d'une boucle d'écriture, elle, n'est vérifiable
 * qu'en production.
 */

import type { DatabaseSchema, TableInfo } from './schema.ts';
import { findTable } from './schema.ts';
import { commonColumns, diffSchemas, type SchemaIssue } from './diff.ts';
import { orderTables, type OrderResult } from './order.ts';
import { pagingStrategy, type PagingStrategy } from './paging.ts';

export type WriteMode = 'insert' | 'upsert';

export interface CopyOptions {
  /**
   * `insert` refuse une ligne déjà présente (409) ; `upsert` la remplace.
   * `upsert` est le défaut : il rend la copie REJOUABLE, ce qui est la seule
   * façon honnête de reprendre après une interruption.
   */
  mode: WriteMode;
  /** Simulation : tout est lu et compté, rien n'est écrit. */
  dryRun: boolean;
  /** Lignes lues par requête. */
  pageSize: number;
  /** Lignes écrites par requête. */
  batchSize: number;
  /** Arrêter à la première erreur, ou poursuivre et tout rapporter à la fin. */
  stopOnError: boolean;
  copyStorage: boolean;
  createMissingBuckets: boolean;
  /** Remplacer un fichier déjà présent à la cible (`x-upsert`). */
  overwriteObjects: boolean;
  /** Fichiers copiés en parallèle. */
  concurrency: number;
  /**
   * Colonnes écartées de la copie, quelle que soit la table.
   *
   * Deux cas réels l'exigent, et aucun ne se déduit du document OpenAPI, qui
   * ne dit rien des colonnes GÉNÉRÉES ni des valeurs par défaut : une colonne
   * `GENERATED ALWAYS` refuse toute valeur (400 à chaque lot), et une colonne
   * remplie par un trigger de la cible (`updated_at`, vecteur de recherche)
   * n'a pas à recevoir la valeur de la source. Les colonnes de clé primaire
   * ne sont jamais écartées : elles portent l'identité des lignes.
   */
  excludedColumns: string[];
}

export const DEFAULT_OPTIONS: CopyOptions = {
  mode: 'upsert',
  dryRun: true,
  pageSize: 1000,
  batchSize: 500,
  stopOnError: true,
  copyStorage: true,
  createMissingBuckets: true,
  overwriteObjects: false,
  concurrency: 4,
  excludedColumns: [],
};

export interface TablePlan {
  table: string;
  /** Colonnes envoyées : l'intersection des deux schémas. */
  columns: string[];
  primaryKey: string[];
  orderBy: string[];
  strategy: PagingStrategy;
  mode: WriteMode;
  /** Cible du conflit pour l'upsert (`on_conflict`). */
  onConflict?: string;
  estimatedRows?: number;
  warnings: string[];
}

export interface BucketPlan {
  bucket: string;
  /** Le seau est-il public à la source ? La cible reprendra ce réglage. */
  isPublic: boolean;
  existsOnTarget: boolean;
  willCreate: boolean;
  estimatedObjects?: number;
  estimatedBytes?: number;
  warnings: string[];
}

export interface SourceBucket {
  name: string;
  isPublic: boolean;
  fileSizeLimit?: number | null;
  allowedMimeTypes?: string[] | null;
}

export interface CopyPlan {
  tables: TablePlan[];
  buckets: BucketPlan[];
  order: OrderResult;
  issues: SchemaIssue[];
  options: CopyOptions;
}

function planTable(
  source: TableInfo,
  target: TableInfo | undefined,
  options: CopyOptions
): TablePlan {
  const warnings: string[] = [];
  const primaryKey = source.primaryKey;
  const excluded = new Set(
    options.excludedColumns
      .map(name => name.trim())
      .filter(name => name !== '' && !primaryKey.includes(name))
  );
  const shared = target ? commonColumns(source, target) : [];
  const columns = shared.filter(name => !excluded.has(name));
  const dropped = shared.filter(name => excluded.has(name));
  if (dropped.length > 0) {
    warnings.push(
      `Colonne(s) écartée(s) : ${dropped.join(', ')} — la cible posera sa valeur par défaut.`
    );
  }

  let mode = options.mode;
  if (mode === 'upsert' && primaryKey.length === 0) {
    // Sans clé primaire, PostgREST n'a aucune cible de conflit : la demande
    // d'upsert serait refusée. On retombe sur l'insertion, et on le DIT — une
    // relance créera des doublons, l'utilisateur doit le savoir avant.
    mode = 'insert';
    warnings.push(
      'Pas de clé primaire : mise à jour impossible, les lignes seront insérées. Relancer la copie créerait des doublons.'
    );
  }
  if (primaryKey.length > 1) {
    warnings.push(
      `Clé primaire composite (${primaryKey.join(', ')}) : la lecture se fait par décalage, plus lente et sensible aux écritures concurrentes à la source.`
    );
  }
  if (columns.length === 0 && target) {
    warnings.push('Aucune colonne commune : rien à copier.');
  }

  return {
    table: source.name,
    columns,
    primaryKey,
    orderBy: primaryKey,
    strategy: pagingStrategy(primaryKey),
    mode,
    ...(mode === 'upsert' && primaryKey.length > 0
      ? { onConflict: primaryKey.join(',') }
      : {}),
    warnings,
  };
}

export interface BuildPlanInput {
  sourceSchema: DatabaseSchema;
  targetSchema: DatabaseSchema;
  selectedTables: readonly string[];
  sourceBuckets: readonly SourceBucket[];
  selectedBuckets: readonly string[];
  targetBucketNames: readonly string[];
  options: CopyOptions;
}

export function buildCopyPlan(input: BuildPlanInput): CopyPlan {
  const {
    sourceSchema,
    targetSchema,
    selectedTables,
    sourceBuckets,
    selectedBuckets,
    targetBucketNames,
    options,
  } = input;

  const order = orderTables(sourceSchema, selectedTables);
  const issues = diffSchemas(sourceSchema, targetSchema, selectedTables);

  // L'ordre topologique commande la liste : le plan se lit dans l'ordre où il
  // s'exécutera, ce qui est aussi l'ordre du journal.
  const tables: TablePlan[] = [];
  for (const name of order.order) {
    const sourceTable = findTable(sourceSchema, name);
    if (!sourceTable) continue;
    tables.push(planTable(sourceTable, findTable(targetSchema, name), options));
  }

  const targetBuckets = new Set(targetBucketNames);
  const buckets: BucketPlan[] = [];
  if (options.copyStorage) {
    for (const name of selectedBuckets) {
      const bucket = sourceBuckets.find(b => b.name === name);
      if (!bucket) continue;
      const existsOnTarget = targetBuckets.has(name);
      const warnings: string[] = [];
      if (!existsOnTarget && !options.createMissingBuckets) {
        warnings.push(
          `Le seau « ${name} » n'existe pas à la cible et la création est désactivée : il sera ignoré.`
        );
      }
      if (bucket.isPublic) {
        warnings.push(
          `« ${name} » est PUBLIC à la source ; il sera créé public à la cible.`
        );
      }
      buckets.push({
        bucket: name,
        isPublic: bucket.isPublic,
        existsOnTarget,
        willCreate: !existsOnTarget && options.createMissingBuckets,
        warnings,
      });
    }
  }

  return { tables, buckets, order, issues, options };
}

/** Tables réellement copiables : celles qui ont au moins une colonne commune. */
export function copyableTables(plan: CopyPlan): TablePlan[] {
  return plan.tables.filter(t => t.columns.length > 0);
}

export function planWarnings(plan: CopyPlan): string[] {
  const warnings: string[] = [];
  for (const table of plan.tables) {
    for (const warning of table.warnings) {
      warnings.push(`${table.table} — ${warning}`);
    }
  }
  for (const bucket of plan.buckets) {
    for (const warning of bucket.warnings) {
      warnings.push(`${bucket.bucket} — ${warning}`);
    }
  }
  for (const cycle of plan.order.cycles) {
    warnings.push(
      `Cycle de clés étrangères : ${cycle.join(' ↔ ')}. Aucun ordre ne satisfait les contraintes ; certaines lignes peuvent être refusées.`
    );
  }
  for (const table of plan.order.selfReferencing) {
    warnings.push(
      `${table} — se référence elle-même : une ligne peut arriver avant son parent. Copie en deux passes recommandée si des lignes sont refusées.`
    );
  }
  for (const dep of plan.order.externalDependencies) {
    warnings.push(
      `${dep.table} — dépend de « ${dep.dependsOn} », qui n'est pas sélectionnée : les lignes référençant une valeur absente seront refusées.`
    );
  }
  return warnings;
}
