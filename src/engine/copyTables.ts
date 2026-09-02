/**
 * Copie des lignes, table par table.
 *
 * Une table se copie par pages : on lit, on écrit, on avance le curseur. Deux
 * points de vigilance sont traités ici et nulle part ailleurs.
 *
 * **Le repli du curseur.** La pagination par curseur suppose que la clé
 * primaire porte une valeur simple et non nulle. Quand ce n'est pas le cas —
 * clé composite, valeur JSON, NULL —, continuer au curseur redemanderait
 * éternellement la même page. On bascule alors sur le décalage, en le disant.
 *
 * **La simulation.** En mode simulation, tout est lu et compté, rien n'est
 * envoyé. C'est le mode par défaut : personne ne devrait écrire dans une base
 * sans avoir vu d'abord ce que l'outil compte y mettre.
 */

import type { ProjectClient } from '../api/http.ts';
import { countRows, readPage, writeRows } from '../api/postgrest.ts';
import { chunk, cursorValue, type PageCursor } from '../core/paging.ts';
import type { CopyOptions, TablePlan } from '../core/plan.ts';
import type { CopyEvent } from './events.ts';

export interface CopyTableContext {
  source: ProjectClient;
  target: ProjectClient;
  options: CopyOptions;
  schema: string;
  countStrategy: 'exact' | 'estimated';
  signal?: AbortSignal;
  emit: (event: CopyEvent) => void;
}

export interface CopyTableOutcome {
  read: number;
  written: number;
  durationMs: number;
}

/**
 * Un échec en cours de table, AVEC ce qui a déjà été fait.
 *
 * Sans elle, une table qui casse à la vingtième page est rapportée « 0 ligne
 * écrite » alors que dix mille sont passées : l'utilisateur relancerait une
 * copie en croyant repartir de zéro, et l'aurait cru même en lisant le
 * rapport. La cause d'origine reste attachée (`cause`) pour que le message et
 * la détection d'annulation continuent de fonctionner.
 */
export class CopyTableError extends Error {
  table: string;
  read: number;
  written: number;
  durationMs: number;

  constructor(table: string, partial: CopyTableOutcome, cause: unknown) {
    super(`Échec pendant la copie de « ${table} »`, { cause });
    this.name = 'CopyTableError';
    this.table = table;
    this.read = partial.read;
    this.written = partial.written;
    this.durationMs = partial.durationMs;
  }
}

export async function copyTable(
  plan: TablePlan,
  context: CopyTableContext
): Promise<CopyTableOutcome> {
  const { source, target, options, schema, signal, emit } = context;
  const startedAt = Date.now();

  let estimated: number | undefined;
  try {
    estimated = await countRows(source, plan.table, {
      strategy: context.countStrategy,
      schema,
      ...(signal ? { signal } : {}),
    });
  } catch {
    // Un compte indisponible (droits, table volumineuse) n'empêche pas de
    // copier : on perd la barre de progression, pas la copie.
    estimated = undefined;
  }
  emit({
    type: 'table-start',
    table: plan.table,
    ...(estimated !== undefined ? { estimated } : {}),
  });

  let read = 0;
  let written = 0;
  let offset = 0;
  let cursor: PageCursor | undefined;
  let useCursor = plan.strategy === 'keyset' && plan.orderBy.length === 1;

  try {
    for (;;) {
      if (signal?.aborted) break;

      const rows = await readPage(source, plan.table, {
        columns: plan.columns,
        orderBy: plan.orderBy,
        limit: options.pageSize,
        ...(useCursor ? (cursor ? { after: cursor } : {}) : { offset }),
        schema,
        ...(signal ? { signal } : {}),
      });
      if (rows.length === 0) break;
      read += rows.length;

      if (!options.dryRun) {
        for (const batch of chunk(rows, options.batchSize)) {
          if (signal?.aborted) break;
          await writeRows(target, plan.table, batch, {
            mode: plan.mode,
            ...(plan.onConflict ? { onConflict: plan.onConflict } : {}),
            schema,
            ...(signal ? { signal } : {}),
          });
          written += batch.length;
        }
      }

      emit({ type: 'table-progress', table: plan.table, read, written });

      if (rows.length < options.pageSize) break;

      if (useCursor) {
        const last = rows[rows.length - 1];
        const column = plan.orderBy[0];
        const next = last && column ? cursorValue(last, column) : null;
        if (next === null) {
          // Repli explicite : on repart en décalage là où on en est.
          useCursor = false;
          offset = read;
        } else {
          cursor = { column: column ?? '', value: next };
        }
      } else {
        offset = read;
      }
    }
  } catch (error) {
    throw new CopyTableError(
      plan.table,
      { read, written, durationMs: Date.now() - startedAt },
      error
    );
  }

  return { read, written, durationMs: Date.now() - startedAt };
}
