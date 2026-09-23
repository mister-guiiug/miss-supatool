import { describe, expect, it } from 'vitest';
import brut from './index.css?raw';

/**
 * LA PRIMAIRE DES COMPOSANTS PARTAGÉS, MESURÉE DEPUIS LA FEUILLE.
 *
 * `components.css` du socle peint `--dwc-primary-contrast` sur l'aplat
 * `--dwc-primary` (bouton primaire, bouton de CONFIRMATION de `ConfirmDialog`)
 * et se sert de `--dwc-primary` comme couleur de texte ailleurs (liens,
 * survols). Branchée sur `--st-ok`, elle donnait en clair 4,40:1 en aplat et
 * 3,49:1 en texte : sous le 4,5 de WCAG AA, sur l'écran qui valide une
 * écriture réelle.
 *
 * Ce test relit `index.css` et refait l'arithmétique WCAG dans les deux
 * thèmes. Le Chrome de Playwright se déclare en thème CLAIR : une suite e2e ne
 * verrait que l'un des deux.
 */

const feuille = brut.replace(/\/\*[\s\S]*?\*\//g, '');

/** Les déclarations de tous les blocs dont le sélecteur est exactement `selecteur`. */
function jetons(selecteur: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const [, sel, corps] of feuille.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Ce qui suit le dernier `;` : le premier bloc emporte sinon les `@import`.
    if (sel!.split(';').pop()!.trim() !== selecteur) continue;
    for (const [, nom, valeur] of corps!.matchAll(
      /(--[a-z0-9-]+)\s*:\s*([^;]+);/g
    )) {
      table.set(nom!, valeur!.trim());
    }
  }
  return table;
}

const CLAIR = jetons(':root');
const SOMBRE = new Map([...CLAIR, ...jetons("[data-theme='dark']")]);

/** Suit les `var(--x)` jusqu'à une couleur hexadécimale. */
function hex(table: Map<string, string>, nom: string): string {
  let valeur = table.get(nom) ?? '';
  for (let i = 0; i < 8; i += 1) {
    const renvoi = /^var\((--[a-z0-9-]+)\)$/.exec(valeur);
    if (!renvoi) break;
    valeur = table.get(renvoi[1]!) ?? '';
  }
  return valeur;
}

function luminance(couleur: string): number {
  const h = couleur.replace('#', '');
  const canal = (i: number) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [haut, bas] = x > y ? [x, y] : [y, x];
  return (haut + 0.05) / (bas + 0.05);
}

describe('index.css - la primaire des composants partagés', () => {
  it.each([
    ['clair', CLAIR],
    ['sombre', SOMBRE],
  ] as const)('%s : tient en aplat ET en texte', (_theme, table) => {
    const primaire = hex(table, '--dwc-primary');
    const encre = hex(table, '--dwc-primary-contrast');
    // Garde de non-vacuité : une chaîne `var()` rompue rendrait une chaîne
    // vide, et le rapport calculé sur `NaN` ne tomberait jamais.
    expect(primaire).toMatch(/^#[0-9a-f]{6}$/i);
    expect(encre).toMatch(/^#[0-9a-f]{6}$/i);

    // L'aplat sous son encre : bouton primaire, confirmation.
    expect(contraste(primaire, encre)).toBeGreaterThanOrEqual(4.5);
    // La primaire en texte, sur chacun des fonds où le socle la pose.
    for (const fond of ['--dwc-surface', '--dwc-surface-2', '--st-bg']) {
      expect(
        contraste(primaire, hex(table, fond)),
        `${fond} (${hex(table, fond)})`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
