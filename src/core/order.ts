/**
 * Ordre d'insertion des tables.
 *
 * Insérer une ligne qui référence une ligne absente échoue : la contrainte de
 * clé étrangère est vérifiée immédiatement, sauf si elle a été déclarée
 * DEFERRABLE — ce qu'on ne peut ni savoir ni changer depuis l'API REST. Il faut
 * donc copier les tables parentes d'abord, et c'est un tri topologique sur le
 * graphe des clés étrangères.
 *
 * Deux situations n'admettent pas d'ordre, et sont RAPPORTÉES plutôt que
 * masquées :
 *
 * - un **cycle** entre plusieurs tables (A référence B qui référence A) ;
 * - une table qui se **référence elle-même** (un arbre : `parent_id`), où c'est
 *   l'ordre des LIGNES qui compte, pas celui des tables.
 *
 * Dans les deux cas la copie reste possible mais peut échouer sur certaines
 * lignes ; l'écran de vérification le dit avant de lancer quoi que ce soit.
 */

import type { DatabaseSchema } from './schema.ts';

export interface OrderResult {
  /** Tables dans l'ordre d'insertion : les parentes d'abord. */
  order: string[];
  /** Groupes de tables mutuellement dépendantes (aucun ordre ne les satisfait). */
  cycles: string[][];
  /** Tables dont une colonne pointe vers elles-mêmes. */
  selfReferencing: string[];
  /** Dépendances vers une table HORS sélection : le parent ne sera pas copié. */
  externalDependencies: { table: string; dependsOn: string }[];
}

/**
 * Trie les tables sélectionnées. `selected` fixe le périmètre : une clé
 * étrangère vers une table non sélectionnée ne crée pas d'arête (on ne va pas
 * copier une table que l'utilisateur a écartée) mais elle est signalée.
 */
export function orderTables(
  schema: DatabaseSchema,
  selected: readonly string[]
): OrderResult {
  const inScope = new Set(selected);
  const nodes = [...inScope].sort((a, b) => a.localeCompare(b));

  /** Arêtes parent → enfant : le parent doit être inséré en premier. */
  const children = new Map<string, Set<string>>();
  for (const node of nodes) children.set(node, new Set());

  const selfReferencing: string[] = [];
  const externalDependencies: { table: string; dependsOn: string }[] = [];
  const seenExternal = new Set<string>();

  for (const table of schema.tables) {
    if (!inScope.has(table.name)) continue;
    for (const column of table.columns) {
      const fk = column.foreignKey;
      if (!fk) continue;
      if (fk.table === table.name) {
        if (!selfReferencing.includes(table.name))
          selfReferencing.push(table.name);
        continue;
      }
      if (!inScope.has(fk.table)) {
        const key = `${table.name}→${fk.table}`;
        if (!seenExternal.has(key)) {
          seenExternal.add(key);
          externalDependencies.push({
            table: table.name,
            dependsOn: fk.table,
          });
        }
        continue;
      }
      children.get(fk.table)?.add(table.name);
    }
  }

  const sccs = stronglyConnectedComponents(nodes, children);
  const { order, cycles } = topologicalOrder(sccs, children);

  selfReferencing.sort((a, b) => a.localeCompare(b));
  externalDependencies.sort(
    (a, b) =>
      a.table.localeCompare(b.table) || a.dependsOn.localeCompare(b.dependsOn)
  );

  return { order, cycles, selfReferencing, externalDependencies };
}

/**
 * Tri topologique du graphe CONDENSÉ (une composante fortement connexe = un
 * nœud), à départage alphabétique.
 *
 * Renverser simplement l'ordre de sortie de Tarjan donnerait un ordre valide,
 * mais il inverserait aussi l'ordre des tables INDÉPENDANTES : `a` et `b`, que
 * rien ne lie, sortiraient « b, a ». Un plan lu par un humain doit être stable
 * et prévisible ; d'où ce second passage, qui ne choisit que ce que les
 * contraintes laissent libre.
 */
function topologicalOrder(
  sccs: readonly string[][],
  edges: ReadonlyMap<string, ReadonlySet<string>>
): { order: string[]; cycles: string[][] } {
  const componentOf = new Map<string, number>();
  sccs.forEach((scc, index) => {
    for (const node of scc) componentOf.set(node, index);
  });

  const members = sccs.map(scc => [...scc].sort((a, b) => a.localeCompare(b)));
  const successors = sccs.map(() => new Set<number>());
  const indegree = sccs.map(() => 0);

  for (const [parent, kids] of edges) {
    const from = componentOf.get(parent);
    if (from === undefined) continue;
    const out = successors[from];
    if (!out) continue;
    for (const kid of kids) {
      const to = componentOf.get(kid);
      if (to === undefined || to === from || out.has(to)) continue;
      out.add(to);
      indegree[to] = (indegree[to] ?? 0) + 1;
    }
  }

  const label = (index: number): string => members[index]?.[0] ?? '';
  const ready = members
    .map((_, index) => index)
    .filter(index => (indegree[index] ?? 0) === 0);
  ready.sort((a, b) => label(a).localeCompare(label(b)));

  const order: string[] = [];
  const cycles: string[][] = [];
  while (ready.length > 0) {
    const index = ready.shift();
    if (index === undefined) break;
    const group = members[index] ?? [];
    order.push(...group);
    if (group.length > 1) cycles.push(group);

    let unlocked = false;
    for (const next of successors[index] ?? []) {
      indegree[next] = (indegree[next] ?? 0) - 1;
      if ((indegree[next] ?? 0) === 0) {
        ready.push(next);
        unlocked = true;
      }
    }
    if (unlocked) ready.sort((a, b) => label(a).localeCompare(label(b)));
  }

  return { order, cycles };
}

/**
 * Tarjan, itératif : une base à quelques centaines de tables ne déborde pas la
 * pile, mais une pile explicite retire la question et se lit aussi bien.
 */
function stronglyConnectedComponents(
  nodes: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  interface Frame {
    node: string;
    neighbours: string[];
    next: number;
  }

  const neighboursOf = (node: string): string[] =>
    [...(edges.get(node) ?? [])].sort((a, b) => a.localeCompare(b));

  for (const start of nodes) {
    if (index.has(start)) continue;
    const frames: Frame[] = [
      { node: start, neighbours: neighboursOf(start), next: 0 },
    ];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;
      if (frame.next < frame.neighbours.length) {
        const neighbour = frame.neighbours[frame.next];
        frame.next += 1;
        if (neighbour === undefined) continue;
        if (!index.has(neighbour)) {
          index.set(neighbour, counter);
          low.set(neighbour, counter);
          counter += 1;
          stack.push(neighbour);
          onStack.add(neighbour);
          frames.push({
            node: neighbour,
            neighbours: neighboursOf(neighbour),
            next: 0,
          });
        } else if (onStack.has(neighbour)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) ?? 0, index.get(neighbour) ?? 0)
          );
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0)
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop();
          if (popped === undefined) break;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        result.push(component);
      }
    }
  }

  return result;
}
