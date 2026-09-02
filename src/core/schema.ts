/**
 * Lecture du schéma d'un projet Supabase SANS accès SQL.
 *
 * PostgREST publie sa propre description OpenAPI (Swagger 2.0) à la racine de
 * `/rest/v1/`. C'est la seule source de vérité disponible depuis un navigateur :
 * l'API de management (`api.supabase.com`), elle, refuse le CORS depuis toute
 * origine autre que `supabase.com` — donc pas de `information_schema`, pas de
 * requête SQL arbitraire, pas de `pg_dump`. Ce fichier en tire ce dont la copie
 * a besoin : les tables, leurs colonnes, la clé primaire et les clés
 * étrangères, ces dernières servant à ordonner les insertions.
 *
 * Ce que le document ne dit PAS, et qu'on n'invente donc pas : les valeurs par
 * défaut, les contraintes CHECK, les index, les triggers et les politiques RLS.
 * Une colonne « obligatoire » ici veut dire NOT NULL *et* sans valeur par
 * défaut — c'est ainsi que PostgREST remplit `required`.
 */

export interface ColumnInfo {
  name: string;
  /** Type SQL tel que PostgREST le nomme (`format`) : `uuid`, `int8`, `text`… */
  type: string;
  /** NOT NULL et sans valeur par défaut : l'insertion doit la fournir. */
  required: boolean;
  primaryKey: boolean;
  /** Renseignée quand la colonne référence une autre table. */
  foreignKey?: ForeignKeyRef;
}

export interface ForeignKeyRef {
  /** Nom de la table cible, sans le schéma (`public.users` → `users`). */
  table: string;
  column: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /** Colonnes de la clé primaire, dans l'ordre du document. */
  primaryKey: string[];
  /**
   * `POST` est publié sur ce chemin. Une vue non modifiable ne l'est pas : on
   * peut la lire, pas y écrire — donc pas la recopier.
   */
  insertable: boolean;
}

export interface DatabaseSchema {
  tables: TableInfo[];
}

/** Marqueur de clé primaire dans la description d'une colonne. */
const PK_MARK = '<pk/>';
/** `<fk table='autres' column='id'/>` — la table peut être qualifiée du schéma. */
const FK_RE = /<fk\s+table='([^']+)'\s+column='([^']+)'\s*\/>/;

/** `public.users` → `users`. Le schéma n'entre pas dans le graphe des tables. */
export function stripSchema(qualified: string): string {
  const dot = qualified.lastIndexOf('.');
  return dot === -1 ? qualified : qualified.slice(dot + 1);
}

export function parseForeignKey(
  description: string
): ForeignKeyRef | undefined {
  const m = FK_RE.exec(description);
  if (!m) return undefined;
  const [, table, column] = m;
  if (!table || !column) return undefined;
  return { table: stripSchema(table), column };
}

interface SwaggerProperty {
  description?: unknown;
  format?: unknown;
  type?: unknown;
}

interface SwaggerDefinition {
  required?: unknown;
  properties?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convertit le document OpenAPI de PostgREST en schéma exploitable.
 *
 * Tolérant par construction : un document tronqué, une définition sans
 * propriétés ou un chemin inconnu produisent une table de moins, jamais une
 * exception — l'écran d'analyse sait afficher « aucune table trouvée » et
 * proposer la saisie manuelle, il ne sait pas afficher un plantage.
 */
export function parseOpenApiSchema(doc: unknown): DatabaseSchema {
  if (!isRecord(doc)) return { tables: [] };
  const definitions = isRecord(doc.definitions) ? doc.definitions : {};
  const paths = isRecord(doc.paths) ? doc.paths : {};

  const tables: TableInfo[] = [];
  for (const [name, rawDef] of Object.entries(definitions)) {
    if (!isRecord(rawDef)) continue;
    const def = rawDef as SwaggerDefinition;
    const properties = isRecord(def.properties) ? def.properties : {};
    const required = new Set(
      Array.isArray(def.required)
        ? def.required.filter((c): c is string => typeof c === 'string')
        : []
    );

    const columns: ColumnInfo[] = [];
    const primaryKey: string[] = [];
    for (const [columnName, rawProp] of Object.entries(properties)) {
      if (!isRecord(rawProp)) continue;
      const prop = rawProp as SwaggerProperty;
      const description =
        typeof prop.description === 'string' ? prop.description : '';
      const isPk = description.includes(PK_MARK);
      if (isPk) primaryKey.push(columnName);
      const type =
        typeof prop.format === 'string'
          ? prop.format
          : typeof prop.type === 'string'
            ? prop.type
            : 'unknown';
      const foreignKey = parseForeignKey(description);
      columns.push({
        name: columnName,
        type,
        required: required.has(columnName),
        primaryKey: isPk,
        ...(foreignKey ? { foreignKey } : {}),
      });
    }
    if (columns.length === 0) continue;

    const path = paths[`/${name}`];
    // Un chemin absent du document (PostgREST peut le masquer) n'est pas une
    // preuve d'immuabilité : on préfère laisser l'utilisateur essayer plutôt
    // que masquer une table réelle. Seule une entrée EXPLICITE sans `post`
    // marque la table comme non insérable.
    const insertable = isRecord(path) ? 'post' in path : true;

    tables.push({ name, columns, primaryKey, insertable });
  }

  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables };
}

export function findTable(
  schema: DatabaseSchema,
  name: string
): TableInfo | undefined {
  return schema.tables.find(t => t.name === name);
}

/** Colonnes copiables d'une table : toutes, la copie est fidèle par défaut. */
export function columnNames(table: TableInfo): string[] {
  return table.columns.map(c => c.name);
}
