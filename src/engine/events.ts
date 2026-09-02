/**
 * Le vocabulaire de l'exécution.
 *
 * Le moteur ne connaît ni React ni le store : il ÉMET. L'écran s'abonne, le
 * rapport se reconstitue à partir de la même suite d'événements, et un test
 * peut affirmer non seulement le résultat mais le chemin — l'ordre des tables,
 * la reprise après erreur, l'arrêt demandé.
 */

export type CopyEvent =
  | { type: 'run-start'; at: number; dryRun: boolean }
  | { type: 'table-start'; table: string; estimated?: number }
  | { type: 'table-progress'; table: string; read: number; written: number }
  | {
      type: 'table-done';
      table: string;
      read: number;
      written: number;
      durationMs: number;
    }
  | { type: 'table-skipped'; table: string; reason: string }
  | { type: 'table-error'; table: string; message: string }
  | { type: 'bucket-start'; bucket: string }
  | { type: 'bucket-created'; bucket: string }
  | { type: 'bucket-skipped'; bucket: string; reason: string }
  | { type: 'object-copied'; bucket: string; path: string; bytes: number }
  | { type: 'object-skipped'; bucket: string; path: string; reason: string }
  | { type: 'object-error'; bucket: string; path: string; message: string }
  | {
      type: 'bucket-done';
      bucket: string;
      objects: number;
      bytes: number;
      durationMs: number;
    }
  | { type: 'bucket-error'; bucket: string; message: string }
  | { type: 'run-done'; at: number; aborted: boolean };

export interface TableResult {
  table: string;
  read: number;
  written: number;
  durationMs: number;
  error?: string;
  skipped?: string;
}

export interface BucketResult {
  bucket: string;
  objects: number;
  bytes: number;
  errors: number;
  /** Fichiers déjà présents à la cible, laissés en place (`x-upsert: false`). */
  skippedObjects: number;
  created: boolean;
  durationMs: number;
  error?: string;
  skipped?: string;
}

export interface RunSummary {
  startedAt: number;
  finishedAt: number;
  dryRun: boolean;
  aborted: boolean;
  tables: TableResult[];
  buckets: BucketResult[];
  /** Compte total d'anomalies, tous objets confondus. */
  errorCount: number;
}

export function totalRows(summary: RunSummary): {
  read: number;
  written: number;
} {
  return summary.tables.reduce(
    (acc, t) => ({ read: acc.read + t.read, written: acc.written + t.written }),
    { read: 0, written: 0 }
  );
}

export function totalObjects(summary: RunSummary): {
  objects: number;
  bytes: number;
} {
  return summary.buckets.reduce(
    (acc, b) => ({
      objects: acc.objects + b.objects,
      bytes: acc.bytes + b.bytes,
    }),
    { objects: 0, bytes: 0 }
  );
}
