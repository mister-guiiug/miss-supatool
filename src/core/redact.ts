/**
 * Masquage des secrets dans tout ce qui est affiché, journalisé ou exporté.
 *
 * Le rapport de copie est fait pour être relu et transmis — on colle un
 * journal dans un ticket sans y penser. Or les URL et les messages d'erreur
 * d'une API embarquent volontiers la clé qui a servi. Elle est donc coupée
 * ici, à la frontière du texte, plutôt qu'à chaque site d'appel.
 */

/** JWT (`eyJ…`) et clés nommées (`sb_secret_…`, `sb_publishable_…`). */
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g,
];

/** Quatre derniers caractères conservés : de quoi reconnaître, pas de quoi s'en servir. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, match => maskKey(match));
  }
  return out;
}

/** Applique `redact` en profondeur — journal, rapport, export JSON. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(v => redactDeep(v)) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
