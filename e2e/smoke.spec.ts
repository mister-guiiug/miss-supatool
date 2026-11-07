import { expect, test } from '@playwright/test';
import {
  CIBLE,
  SOURCE,
  brancherEtAnalyser,
  simulerDeuxProjets,
} from './projets-factices';

/**
 * Le SMOKE : ce qui doit marcher pour qu'une livraison ait un sens.
 *
 * Le tag `@critical` est l'un des deux que la CI de la famille joue
 * (`e2e-grep` vaut `@critical|@a11y` par défaut) : une spec sans lui n'est PAS
 * jouée en intégration continue.
 *
 * L'app n'a pas de backend à elle : les projets Supabase sont SIMULÉS par
 * `page.route` (voir `projets-factices.ts`), à des adresses qui ne se
 * résolvent pas, avec une valeur qui n'est pas une clé.
 */
test.describe('@critical le cadre', () => {
  test('l’app monte sur l’écran des projets', async ({ page }) => {
    await page.goto('/');

    // ANCRÉ SUR CE QUE SEUL REACT REND. Le HTML servi porte déjà un `h1` et
    // une description (contenu servi du socle) : une app dont le JavaScript
    // ne charge pas affiche quand même un titre. Les deux formulaires de
    // connexion, eux, n'existent qu'une fois l'app montée.
    await expect(
      page.getByRole('heading', {
        name: 'Migrer un projet Supabase vers un autre',
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByLabel('URL du projet')).toHaveCount(2);
    // Et le contenu servi a bien été REMPLACÉ, pas seulement recouvert.
    await expect(page.locator('[data-dwc="served-content"]')).toHaveCount(0);

    // Rien n'est branché : l'analyse n'est pas proposée.
    await expect(
      page.getByRole('button', { name: 'Analyser les deux projets' })
    ).toBeDisabled();
  });

  test('copier un projet sur lui-même est refusé avant tout appel', async ({
    page,
  }) => {
    const appels = await simulerDeuxProjets(page);
    await page.goto('/');

    // Le garde-fou le plus important de l'outil (`isSameProject`) : une
    // différence de casse ou de barre finale ne fait pas deux projets.
    const urls = page.getByLabel('URL du projet');
    await urls.nth(0).fill(SOURCE);
    await urls.nth(1).fill(`${SOURCE.toUpperCase()}/`);

    // Filtré par le texte : la région des notifications du socle porte déjà
    // un `alert`, vide, et le mode strict refuserait l'ambiguïté.
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Source et cible désignent le même projet' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Analyser les deux projets' })
    ).toBeDisabled();
    expect(appels).toEqual([]);
  });

  test('l’analyse lit les deux schémas, et la source n’est que lue', async ({
    page,
  }) => {
    const appels = await simulerDeuxProjets(page);
    await page.goto('/');
    await brancherEtAnalyser(page);

    // L'analyse a abouti : l'app est passée d'elle-même au contenu.
    await expect(
      page.getByRole('heading', {
        name: 'Ce que les deux projets contiennent',
      })
    ).toBeVisible();
    await expect(
      page.getByText('2 table(s) à la source, dont 1 à créer dans la cible.')
    ).toBeVisible();

    // Les deux projets ont bien été lus…
    const source = new URL(SOURCE).host;
    const cible = new URL(CIBLE).host;
    expect(appels).toContain(`GET ${source}/rest/v1/`);
    expect(appels).toContain(`GET ${cible}/rest/v1/`);
    // … et la source n'a reçu QUE des lectures : l'invariant de
    // `core/guard.ts`, vu de l'extérieur.
    const versLaSource = appels.filter(a => a.includes(` ${source}/`));
    expect(versLaSource.filter(a => !/^(GET|HEAD|OPTIONS) /.test(a))).toEqual(
      []
    );
  });
});
