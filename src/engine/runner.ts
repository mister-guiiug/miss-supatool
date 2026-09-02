/**
 * L'orchestration : les tables dans l'ordre du plan, puis les seaux.
 *
 * Les tables d'abord, et ce n'est pas indifférent : une ligne peut désigner un
 * fichier (une colonne `avatar_path`), l'inverse n'arrive pas. Si la copie
 * s'arrête en route, une base qui référence des fichiers manquants se répare en
 * relançant la partie stockage ; des fichiers orphelins ne se rattachent à
 * rien.
 *
 * Une erreur de table n'interrompt la course que si l'utilisateur l'a demandé
 * (`stopOnError`). Sinon elle est consignée et la suivante commence : sur une
 * base réelle, une seule table refusée par la RLS ne devrait pas condamner les
 * quarante autres.
 */

import type { ProjectClient } from '../api/http.ts';
import type { CopyPlan, SourceBucket } from '../core/plan.ts';
import { describeError } from '../core/errors.ts';
import { copyTable } from './copyTables.ts';
import { copyBucket } from './copyStorage.ts';
import type {
  BucketResult,
  CopyEvent,
  RunSummary,
  TableResult,
} from './events.ts';

export interface RunCopyInput {
  source: ProjectClient;
  target: ProjectClient;
  plan: CopyPlan;
  sourceBuckets?: readonly SourceBucket[];
  schema?: string;
  countStrategy?: 'exact' | 'estimated';
  signal?: AbortSignal;
  emit: (event: CopyEvent) => void;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export async function runCopy(input: RunCopyInput): Promise<RunSummary> {
  const {
    source,
    target,
    plan,
    signal,
    emit,
    sourceBuckets = [],
    schema = 'public',
    countStrategy = 'estimated',
  } = input;

  const startedAt = Date.now();
  emit({ type: 'run-start', at: startedAt, dryRun: plan.options.dryRun });

  const tables: TableResult[] = [];
  const buckets: BucketResult[] = [];
  let aborted = false;

  for (const tablePlan of plan.tables) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    if (tablePlan.columns.length === 0) {
      const reason = 'aucune colonne commune avec la cible';
      emit({ type: 'table-skipped', table: tablePlan.table, reason });
      tables.push({
        table: tablePlan.table,
        read: 0,
        written: 0,
        durationMs: 0,
        skipped: reason,
      });
      continue;
    }

    try {
      const outcome = await copyTable(tablePlan, {
        source,
        target,
        options: plan.options,
        schema,
        countStrategy,
        ...(signal ? { signal } : {}),
        emit,
      });
      tables.push({ table: tablePlan.table, ...outcome });
      emit({
        type: 'table-done',
        table: tablePlan.table,
        read: outcome.read,
        written: outcome.written,
        durationMs: outcome.durationMs,
      });
    } catch (error) {
      if (isAbort(error) || signal?.aborted) {
        aborted = true;
        break;
      }
      const message = describeError(error);
      tables.push({
        table: tablePlan.table,
        read: 0,
        written: 0,
        durationMs: 0,
        error: message,
      });
      emit({ type: 'table-error', table: tablePlan.table, message });
      if (plan.options.stopOnError) break;
    }
  }

  if (plan.options.copyStorage && !aborted) {
    for (const bucketPlan of plan.buckets) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      emit({ type: 'bucket-start', bucket: bucketPlan.bucket });
      const sourceBucket = sourceBuckets.find(
        b => b.name === bucketPlan.bucket
      );
      try {
        const outcome = await copyBucket(bucketPlan, {
          source,
          target,
          options: plan.options,
          ...(sourceBucket ? { sourceBucket } : {}),
          ...(signal ? { signal } : {}),
          emit,
        });
        buckets.push({ bucket: bucketPlan.bucket, ...outcome });
        emit({
          type: 'bucket-done',
          bucket: bucketPlan.bucket,
          objects: outcome.objects,
          bytes: outcome.bytes,
          durationMs: outcome.durationMs,
        });
      } catch (error) {
        if (isAbort(error) || signal?.aborted) {
          aborted = true;
          break;
        }
        const message = describeError(error);
        buckets.push({
          bucket: bucketPlan.bucket,
          objects: 0,
          bytes: 0,
          errors: 1,
          skippedObjects: 0,
          created: false,
          durationMs: 0,
          error: message,
        });
        emit({ type: 'bucket-error', bucket: bucketPlan.bucket, message });
        if (plan.options.stopOnError) break;
      }
    }
  }

  if (signal?.aborted) aborted = true;

  const finishedAt = Date.now();
  emit({ type: 'run-done', at: finishedAt, aborted });

  const errorCount =
    tables.filter(t => t.error).length +
    buckets.reduce((acc, b) => acc + b.errors + (b.error ? 1 : 0), 0);

  return {
    startedAt,
    finishedAt,
    dryRun: plan.options.dryRun,
    aborted,
    tables,
    buckets,
    errorCount,
  };
}
