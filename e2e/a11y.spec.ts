import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectNoA11yViolations } from '@mister-guiiug/dev-pwa-config/playwright-a11y';
import { brancherEtAnalyser, simulerDeuxProjets } from './projets-factices';

/**
 * axe-core sur les trois écrans principaux : les projets (formulaires de
 * connexion), le contenu à copier APRÈS une analyse — l'écran le plus dense
 * de l'outil, vide tant que rien n'est branché, d'où les deux projets
 * simulés de `projets-factices.ts` —, et les réglages.
 *
 * CHAQUE AUDIT ATTEND SON ÉCRAN. Lancé au `load`, axe pourrait auditer le
 * contenu servi du socle — et sortir vert sur une page que personne ne lit.
 * L'ancre est toujours un élément que seul React rend.
 *
 * LES DEUX THÈMES. Le thème suit le système par défaut : un contraste juste
 * en clair peut être faux en sombre.
 */
const ECRANS: { nom: string; ouvrir: (page: Page) => Promise<void> }[] = [
  {
    nom: 'projets',
    ouvrir: async page => {
      await page.goto('/');
      await expect(page.getByLabel('URL du projet')).toHaveCount(2);
    },
  },
  {
    nom: 'contenu, après analyse',
    ouvrir: async page => {
      await simulerDeuxProjets(page);
      await page.goto('/');
      await brancherEtAnalyser(page);
      await expect(
        page.getByRole('heading', { name: 'Tables à copier' })
      ).toBeVisible();
    },
  },
  {
    nom: 'réglages',
    ouvrir: async page => {
      await page.goto('/#/reglages');
      await expect(
        page.getByRole('button', { name: 'Oublier les clés maintenant' })
      ).toBeVisible();
    },
  },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`@a11y accessibilité, thème ${theme === 'light' ? 'clair' : 'sombre'}`, () => {
    test.use({ colorScheme: theme });

    for (const ecran of ECRANS) {
      test(`${ecran.nom} sans violation WCAG A/AA`, async ({ page }) => {
        await ecran.ouvrir(page);
        await expectNoA11yViolations(page, AxeBuilder, expect);
      });
    }
  });
}
