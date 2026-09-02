/**
 * Ce qu'on peut savoir d'une connexion AVANT le premier appel réseau.
 *
 * Deux erreurs coûtent cher et se détectent hors ligne : coller une clé
 * publique (`anon`) là où il faut la clé de service — la copie ne verrait alors
 * que ce que la RLS laisse voir, c'est-à-dire souvent rien, sans erreur —, et
 * désigner deux fois le MÊME projet, ce qui réécrit la source sur elle-même.
 *
 * Les clés Supabase existent sous deux formes : le JWT historique (`eyJ…`, dont
 * la charge utile porte `role` et `ref`) et les clés d'API nommées
 * (`sb_secret_…`, `sb_publishable_…`). Les deux sont reconnues. La signature
 * n'est PAS vérifiée : on lit une étiquette pour prévenir l'utilisateur, on
 * n'accorde aucun droit — c'est le serveur qui tranche.
 */

/**
 * `service_role` est la clé historique (un JWT) ; `secret` est son équivalent
 * nouveau format (`sb_secret_…`). Les deux ouvrent la base, mais elles sont
 * distinguées ici parce qu'elles ne sont PAS interchangeables en pratique :
 * une clé `sb_secret_…` n'a pas fonctionné sur un projet neuf, là où la clé
 * `service_role` du même projet fonctionnait.
 */
export type KeyRole =
  'service_role' | 'secret' | 'anon' | 'publishable' | 'unknown';

export interface KeyInfo {
  role: KeyRole;
  /** Référence du projet annoncée par la clé, quand elle en porte une. */
  ref?: string;
  /** Date d'expiration (JWT `exp`), en millisecondes. */
  expiresAt?: number;
}

/** Décode une charge utile JWT en base64url, sans vérifier la signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const payload = parts[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function inspectKey(rawKey: string): KeyInfo {
  const key = rawKey.trim();
  if (key.startsWith('sb_secret_')) return { role: 'secret' };
  if (key.startsWith('sb_publishable_')) return { role: 'publishable' };

  const payload = decodeJwtPayload(key);
  if (!payload) return { role: 'unknown' };
  const role = typeof payload.role === 'string' ? payload.role : undefined;
  const ref = typeof payload.ref === 'string' ? payload.ref : undefined;
  const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  return {
    role:
      role === 'service_role'
        ? 'service_role'
        : role === 'anon'
          ? 'anon'
          : 'unknown',
    ...(ref ? { ref } : {}),
    ...(exp ? { expiresAt: exp } : {}),
  };
}

export interface NormalizedUrl {
  /** URL de base, sans barre oblique finale (`https://abc.supabase.co`). */
  base: string;
  /** Référence du projet, quand le domaine la porte. */
  ref?: string;
}

/**
 * Normalise l'URL saisie. Accepte un `ref` nu (`abcdefghijklmnop`), une URL
 * complète, avec ou sans schéma, avec ou sans chemin `/rest/v1` collé par
 * mégarde depuis le tableau de bord.
 */
export function normalizeProjectUrl(raw: string): NormalizedUrl | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // Une référence de projet nue : 20 lettres minuscules chez Supabase.
  if (/^[a-z]{16,32}$/.test(trimmed)) {
    return { base: `https://${trimmed}.supabase.co`, ref: trimmed };
  }

  // Un schéma déjà présent est respecté ; s'il n'est pas http(s), on refuse au
  // lieu de préfixer — `https://` collé devant `ftp://exemple.fr` produirait
  // l'hôte « ftp », c'est-à-dire une connexion silencieusement fausse.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return undefined;
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const base = `${url.protocol}//${url.host}`;
  const match = /^([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(url.hostname);
  const ref = match?.[1];
  return ref ? { base, ref } : { base };
}

export interface ConnectionDraft {
  url: string;
  key: string;
}

export interface ConnectionCheck {
  ok: boolean;
  /** Messages bloquants : la connexion ne peut pas servir. */
  errors: string[];
  /** Messages non bloquants : la connexion peut servir, mais mal. */
  warnings: string[];
  normalized?: { base: string; ref?: string; key: string; keyInfo: KeyInfo };
}

export function checkConnection(
  draft: ConnectionDraft,
  role: 'source' | 'target',
  now = Date.now()
): ConnectionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const normalized = normalizeProjectUrl(draft.url);
  if (!normalized) {
    errors.push(
      "L'URL du projet est illisible (attendu : https://xxxx.supabase.co)."
    );
  }

  const key = draft.key.trim();
  if (key === '') {
    errors.push('La clé est vide.');
  }

  const keyInfo = inspectKey(key);
  if (keyInfo.role === 'anon' || keyInfo.role === 'publishable') {
    warnings.push(
      role === 'source'
        ? "Cette clé est PUBLIQUE (anon) : la lecture passera par la RLS et ne verra qu'une partie des lignes, sans le dire. Utilisez la clé « service_role »."
        : "Cette clé est PUBLIQUE (anon) : l'écriture sera refusée par la RLS sur la plupart des tables. Utilisez la clé « service_role »."
    );
  } else if (keyInfo.role === 'secret') {
    warnings.push(
      "Clé « secrète » nouveau format (sb_secret_…). Elle ouvre bien la base, mais elle n'est pas acceptée partout où l'ancienne l'est : si les appels échouent, prenez la clé « service_role » du même projet (Settings → API)."
    );
  } else if (keyInfo.role === 'unknown') {
    warnings.push(
      "Impossible de lire le rôle de cette clé : vérifiez qu'il s'agit bien d'une clé d'API de projet (Settings → API)."
    );
  }
  if (keyInfo.expiresAt !== undefined && keyInfo.expiresAt < now) {
    errors.push('Cette clé a expiré.');
  }
  if (
    normalized?.ref &&
    keyInfo.ref !== undefined &&
    keyInfo.ref !== normalized.ref
  ) {
    errors.push(
      `La clé appartient au projet « ${keyInfo.ref} », pas à « ${normalized.ref} ».`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...(normalized && key !== ''
      ? {
          normalized: {
            base: normalized.base,
            ...(normalized.ref ? { ref: normalized.ref } : {}),
            key,
            keyInfo,
          },
        }
      : {}),
  };
}

/**
 * Le garde-fou le plus important de l'outil : refuser une copie d'un projet
 * vers lui-même. Compare les URL normalisées — une différence de casse, de
 * barre finale ou de schéma ne suffit pas à faire deux projets.
 */
export function isSameProject(sourceUrl: string, targetUrl: string): boolean {
  const a = normalizeProjectUrl(sourceUrl);
  const b = normalizeProjectUrl(targetUrl);
  if (!a || !b) return false;
  return a.base.toLowerCase() === b.base.toLowerCase();
}
