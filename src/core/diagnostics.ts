/**
 * Séparer les variables quand l'API refuse.
 *
 * Le refus observé — « votre compte n'a pas les privilèges nécessaires » — est
 * arrivé sur une écriture, vers le projet CIBLE, alors qu'une lecture vers le
 * projet SOURCE venait de réussir. Deux choses avaient changé à la fois : le
 * projet et le mode. Un message d'erreur ne dit pas laquelle compte, et
 * deviner coûte plus cher que mesurer.
 *
 * D'où ces quatre sondes : chaque projet, chaque mode, la même requête
 * anodine. `select 1` n'écrit rien même en mode écriture — ce n'est pas la
 * requête qu'on éprouve, c'est le DROIT de l'envoyer.
 *
 * Le tableau des cas est PUR et testé : c'est lui qui transforme quatre codes
 * HTTP en une phrase qui dit où regarder.
 */

export type ProbeSide = 'source' | 'target';
export type ProbeMode = 'read' | 'write';

export interface Probe {
  side: ProbeSide;
  mode: ProbeMode;
}

/** L'ordre d'affichage : par projet, lecture puis écriture. */
export const PROBES: readonly Probe[] = [
  { side: 'source', mode: 'read' },
  { side: 'source', mode: 'write' },
  { side: 'target', mode: 'read' },
  { side: 'target', mode: 'write' },
];

/** La requête des sondes : elle ne lit rien et n'écrit rien. */
export const PROBE_SQL = 'select 1';

export interface ProbeOutcome extends Probe {
  ok: boolean;
  status?: number;
  message?: string;
}

export interface Diagnosis {
  conclusion: string;
  /** Ce qu'il y a à faire, quand il y a quelque chose à faire. */
  advice?: string;
}

const CONTOURNEMENT =
  'Le SQL de la structure reste téléchargeable ici : collé dans l’éditeur SQL du tableau de bord Supabase, il produit exactement le même résultat.';

function find(
  outcomes: readonly ProbeOutcome[],
  side: ProbeSide,
  mode: ProbeMode
): ProbeOutcome | undefined {
  return outcomes.find(o => o.side === side && o.mode === mode);
}

export function diagnose(outcomes: readonly ProbeOutcome[]): Diagnosis {
  if (outcomes.length === 0) {
    return { conclusion: "Aucune sonde n'a été lancée." };
  }

  const sourceRead = find(outcomes, 'source', 'read');
  const sourceWrite = find(outcomes, 'source', 'write');
  const targetRead = find(outcomes, 'target', 'read');
  const targetWrite = find(outcomes, 'target', 'write');

  const reads = [sourceRead, targetRead].filter(o => o !== undefined);
  const writes = [sourceWrite, targetWrite].filter(o => o !== undefined);
  const allOk = outcomes.every(o => o.ok);
  const noneOk = outcomes.every(o => !o.ok);

  if (allOk) {
    return {
      conclusion:
        'Le jeton peut lire ET écrire du SQL sur les deux projets. Les droits ne sont pas en cause.',
      advice:
        "Si la copie de structure échoue malgré tout, la cause est dans le SQL lui-même : lisez le message de la première instruction en échec, il est propre à l'objet concerné.",
    };
  }

  if (noneOk) {
    return {
      conclusion:
        "Le jeton n'exécute aucun SQL, sur aucun des deux projets — même en lecture.",
      advice:
        "Vérifiez que le jeton d'accès personnel est valide, non révoqué, et qu'il appartient bien au compte propriétaire de ces projets.",
    };
  }

  // Le mode d'abord : c'est la conclusion qui change le plus la marche à
  // suivre, et celle que le message de l'API ne permet pas de deviner.
  const readsOk = reads.length > 0 && reads.every(o => o.ok);
  const writesFail = writes.length > 0 && writes.every(o => !o.ok);
  if (readsOk && writesFail) {
    return {
      conclusion:
        "C'est le mode ÉCRITURE qui est refusé, sur les deux projets : la lecture passe partout. Le projet cible n'y est pour rien.",
      advice: `Le compte peut interroger la base mais pas la modifier par l'API. ${CONTOURNEMENT}`,
    };
  }

  // Puis le projet : la lecture et l'écriture tombent du même côté.
  const sourceOk = [sourceRead, sourceWrite]
    .filter(o => o !== undefined)
    .every(o => o.ok);
  const targetFails = [targetRead, targetWrite]
    .filter(o => o !== undefined)
    .every(o => !o.ok);
  if (sourceOk && targetFails) {
    return {
      conclusion:
        "C'est le projet CIBLE qui refuse, en lecture comme en écriture, alors que la source répond. Le mode n'y est pour rien.",
      advice:
        "Le jeton n'a pas de droits sur ce projet-là : vérifiez qu'il appartient au même compte, que le projet n'est ni en pause ni en cours de démarrage, et qu'il est bien dans une organisation où vous êtes membre.",
    };
  }

  if (targetWrite && !targetWrite.ok && sourceWrite?.ok && targetRead?.ok) {
    return {
      conclusion:
        "Seule l'écriture sur le projet CIBLE est refusée : la source accepte les deux, et la cible accepte la lecture.",
      advice: `Le refus est donc propre à ce projet ET au mode écriture — un réglage de l'organisation qui le détient, ou une restriction du projet lui-même. ${CONTOURNEMENT}`,
    };
  }

  const refuses = outcomes
    .filter(o => !o.ok)
    .map(
      o =>
        `${o.side === 'source' ? 'source' : 'cible'} en ${o.mode === 'read' ? 'lecture' : 'écriture'}`
    )
    .join(', ');
  return {
    conclusion: `Refus partiel : ${refuses}.`,
    advice: CONTOURNEMENT,
  };
}

/** Libellé court d'une sonde, pour le tableau à l'écran. */
export function probeLabel(probe: Probe): string {
  return `${probe.side === 'source' ? 'Source' : 'Cible'} · ${
    probe.mode === 'read' ? 'lecture' : 'écriture'
  }`;
}
