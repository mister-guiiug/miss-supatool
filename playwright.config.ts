import { defineConfig, devices } from '@playwright/test';
import { definePwaPlaywrightConfig } from '@mister-guiiug/dev-pwa-config/playwright-base';

/**
 * La fabrique du socle fournit la matrice de navigateurs, les reporters, le
 * gabarit de captures, `reducedMotion` et le serveur de test.
 *
 * `preview: true` : les e2e passent sur un BUILD de production, jamais sur le
 * serveur de développement. C'est le seul moyen d'exercer ce qui n'existe qu'à
 * la fin — service worker, minification, manifeste, CSP. C'est aussi le seul
 * où le relais de développement de `vite.config.ts` n'existe pas : l'app est
 * testée telle que Pages la sert.
 *
 * `VITE_BASE_PATH=/` neutralise le chemin GitHub Pages le temps du test, et le
 * port 4173 évite la collision avec le serveur de développement (5234).
 *
 * `vite build` et non `npm run build` : le budget de poids et `tsc -b` ont
 * leur propre job, et ne doivent pas faire tomber le serveur de test.
 */
export default defineConfig(
  definePwaPlaywrightConfig({
    devices,
    testMatch: /.*\.spec\.ts$/,
    preview: true,
    port: 4173,
    command:
      'node scripts/with-env.mjs VITE_BASE_PATH=/ -- vite build && node scripts/with-env.mjs VITE_BASE_PATH=/ -- vite preview --port 4173 --strictPort',
    // La langue du navigateur est FIXÉE : les nombres et les dates passent par
    // `Intl`, qui suit la locale du contexte — `en-US` par défaut dans
    // Playwright. `overrides.use` est FUSIONNÉ par la fabrique (socle 6.x) :
    // le `baseURL` qu'elle calcule survit.
    overrides: { use: { locale: 'fr-FR' } },
  })
);
