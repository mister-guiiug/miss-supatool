/**
 * Un `fetch` de laboratoire.
 *
 * Le moteur reçoit son `fetch` par injection : les tests peuvent donc éprouver
 * la pagination, les reprises, l'invariant de lecture seule et l'ordre des
 * appels sans réseau, sans serveur factice et sans attendre.
 *
 * `calls` garde la trace de TOUT ce qui est parti — c'est ce qui permet
 * d'affirmer qu'aucune écriture n'a été envoyée à la source, ou qu'une
 * simulation n'a rien envoyé du tout.
 */

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  /** Corps brut, quand le test veut autre chose que du JSON. */
  text?: string;
  headers?: Record<string, string>;
}

export type Handler = (call: RecordedCall) => FakeResponse | undefined;

export interface FakeFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Requêtes dont la méthode n'est ni GET ni HEAD. */
  writes: RecordedCall[];
}

function headersToObject(
  init: HeadersInit | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createFakeFetch(handlers: Handler[]): FakeFetch {
  const calls: RecordedCall[] = [];

  const impl = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const parsed = new URL(url);
    const call: RecordedCall = {
      method,
      url,
      path: `${parsed.pathname}${parsed.search}`,
      headers: headersToObject(init?.headers),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    };
    calls.push(call);

    for (const handler of handlers) {
      const result = handler(call);
      if (!result) continue;
      const body =
        result.text !== undefined
          ? result.text
          : result.body === undefined
            ? ''
            : JSON.stringify(result.body);
      return new Response(body, {
        status: result.status ?? 200,
        headers: {
          'content-type': 'application/json',
          ...(result.headers ?? {}),
        },
      });
    }

    return new Response(JSON.stringify({ message: 'no handler' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    fetch: impl,
    calls,
    get writes() {
      return calls.filter(c => c.method !== 'GET' && c.method !== 'HEAD');
    },
  };
}

/** Fabrique un lot de lignes `{ id, label }` pour les tests de pagination. */
export function rows(from: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: from + i,
    label: `ligne ${from + i}`,
  }));
}
