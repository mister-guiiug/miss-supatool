/**
 * Invariant : la SOURCE n'est jamais écrite.
 *
 * C'est la promesse qui rend l'outil utilisable sur une base de production. Une
 * promesse tenue par une revue de code s'effrite au premier ajout de
 * fonctionnalité ; celle-ci est tenue par le transport lui-même — le client
 * HTTP de la source passe chaque requête par ici et refuse tout ce qui n'est
 * pas une lecture, avant l'envoi.
 *
 * L'exception est nécessaire et étroite : l'API Storage liste le contenu d'un
 * seau par un `POST /storage/v1/object/list/{seau}` (le filtre voyage dans le
 * corps). C'est le SEUL POST autorisé. `rpc` est refusé sans examen : une
 * fonction Postgres peut écrire, et rien dans l'URL ne le dit.
 */

export class SourceWriteError extends Error {
  constructor(method: string, path: string) {
    super(
      `Écriture refusée sur le projet source (${method} ${path}). Miss Supatool ne modifie jamais la source.`
    );
    this.name = 'SourceWriteError';
  }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STORAGE_LIST = /^\/storage\/v1\/object\/list\//;

/** Cette requête est-elle une lecture, au sens de l'invariant ci-dessus ? */
export function isReadOnlyRequest(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  if (READ_METHODS.has(upper)) return true;
  return upper === 'POST' && STORAGE_LIST.test(path);
}

/** Lève `SourceWriteError` si la requête écrirait sur la source. */
export function assertReadOnly(method: string, path: string): void {
  if (!isReadOnlyRequest(method, path)) {
    throw new SourceWriteError(method.toUpperCase(), path);
  }
}
