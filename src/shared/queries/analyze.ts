import type { DatabaseSchema } from '../../core/schema.ts';
import type { SourceBucket } from '../../core/plan.ts';
import { describeError } from '../../core/errors.ts';
import { fetchSchema } from '../../api/postgrest.ts';
import { listBuckets } from '../../api/storage.ts';
import type { ProjectClient } from '../../api/http.ts';
import { getQueryClient } from './client.ts';
import { queryKeys, tokenScope } from './keys.ts';

export interface AnalysisResult {
  sourceSchema: DatabaseSchema;
  targetSchema: DatabaseSchema;
  sourceBuckets: SourceBucket[];
  targetBucketNames: string[];
  storageError?: string;
}

export interface AnalysisScope {
  sourceUrl: string;
  targetUrl: string;
  schema: string;
  sourceKey: string;
  targetKey: string;
}

async function runAnalysis(
  source: ProjectClient,
  target: ProjectClient,
  schema: string
): Promise<AnalysisResult> {
  const [sourceSchema, targetSchema] = await Promise.all([
    fetchSchema(source, { schema }),
    fetchSchema(target, { schema }),
  ]);

  let sourceBuckets: SourceBucket[] = [];
  let targetBucketNames: string[] = [];
  let storageError: string | undefined;
  try {
    const [from, to] = await Promise.all([
      listBuckets(source),
      listBuckets(target),
    ]);
    sourceBuckets = from.map(bucket => ({
      name: bucket.name,
      isPublic: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? null,
      allowedMimeTypes: bucket.allowed_mime_types ?? null,
    }));
    targetBucketNames = to.map(bucket => bucket.name);
  } catch (error) {
    storageError = describeError(error);
  }

  return {
    sourceSchema,
    targetSchema,
    sourceBuckets,
    targetBucketNames,
    ...(storageError ? { storageError } : {}),
  };
}

/**
 * Analyse manuelle via le cache Query.
 * `staleTime: 0` : chaque déclenchement (bouton, post-structure) relit les
 * schémas — un résultat périmé bloquerait la copie après une création de tables.
 */
export async function fetchAnalysis(
  scope: AnalysisScope,
  source: ProjectClient,
  target: ProjectClient
): Promise<AnalysisResult> {
  const client = getQueryClient();
  return client.fetchQuery({
    queryKey: queryKeys.analysis({
      sourceUrl: scope.sourceUrl.trim(),
      targetUrl: scope.targetUrl.trim(),
      schema: scope.schema,
      sourceKeyScope: tokenScope(scope.sourceKey),
      targetKeyScope: tokenScope(scope.targetKey),
    }),
    queryFn: () => runAnalysis(source, target, scope.schema),
    staleTime: 0,
  });
}
