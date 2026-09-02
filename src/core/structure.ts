/**
 * Relever la structure d'une base, et la rejouer sur une autre.
 *
 * La description OpenAPI de PostgREST (`schema.ts`) suffit à copier des
 * DONNÉES : elle donne les colonnes et les clés. Elle ne dit rien des valeurs
 * par défaut, des contraintes CHECK, des index, des politiques RLS, des
 * fonctions ni des déclencheurs — donc rien de ce qu'il faut pour CRÉER la
 * base. Dès qu'on dispose de l'API de management (donc du SQL, donc du relais),
 * on peut faire beaucoup mieux : demander à Postgres de décrire lui-même ses
 * objets.
 *
 * C'est le principe de ce fichier. Les parties délicates — définition exacte
 * d'une contrainte, d'un index, d'une vue, d'une fonction, d'un déclencheur —
 * ne sont pas reconstruites à la main : `pg_get_constraintdef`,
 * `pg_get_indexdef`, `pg_get_viewdef`, `pg_get_functiondef` et
 * `pg_get_triggerdef` les rendent déjà, exactes, telles que Postgres les
 * réécrirait. On ne recompose que ce qu'aucune fonction ne rend : la liste des
 * colonnes d'un `CREATE TABLE`.
 *
 * Tout est PUR : ces fonctions transforment des lignes en instructions. Les
 * lignes viennent du réseau, les instructions y repartent, mais rien ici ne
 * sait ce qu'est une requête HTTP — c'est ce qui rend la génération vérifiable
 * par des tests.
 */

import {
  parsePgArray,
  qualify,
  quoteIdentifier,
  quoteLiteral,
  tolerateDuplicate,
} from './sql.ts';

export type StructurePhase =
  | 'extension'
  | 'type'
  | 'sequence'
  | 'function'
  | 'table'
  | 'constraint'
  | 'index'
  | 'view'
  | 'trigger'
  | 'rls'
  | 'policy'
  | 'grant';

export const PHASE_LABELS: Record<StructurePhase, string> = {
  extension: 'Extensions',
  type: 'Types énumérés',
  sequence: 'Séquences',
  function: 'Fonctions',
  table: 'Tables',
  constraint: 'Contraintes',
  index: 'Index',
  view: 'Vues',
  trigger: 'Déclencheurs',
  rls: 'Sécurité au niveau ligne',
  policy: 'Politiques',
  grant: 'Droits',
};

/**
 * L'ordre d'application.
 *
 * Les fonctions passent AVANT les tables : une valeur par défaut peut en
 * appeler une (`default ma_fonction()`), et Postgres ne valide pas le corps
 * d'une fonction plpgsql à sa création — l'inverse ne marcherait pas. Les
 * séquences aussi, pour les `default nextval(…)`. Ce qui reste indécidable
 * (une vue qui en lit une autre) est rattrapé par la seconde passe de
 * l'exécuteur.
 */
export const PHASE_ORDER: StructurePhase[] = [
  'extension',
  'type',
  'sequence',
  'function',
  'table',
  'constraint',
  'index',
  'view',
  'trigger',
  'rls',
  'policy',
  'grant',
];

export interface Statement {
  phase: StructurePhase;
  /** Ce que l'instruction crée, tel qu'affiché à l'écran. */
  object: string;
  sql: string;
}

/* ------------------------------------------------------------------ *
 * Les requêtes d'introspection
 * ------------------------------------------------------------------ */

export interface IntrospectionQuery {
  key: keyof StructureRows;
  phase: StructurePhase | 'meta';
  sql: string;
}

/**
 * Les requêtes à jouer sur la SOURCE, en lecture seule.
 *
 * Elles sont bornées au schéma choisi, et écartent systématiquement ce qui
 * appartient à une extension (`pg_depend` / `deptype = 'e'`) : recréer les
 * objets internes de `pg_graphql` ou de `pgcrypto` reviendrait à les dupliquer,
 * alors que `create extension` les réinstalle tout seul.
 */
