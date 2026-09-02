import { describe, expect, it } from 'vitest';
import {
  diagnose,
  probeLabel,
  PROBES,
  PROBE_SQL,
  type ProbeOutcome,
} from './diagnostics.ts';

const outcome = (
  side: 'source' | 'target',
  mode: 'read' | 'write',
  ok: boolean,
  status = ok ? 201 : 403
): ProbeOutcome => ({ side, mode, ok, status });

const all = (
  sr: boolean,
  sw: boolean,
  tr: boolean,
  tw: boolean
): ProbeOutcome[] => [
  outcome('source', 'read', sr),
  outcome('source', 'write', sw),
  outcome('target', 'read', tr),
  outcome('target', 'write', tw),
];

describe('les sondes', () => {
  it('couvrent les quatre combinaisons projet × mode', () => {
    expect(PROBES).toHaveLength(4);
    expect(new Set(PROBES.map(p => `${p.side}-${p.mode}`)).size).toBe(4);
  });

  it("n'écrivent rien, même en mode écriture", () => {
    // Ce qu'on éprouve n'est pas la requête mais le droit de l'envoyer.
    expect(PROBE_SQL).toBe('select 1');
  });
});

describe('diagnose', () => {
  it('ne conclut rien sans mesure', () => {
    expect(diagnose([]).conclusion).toMatch(/Aucune sonde/);
  });

  it('innocente les droits quand tout passe', () => {
    const d = diagnose(all(true, true, true, true));
    expect(d.conclusion).toMatch(/ne sont pas en cause/);
    expect(d.advice).toMatch(/le SQL lui-même/);
  });

  it('désigne le MODE quand la lecture passe partout et l’écriture nulle part', () => {
    const d = diagnose(all(true, false, true, false));
    expect(d.conclusion).toMatch(/mode ÉCRITURE/);
    expect(d.conclusion).toMatch(/n'y est pour rien/);
    expect(d.advice).toMatch(/éditeur SQL/);
  });

  it('désigne le PROJET quand la cible refuse tout et la source rien', () => {
    const d = diagnose(all(true, true, false, false));
    expect(d.conclusion).toMatch(/projet CIBLE/);
    expect(d.advice).toMatch(/même compte/);
  });

  it('nomme le croisement quand seule l’écriture sur la cible tombe', () => {
    // Le cas remonté : source OK des deux côtés, cible qui lit mais n'écrit pas.
    const d = diagnose(all(true, true, true, false));
    expect(d.conclusion).toMatch(/Seule l'écriture sur le projet CIBLE/);
    expect(d.advice).toMatch(/éditeur SQL/);
  });

  it('signale un jeton qui ne peut rien du tout', () => {
    const d = diagnose(all(false, false, false, false));
    expect(d.conclusion).toMatch(/aucun SQL/);
    expect(d.advice).toMatch(/révoqué/);
  });

  it('énumère les refus quand aucun motif simple ne se dégage', () => {
    const d = diagnose(all(false, true, true, true));
    expect(d.conclusion).toMatch(/source en lecture/);
  });
});

describe('probeLabel', () => {
  it('nomme la sonde en français', () => {
    expect(probeLabel({ side: 'target', mode: 'write' })).toBe(
      'Cible · écriture'
    );
  });
});
