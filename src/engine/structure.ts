/**
 * Relever la structure de la source, l'appliquer à la cible.
 *
 * Deux choix méritent d'être expliqués.
 *
 * **Le relevé est en lecture seule côté serveur** (`read_only: true`) : ce
 * n'est pas une politesse, c'est le prolongement de l'invariant de
 * `core/guard.ts` — la source n'est jamais modifiée, y compris quand on lui
 * parle en SQL.
 *
 * **L'application se fait instruction par instruction**, et non en un seul gros
 * script. C'est plus lent, mais c'est ce qui permet de dire précisément ce qui
 * a été créé et ce qui a échoué. Un script unique en transaction donnerait un
 * « tout ou rien » et un message d'erreur pour cent objets.
 *
 * Une **seconde passe** rejoue les échecs. Elle rattrape les dépendances qu'un
 * ordre statique ne peut pas connaître : une vue qui en lit une autre, une
 * fonction qui référence une table créée plus tard. Ce qui échoue deux fois est
 * une vraie erreur, et est rapporté comme telle.
 */

import type { ManagementClient } from '../api/management.ts';
import { describeError } from '../core/errors.ts';
import {
  EMPTY_ROWS,
  introspectionQueries,
  type Statement,
  type StructureRows,
} from '../core/structure.ts';

export interface ReadStructureOptions {
  schema: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Joue les requêtes d'introspection sur la source et rend les lignes brutes. */
export async function readStructure(
  client: ManagementClient,
  ref: string,
  options: ReadStructureOptions
): Promise<StructureRows> {
  const queries = introspectionQueries(options.schema);
  const rows: StructureRows = { ...EMPTY_ROWS };
  let done = 0;

  for (const query of queries) {
    const result = await client.runQuery<Record<string, unknown>>(
      ref,
      query.sql,
      {
        readOnly: true,
        ...(options.signal ? { signal: options.signal } : {}),
      }
    );
    // Le typage des lignes est déclaratif : le serveur rend ce que la requête
    // demande, colonne par colonne. Une conversion s'impose ici, et une seule.
    (rows as unknown as Record<string, unknown[]>)[query.key] = Array.isArray(
      result
    )
      ? result
      : [];
    done += 1;
    options.onProgress?.(done, queries.length);
  }

  return rows;
}

export type ApplyStatus = 'applied' | 'failed';

export interface ApplyResult {
  statement: Statement;
  status: ApplyStatus;
  message?: string;
  /** L'instruction a réussi lors de la seconde passe. */
  retried?: boolean;
}

export interface ApplyOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, current: Statement) => void;
  /** Rejouer une fois les instructions en échec (défaut : oui). */
  secondPass?: boolean;
  /** Simulation : rien n'est envoyé, tout est compté comme appliqué. */
  dryRun?: boolean;
}

export async function applyStatements(
  client: ManagementClient,
  ref: string,
  statements: readonly Statement[],
  options: ApplyOptions = {}
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  const failed: Statement[] = [];
  let done = 0;

  for (const statement of statements) {
    if (options.signal?.aborted) break;
    options.onProgress?.(done, statements.length, statement);
    if (options.dryRun) {
      results.push({ statement, status: 'applied' });
      done += 1;
      continue;
    }
    try {
      await client.runQuery(ref, statement.sql, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
      results.push({ statement, status: 'applied' });
    } catch (error) {
      results.push({
        statement,
        status: 'failed',
        message: describeError(error),
      });
      failed.push(statement);
    }
    done += 1;
  }

  if ((options.secondPass ?? true) && failed.length > 0 && !options.dryRun) {
    for (const statement of failed) {
      if (options.signal?.aborted) break;
      try {
        await client.runQuery(ref, statement.sql, {
          ...(options.signal ? { signal: options.signal } : {}),
        });
        const previous = results.find(r => r.statement === statement);
        if (previous) {
          previous.status = 'applied';
          previous.retried = true;
          delete previous.message;
        }
      } catch {
        // Deux échecs : le premier message, déjà consigné, reste le bon.
      }
    }
  }

  return results;
}

export function applySummary(results: readonly ApplyResult[]): {
  applied: number;
  failed: number;
  retried: number;
} {
  return {
    applied: results.filter(r => r.status === 'applied').length,
    failed: results.filter(r => r.status === 'failed').length,
    retried: results.filter(r => r.retried).length,
  };
}