export function introspectionQueries(schema: string): IntrospectionQuery[] {
  const s = quoteLiteral(schema);
  return [
    {
      key: 'extensions',
      phase: 'extension',
      sql: `select e.extname as name, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname <> 'plpgsql'
order by e.extname`,
    },
    {
      key: 'enums',
      phase: 'type',
      sql: `select t.typname as name, n.nspname as schema,
       array_agg(e.enumlabel order by e.enumsortorder) as labels
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = ${s}
  and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
group by t.typname, n.nspname
order by t.typname`,
    },
    {
      key: 'sequences',
      phase: 'sequence',
      sql: `select c.relname as name, n.nspname as schema,
       format_type(s.seqtypid, null) as data_type,
       s.seqstart::text as start_value, s.seqincrement::text as increment,
       s.seqmin::text as min_value, s.seqmax::text as max_value,
       s.seqcache::text as cache, s.seqcycle as cycle
from pg_sequence s
join pg_class c on c.oid = s.seqrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s}
  and not exists (
    select 1 from pg_depend d
    where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'i'
  )
order by c.relname`,
    },
    {
      key: 'functions',
      phase: 'function',
      sql: `select p.oid::regprocedure::text as signature,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = ${s}
  and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by p.proname`,
    },
    {
      key: 'columns',
      phase: 'table',
      sql: `select c.relname as table_name, n.nspname as schema,
       a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null,
       pg_get_expr(d.adbin, d.adrelid) as default_expr,
       a.attidentity as identity,
       a.attgenerated as generated,
       a.attnum as position
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = ${s} and c.relkind = 'r' and not c.relispartition
  and not exists (select 1 from pg_depend dp where dp.objid = c.oid and dp.deptype = 'e')
order by c.relname, a.attnum`,
    },
    {
      key: 'constraints',
      phase: 'constraint',
      sql: `select c.relname as table_name, n.nspname as schema,
       con.conname as name, con.contype as type,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s} and con.contype in ('p', 'u', 'c', 'f')
order by c.relname, con.conname`,
    },
    {
      key: 'indexes',
      phase: 'index',
      sql: `select c.relname as table_name, i.relname as name,
       pg_get_indexdef(x.indexrelid) as definition
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class c on c.oid = x.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s}
  and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)
order by c.relname, i.relname`,
    },
    {
      key: 'views',
      phase: 'view',
      sql: `select c.relname as name, n.nspname as schema, c.relkind as kind,
       pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s} and c.relkind in ('v', 'm')
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
order by c.relname`,
    },
    {
      key: 'triggers',
      phase: 'trigger',
      sql: `select c.relname as table_name, t.tgname as name,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s} and not t.tgisinternal
order by c.relname, t.tgname`,
    },
    {
      key: 'rls',
      phase: 'rls',
      sql: `select c.relname as table_name, n.nspname as schema,
       c.relrowsecurity as enabled, c.relforcerowsecurity as forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = ${s} and c.relkind = 'r' and c.relrowsecurity
order by c.relname`,
    },
    {
      key: 'policies',
      phase: 'policy',
      sql: `select schemaname as schema, tablename as table_name, policyname as name,
       permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = ${s}
order by tablename, policyname`,
    },
    {
      key: 'grants',
      phase: 'grant',
      sql: `select table_name, string_agg(distinct privilege_type, ', ') as privileges, grantee
from information_schema.role_table_grants
where table_schema = ${s}
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee`,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Les lignes attendues en retour
 * ------------------------------------------------------------------ */

export interface ExtensionRow {
  name: string;
  schema: string;
}
export interface EnumRow {
  name: string;
  schema: string;
  labels: unknown;
}
export interface SequenceRow {
  name: string;
  schema: string;
  data_type: string;
  start_value: string;
  increment: string;
  min_value: string;
  max_value: string;
  cache: string;
  cycle: boolean;
}
export interface FunctionRow {
  signature: string;
  definition: string;
}
export interface ColumnRow {
  table_name: string;
  schema: string;
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_expr: string | null;
  /** `a` (always), `d` (by default), ou vide. */
  identity: string;
  /** `s` (stored), ou vide. */
  generated: string;
  position: number;
}
export interface ConstraintRow {
  table_name: string;
  schema: string;
  name: string;
  type: string;
  definition: string;
}
export interface IndexRow {
  table_name: string;
  name: string;
  definition: string;
}
export interface ViewRow {
  name: string;
  schema: string;
  kind: string;
  definition: string;
}
export interface TriggerRow {
  table_name: string;
  name: string;
  definition: string;
}
export interface RlsRow {
  table_name: string;
  schema: string;
  enabled: boolean;
  forced: boolean;
}
export interface PolicyRow {
  schema: string;
  table_name: string;
  name: string;
  permissive: string;
  roles: unknown;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}
export interface GrantRow {
  table_name: string;
  privileges: string;
  grantee: string;
}

export interface StructureRows {
  extensions: ExtensionRow[];
  enums: EnumRow[];
  sequences: SequenceRow[];
  functions: FunctionRow[];
  columns: ColumnRow[];
  constraints: ConstraintRow[];
  indexes: IndexRow[];
  views: ViewRow[];
  triggers: TriggerRow[];
  rls: RlsRow[];
  policies: PolicyRow[];
  grants: GrantRow[];
}

export const EMPTY_ROWS: StructureRows = {
  extensions: [],
  enums: [],
  sequences: [],
  functions: [],
  columns: [],
  constraints: [],
  indexes: [],
  views: [],
  triggers: [],
  rls: [],
  policies: [],
  grants: [],
};

/* ------------------------------------------------------------------ *
 * La génération
 * ------------------------------------------------------------------ */

export interface StructureOptions {
  schema: string;
  /** Phases à produire. Absente de la liste = non générée. */
  phases: StructurePhase[];
  /** Restreindre aux tables sélectionnées ; vide = toutes. */
  tables?: string[];
}

/** Une colonne de `CREATE TABLE`, avec identité, génération et défaut. */
export function columnDefinition(column: ColumnRow): string {
  const parts = [quoteIdentifier(column.column_name), column.data_type];

  if (column.generated === 's' && column.default_expr) {
    // Colonne calculée : l'expression tient lieu de valeur, il n'y a pas de
    // défaut à écrire en plus.
    parts.push(`generated always as (${column.default_expr}) stored`);
  } else if (column.identity === 'a' || column.identity === 'd') {
    parts.push(
      `generated ${column.identity === 'a' ? 'always' : 'by default'} as identity`
    );
  } else if (column.default_expr) {
    parts.push(`default ${column.default_expr}`);
  }

  if (column.not_null) parts.push('not null');
  return parts.join(' ');
}

/** `CREATE INDEX …` → `CREATE INDEX IF NOT EXISTS …`, sans toucher au reste. */
export function idempotentIndex(definition: string): string {
  return definition.replace(
    /^(create\s+(?:unique\s+)?index\s+)(?!if\s+not\s+exists)/i,
    '$1if not exists '
  );
}

/**
 * `CREATE TRIGGER` → `CREATE OR REPLACE TRIGGER` (Postgres 14+).
 * Un `CREATE CONSTRAINT TRIGGER` n'est pas remplaçable : il repart alors sur
 * la tolérance aux doublons.
 */
export function replaceableTrigger(definition: string): string | null {
  if (!/^create\s+trigger\s/i.test(definition.trim())) return null;
  return definition.replace(
    /^create\s+trigger\s/i,
    'create or replace trigger '
  );
}

function policyStatement(policy: PolicyRow): string {
  const roles = parsePgArray(policy.roles);
  const parts = [
    `create policy ${quoteIdentifier(policy.name)} on ${qualify(policy.schema, policy.table_name)}`,
    `as ${policy.permissive?.toLowerCase() === 'restrictive' ? 'restrictive' : 'permissive'}`,
    `for ${(policy.cmd || 'ALL').toLowerCase()}`,
  ];
  if (roles.length > 0) {
    parts.push(`to ${roles.map(role => quoteIdentifier(role)).join(', ')}`);
  }
  if (policy.qual) parts.push(`using (${policy.qual})`);
  if (policy.with_check) parts.push(`with check (${policy.with_check})`);
  return parts.join(' ');
}

/** Trie les contraintes : clés et unicité d'abord, vérifications, puis clés étrangères. */
function constraintRank(type: string): number {
  if (type === 'p') return 0;
  if (type === 'u') return 1;
  if (type === 'c') return 2;
  return 3;
}

export function buildStructureSql(
  rows: StructureRows,
  options: StructureOptions
): Statement[] {
  const wanted = new Set(options.phases);
  const scope =
    options.tables && options.tables.length > 0
      ? new Set(options.tables)
      : undefined;
  const inScope = (table: string): boolean => !scope || scope.has(table);
  const statements: Statement[] = [];
  const push = (phase: StructurePhase, object: string, sql: string): void => {
    if (wanted.has(phase)) statements.push({ phase, object, sql });
  };

  for (const extension of rows.extensions) {
    push(
      'extension',
      extension.name,
      `create extension if not exists ${quoteIdentifier(extension.name)} with schema ${quoteIdentifier(extension.schema)};`
    );
  }

  for (const type of rows.enums) {
    const labels = parsePgArray(type.labels).map(quoteLiteral).join(', ');
    push(
      'type',
      `${type.schema}.${type.name}`,
      tolerateDuplicate(
        `create type ${qualify(type.schema, type.name)} as enum (${labels})`
      )
    );
  }

  for (const sequence of rows.sequences) {
    push(
      'sequence',
      `${sequence.schema}.${sequence.name}`,
      `create sequence if not exists ${qualify(sequence.schema, sequence.name)} as ${sequence.data_type} increment by ${sequence.increment} minvalue ${sequence.min_value} maxvalue ${sequence.max_value} start with ${sequence.start_value} cache ${sequence.cache}${sequence.cycle ? ' cycle' : ' no cycle'};`
    );
  }

  for (const fn of rows.functions) {
    // `pg_get_functiondef` rend déjà un `CREATE OR REPLACE FUNCTION` : rejouable
    // tel quel, et surtout pas à envelopper dans un bloc `do` — un corps de
    // fonction contient volontiers ses propres délimiteurs `$…$`.
    push(
      'function',
      fn.signature,
      `${fn.definition.trimEnd().replace(/;$/, '')};`
    );
  }

  const byTable = new Map<string, ColumnRow[]>();
  for (const column of rows.columns) {
    if (!inScope(column.table_name)) continue;
    const list = byTable.get(column.table_name) ?? [];
    list.push(column);
    byTable.set(column.table_name, list);
  }
  for (const [table, columns] of [...byTable.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const sorted = [...columns].sort((a, b) => a.position - b.position);
    const first = sorted[0];
    if (!first) continue;
    const body = sorted.map(c => `  ${columnDefinition(c)}`).join(',\n');
    push(
      'table',
      `${first.schema}.${table}`,
      `create table if not exists ${qualify(first.schema, table)} (\n${body}\n);`
    );
  }

  const constraints = [...rows.constraints]
    .filter(c => inScope(c.table_name))
    .sort(
      (a, b) =>
        constraintRank(a.type) - constraintRank(b.type) ||
        a.table_name.localeCompare(b.table_name) ||
        a.name.localeCompare(b.name)
    );
  for (const constraint of constraints) {
    push(
      'constraint',
      `${constraint.table_name}.${constraint.name}`,
      tolerateDuplicate(
        `alter table ${qualify(constraint.schema, constraint.table_name)} add constraint ${quoteIdentifier(constraint.name)} ${constraint.definition}`
      )
    );
  }

  for (const index of rows.indexes) {
    if (!inScope(index.table_name)) continue;
    push(
      'index',
      index.name,
      `${idempotentIndex(index.definition).trimEnd().replace(/;$/, '')};`
    );
  }

  for (const view of rows.views) {
    const target = qualify(view.schema, view.name);
    const body = view.definition.trim().replace(/;$/, '');
    push(
      'view',
      `${view.schema}.${view.name}`,
      view.kind === 'm'
        ? `create materialized view if not exists ${target} as ${body};`
        : `create or replace view ${target} as ${body};`
    );
  }

  for (const trigger of rows.triggers) {
    if (!inScope(trigger.table_name)) continue;
    const replaceable = replaceableTrigger(trigger.definition);
    const body = (replaceable ?? trigger.definition)
      .trimEnd()
      .replace(/;$/, '');
    push(
      'trigger',
      `${trigger.table_name}.${trigger.name}`,
      replaceable ? `${body};` : tolerateDuplicate(body)
    );
  }

  for (const table of rows.rls) {
    if (!inScope(table.table_name)) continue;
    const target = qualify(table.schema, table.table_name);
    const lines = [`alter table ${target} enable row level security;`];
    if (table.forced)
      lines.push(`alter table ${target} force row level security;`);
    push('rls', `${table.schema}.${table.table_name}`, lines.join('\n'));
  }

  for (const policy of rows.policies) {
    if (!inScope(policy.table_name)) continue;
    push(
      'policy',
      `${policy.table_name}.${policy.name}`,
      tolerateDuplicate(policyStatement(policy))
    );
  }

  for (const grant of rows.grants) {
    if (!inScope(grant.table_name)) continue;
    push(
      'grant',
      `${grant.table_name} → ${grant.grantee}`,
      `grant ${grant.privileges} on ${qualify(options.schema, grant.table_name)} to ${quoteIdentifier(grant.grantee)};`
    );
  }

  const rank = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));
  return statements.sort(
    (a, b) => (rank.get(a.phase) ?? 99) - (rank.get(b.phase) ?? 99)
  );
}

/**
 * Remet les séquences au niveau des données copiées.
 *
 * Sans cela, la première insertion applicative après la migration entre en
 * conflit : les lignes portent des identifiants explicites, mais la séquence de
 * la cible est restée à 1. C'est le piège classique d'une copie de données, et
 * il se répare en une instruction par colonne.
 */
export function sequenceResetSql(
  columns: readonly ColumnRow[],
  tables?: readonly string[]
): Statement[] {
  const scope = tables && tables.length > 0 ? new Set(tables) : undefined;
  const statements: Statement[] = [];
  for (const column of columns) {
    if (scope && !scope.has(column.table_name)) continue;
    const owned =
      column.identity === 'a' ||
      column.identity === 'd' ||
      (column.default_expr ?? '').includes('nextval(');
    if (!owned) continue;
    const target = qualify(column.schema, column.table_name);
    statements.push({
      phase: 'sequence',
      object: `${column.table_name}.${column.column_name}`,
      // `pg_get_serial_sequence` rend NULL quand la colonne n'a pas de séquence :
      // le `coalesce` évite alors une erreur, et l'instruction ne fait rien.
      sql: `select setval(
  pg_get_serial_sequence(${quoteLiteral(`${column.schema}.${column.table_name}`)}, ${quoteLiteral(column.column_name)}),
  coalesce((select max(${quoteIdentifier(column.column_name)}) from ${target}), 1)
)
where pg_get_serial_sequence(${quoteLiteral(`${column.schema}.${column.table_name}`)}, ${quoteLiteral(column.column_name)}) is not null;`,
    });
  }
  return statements;
}

/** Compte les instructions par phase, pour l'écran de vérification. */
export function countByPhase(
  statements: readonly Statement[]
): { phase: StructurePhase; label: string; count: number }[] {
  const counts = new Map<StructurePhase, number>();
  for (const statement of statements) {
    counts.set(statement.phase, (counts.get(statement.phase) ?? 0) + 1);
  }
  return PHASE_ORDER.filter(phase => counts.has(phase)).map(phase => ({
    phase,
    label: PHASE_LABELS[phase],
    count: counts.get(phase) ?? 0,
  }));
}
