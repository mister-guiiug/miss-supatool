/**
 * Écrire du SQL sans se faire piéger par les noms et les valeurs.
 *
 * Tout ce qui vient de la base source — noms de tables, libellés d'énumération,
 * expressions par défaut — est du texte arbitraire. Un guillemet dans un nom,
 * une apostrophe dans un libellé, et l'instruction produite ne veut plus dire
 * ce qu'on croit. Le quoting est donc fait ici, une fois, et éprouvé.
 */

/** `ma table` → `"ma table"`. Un guillemet interne est doublé. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `public`, `clients` → `"public"."clients"`. */
export function qualify(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

/** `l'été` → `'l''été'`. `null` → `NULL`. */
export function quoteLiteral(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Rend une instruction REJOUABLE en avalant l'erreur « existe déjà ».
 *
 * Postgres n'offre pas de `IF NOT EXISTS` pour une contrainte, une politique
 * ni un type : sans cela, relancer la copie de structure sur une base à moitié
 * faite échouerait à la première instruction déjà appliquée — c'est-à-dire au
 * pire moment, celui d'une reprise après incident.
 *
 * Le délimiteur est étiqueté (`$supatool$`) et non `$$` : une expression de
 * contrainte ou un corps de politique peut contenir `$$`, ce qui refermerait le
 * bloc au milieu de l'instruction.
 */
export function tolerateDuplicate(statement: string): string {
  const body = statement.trim().replace(/;$/, '');
  return [
    'do $supatool$ begin',
    `  ${body};`,
    'exception',
    '  when duplicate_object then null;',
    '  when duplicate_table then null;',
    '  when duplicate_column then null;',
    'end $supatool$;',
  ].join('\n');
}

/**
 * Lit un tableau Postgres, quelle que soit la forme sous laquelle il revient.
 *
 * L'API de management sérialise les résultats en JSON, mais un `text[]` peut
 * arriver soit en tableau JSON, soit en littéral Postgres (`{anon,authenticated}`)
 * selon la colonne et la version. Les deux sont acceptés plutôt que d'en
 * supposer une.
 */
export function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return trimmed === '' ? [] : [trimmed];
  }
  const inner = trimmed.slice(1, -1);
  if (inner === '') return [];

  const items: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map(item => item.trim()).filter(item => item !== '');
}
