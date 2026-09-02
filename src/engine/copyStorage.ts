/**
 * Copie des fichiers d'un seau.
 *
 * Un fichier passe par le navigateur : on le télécharge depuis la source, on le
 * réémet vers la cible. C'est le prix d'une copie sans serveur — et la raison
 * pour laquelle la concurrence est réglable : quatre fichiers de front tiennent
 * sur une ligne domestique, seize la saturent et déclenchent la limitation de
 * débit.
 *
 * Un fichier DÉJÀ présent à la cible n'est pas une erreur. Sans le drapeau de
 * remplacement, l'API répond 409 : c'est un « laissé en place », compté à part,
 * et c'est ce qui rend une copie interrompue reprenable sans tout réémettre.
 */

import { ApiError, type ProjectClient } from '../api/http.ts';
import {
  createBucket,
  downloadObject,
  uploadObject,
  walkObjects,
  type StorageObject,
} from '../api/storage.ts';
import type { BucketPlan, CopyOptions, SourceBucket } from '../core/plan.ts';
import { describeError } from '../core/errors.ts';
import type { CopyEvent } from './events.ts';

export interface CopyBucketContext {
  source: ProjectClient;
  target: ProjectClient;
  options: CopyOptions;
  /** Réglages du seau à la source, repris à la création. */
  sourceBucket?: SourceBucket;
  signal?: AbortSignal;
  emit: (event: CopyEvent) => void;
}

export interface CopyBucketOutcome {
  objects: number;
  bytes: number;
  errors: number;
  skippedObjects: number;
  created: boolean;
  durationMs: number;
}

export async function copyBucket(
  plan: BucketPlan,
  context: CopyBucketContext
): Promise<CopyBucketOutcome> {
  const { source, target, options, signal, emit } = context;
  const startedAt = Date.now();

  let created = false;
  if (!plan.existsOnTarget) {
    if (!plan.willCreate) {
      emit({
        type: 'bucket-skipped',
        bucket: plan.bucket,
        reason: 'absent de la cible et création désactivée',
      });
      return {
        objects: 0,
        bytes: 0,
        errors: 0,
        skippedObjects: 0,
        created: false,
        durationMs: Date.now() - startedAt,
      };
    }
    if (!options.dryRun) {
      await createBucket(
        target,
        {
          name: plan.bucket,
          isPublic: plan.isPublic,
          fileSizeLimit: context.sourceBucket?.fileSizeLimit ?? null,
          allowedMimeTypes: context.sourceBucket?.allowedMimeTypes ?? null,
        },
        signal
      );
    }
    created = true;
    emit({ type: 'bucket-created', bucket: plan.bucket });
  }

  const iterator = walkObjects(source, plan.bucket, {
    ...(signal ? { signal } : {}),
  });

  let objects = 0;
  let bytes = 0;
  let errors = 0;
  let skippedObjects = 0;
  let fatal: unknown;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted || fatal) return;
      const next = await iterator.next();
      if (next.done) return;
      const object: StorageObject = next.value;
      try {
        if (options.dryRun) {
          bytes += object.size ?? 0;
        } else {
          const blob = await downloadObject(
            source,
            plan.bucket,
            object.path,
            signal
          );
          await uploadObject(target, plan.bucket, object.path, blob, {
            upsert: options.overwriteObjects,
            ...(object.mimeType ? { contentType: object.mimeType } : {}),
            ...(signal ? { signal } : {}),
          });
          bytes += blob.size;
        }
        objects += 1;
        emit({
          type: 'object-copied',
          bucket: plan.bucket,
          path: object.path,
          bytes: object.size ?? 0,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          skippedObjects += 1;
          emit({
            type: 'object-skipped',
            bucket: plan.bucket,
            path: object.path,
            reason: 'déjà présent à la cible',
          });
          continue;
        }
        errors += 1;
        emit({
          type: 'object-error',
          bucket: plan.bucket,
          path: object.path,
          message: describeError(error),
        });
        if (options.stopOnError) {
          fatal = error;
          return;
        }
      }
    }
  };

  const workers = Math.max(1, Math.min(options.concurrency, 16));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  // Le générateur garde une descente en cours : la fermer libère la requête de
  // listage restée en vol quand on s'arrête au milieu.
  await iterator.return(undefined);

  if (fatal) throw fatal;

  return {
    objects,
    bytes,
    errors,
    skippedObjects,
    created,
    durationMs: Date.now() - startedAt,
  };
}
