/**
 * Le relais vers l'API de management de Supabase.
 *
 * `api.supabase.com` n'accorde le CORS qu'à `https://supabase.com` — vérifié le
 * 02/09/2026 : la réponse au préflet ne porte aucun `Access-Control-Allow-Origin`
 * pour toute autre origine. Créer un projet et exécuter du DDL sont donc
 * INJOIGNABLES depuis une page web, et aucun réglage côté client n'y change
 * rien. Il faut un intermédiaire.
 *
 * Celui-ci est délibérément minuscule et sans état : il ne stocke rien, ne
 * journalise rien, et se contente de relayer. Trois verrous le rendent
 * inoffensif s'il est découvert :
 *
 * 1. **La cible est fixe.** Aucun paramètre ne choisit l'hôte : ce n'est pas un
 *    proxy ouvert, c'est un tuyau vers une seule API.
 * 2. **Les chemins sont sur liste blanche**, méthode comprise. Le relais ne sait
 *    pas supprimer un projet, même si on le lui demande.
 * 3. **L'origine est obligatoire et sur liste blanche**, en refus par défaut :
 *    une liste vide n'autorise personne. Une requête sans en-tête `Origin`
 *    (curl, un serveur) est refusée — ce qui ferme l'usage du relais comme
 *    anonymiseur.
 *
 * Le jeton d'accès personnel ne fait que traverser : il n'est ni lu, ni
 * conservé, ni recopié ailleurs que dans la requête sortante.
 */

export interface ProxyEnv {
  /** Origines autorisées, séparées par des virgules. Vide = personne. */
  ALLOWED_ORIGINS?: string;
}

/** L'unique cible. Elle n'est pas configurable, et c'est le point. */
export const UPSTREAM = 'https://api.supabase.com';

interface Rule {
  method: string;
  pattern: RegExp;
}

/**
 * Ce que le relais accepte de transmettre — et rien d'autre.
 *
 * Aucune règle `DELETE` ni `PATCH` : l'application crée et lit, elle ne détruit
 * pas. Le jour où elle en aurait besoin, la ligne manquante ici est un garde-fou
 * délibéré, pas un oubli.
 */
const RULES: Rule[] = [
  { method: 'GET', pattern: /^\/v1\/organizations$/ },
  { method: 'GET', pattern: /^\/v1\/projects$/ },
  { method: 'POST', pattern: /^\/v1\/projects$/ },
  { method: 'GET', pattern: /^\/v1\/projects\/available-regions$/ },
  { method: 'GET', pattern: /^\/v1\/projects\/[a-z0-9-]{8,40}$/ },
  { method: 'GET', pattern: /^\/v1\/projects\/[a-z0-9-]{8,40}\/api-keys$/ },
  {
    method: 'POST',
    pattern: /^\/v1\/projects\/[a-z0-9-]{8,40}\/database\/query$/,
  },
];

export function isAllowedPath(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return RULES.some(rule => rule.method === upper && rule.pattern.test(path));
}

/**
 * Analyse `ALLOWED_ORIGINS`. **En refus par défaut** : une variable absente,
 * vide, ou remplie d'espaces ne donne PAS un joker, elle donne la liste vide.
 * Une erreur de configuration ferme le relais au lieu de l'ouvrir à tous.
 */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin !== '');
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function refuse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Le cœur portable : des types Web standard uniquement, donc valable en
 * Cloudflare Worker, Deno Deploy, Netlify, Vercel Edge — ou dans un test.
 */
export async function handleProxy(
  request: Request,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const allowed = parseOrigins(env.ALLOWED_ORIGINS);
  const origin = request.headers.get('origin');

  // Origine obligatoire ET connue, dans cet ordre : sans en-tête `Origin`, la
  // requête ne vient pas d'une page — elle ne peut donc pas être un usage
  // légitime de ce relais.
  if (!origin) return refuse(403, 'En-tête Origin absent : requête refusée.');
  if (!allowed.includes(origin)) {
    return refuse(403, 'Origine non autorisée.');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);
  // Le chemin relayé voyage dans `?path=`, pour que le relais puisse vivre
  // sous n'importe quel préfixe (racine d'un Worker, sous-chemin d'un site).
  const path = url.searchParams.get('path');
  if (!path || !path.startsWith('/v1/')) {
    return refuse(400, 'Paramètre « path » absent ou hors périmètre.');
  }
  const [pathname = ''] = path.split('?');
  if (!isAllowedPath(request.method, pathname)) {
    return refuse(
      403,
      `Chemin non autorisé par ce relais : ${request.method} ${pathname}`
    );
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return refuse(401, 'Jeton d’accès absent.');
  }

  const headers: Record<string, string> = {
    authorization,
    accept: 'application/json',
  };
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const upstream = await fetchImpl(`${UPSTREAM}${path}`, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : await request.text(),
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'application/json',
      ...corsHeaders(origin),
    },
  });
}
