import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';
import { pwaSeoPlugin } from '@mister-guiiug/dev-pwa-config/vite-pwa-base';
import { cspPlugin } from '@mister-guiiug/dev-pwa-config/vite-csp';
import { versionPlugin } from '@mister-guiiug/dev-pwa-config/vite-version';

const analyze = process.env.ANALYZE === '1';
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

// Dépôt GitHub Pages : https://mister-guiiug.github.io/miss-supatool/
export default defineConfig(({ command }) => {
  const buildId =
    process.env.DEPLOY_ID ||
    process.env.GITHUB_RUN_ID ||
    process.env.GITHUB_SHA?.slice(0, 7) ||
    (command === 'build' ? String(Date.now()) : 'dev');

  // `VITE_BASE_PATH` (déploiement famille + CI Lighthouse avec « / ») prioritaire.
  let basePath = '/';
  if (process.env.VITE_BASE_PATH) {
    basePath = process.env.VITE_BASE_PATH;
  } else if (command === 'build') {
    basePath = '/miss-supatool/';
  }

  return {
    base: basePath,
    server: {
      proxy: {
        // Relais de développement vers l'API de management.
        //
        // `api.supabase.com` n'accorde le CORS qu'à `supabase.com` : créer un
        // projet ou exécuter du DDL depuis la page est impossible sans
        // intermédiaire. En production c'est le Worker de `proxy/` ; en local
        // c'est ce proxy-ci, pour n'avoir RIEN à déployer avant d'essayer.
        //
        // Même convention d'appel que le Worker (`?path=/v1/…`), pour que le
        // client soit strictement le même code dans les deux cas.
        '/__supabase-management': {
          target: 'https://api.supabase.com',
          changeOrigin: true,
          rewrite: received => {
            const mark = received.indexOf('?');
            const search = mark === -1 ? '' : received.slice(mark + 1);
            const path = new URLSearchParams(search).get('path');
            return path && path.startsWith('/v1/') ? path : '/v1';
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            const norm = id.replace(/\\/g, '/');
            // Sentry est chargé par un `import()` que `loader` rend
            // analysable. Sans cette ligne il tomberait dans `vendor`,
            // qui est PRÉCHARGÉ : mesuré sur miss-uwh, 381,9 kB
            // préchargés au lieu de 227,2 — pour un total gzip identique
            // à 0,1 kB près. Le total ne voit pas la différence,
            // `bundleBudget.preloadGzipKb` si.
            if (norm.includes('/@sentry/')) return 'sentry';
            // ET POSTHOG POUR LA MÊME RAISON, EN PLUS GRAVE. Sentry préchargé
            // coûtait du poids ; PostHog préchargé casse une PROMESSE : l'ADR
            // 0012 dit que rien n'est chargé avant l'accord, et le socle ne
            // l'appelle qu'après. Sans cette ligne, la bibliothèque tombe
            // dans `vendor`, qui est PRÉCHARGÉ — elle serait donc
            // téléchargée chez un visiteur qui refuse. C'est `preloadGzipKb`
            // qui le voit, jamais le total.
            if (norm.includes('/posthog-js/')) return 'posthog';
            if (
              norm.includes('/vite-plugin-pwa/') ||
              norm.includes('/workbox-')
            )
              return 'pwa';
            if (
              norm.includes('/react-dom/') ||
              norm.includes('/node_modules/react/') ||
              norm.includes('/scheduler/')
            )
              return 'react-vendor';
            if (norm.includes('/react-router/')) return 'router';
            if (norm.includes('/zustand/')) return 'zustand';
            if (norm.includes('/zod/')) return 'zod';
            if (norm.includes('/lucide-react/')) return 'icons';
            return 'vendor';
          },
        },
      },
    },
    plugins: [
      // AVANT cspPlugin : il pose un script inline dans le <head>, que la
      // CSP doit hacher après coup ; et il écrit version.json au build.
      versionPlugin({ manifest: true, define: false }),
      react(),
      tailwindcss(),
      pwaSeoPlugin({
        basePath,
        logoPath: '/icon-512.png',
        themeColor: { light: '#f6faf8', dark: '#0b1a14' },
      }),
      cspPlugin({
        dev: command === 'serve',
        // Ouvre les hôtes de PostHog — le nuage EUROPÉEN (ADR 0012). Sans
        // cette option, l'ingestion que `ConsentBanner` déclenche APRÈS
        // l'accord serait refusée par la politique — et l'échec ne se verrait
        // qu'en console, sur le site déployé, une fois le consentement donné.
        analytics: true,
        // `https:` et non `https://*.supabase.co` : les deux projets que
        // l'utilisateur relie sont saisis À L'EXÉCUTION. Un projet Supabase
        // peut vivre sur un domaine personnalisé ou sur une instance
        // auto-hébergée — restreindre au domaine `supabase.co` casserait ces
        // cas-là, qui sont précisément ceux d'un outil de migration. Le reste
        // de la politique (script-src par hash, pas d'`unsafe-inline`) est
        // inchangé : c'est le canal SORTANT qui est ouvert, pas l'exécution.
        connectSrc: ["'self'", 'https:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
      }),
      VitePWA({
        // `prompt` : un déploiement ne recharge pas la page pendant une copie.
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'robots.txt'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
          /*
           * LE MORCEAU SENTRY HORS DU PRÉCACHE, sans quoi le découpage
           * ci-dessus ne servirait à rien : `globPatterns` ramasse TOUT le
           * JS émis, `import()` ou pas. Mesuré le 16/09/2026 sur la
           * production de deux apps du parc, 345 et 463 KiB bruts de SDK
           * téléchargés par chaque visiteur — sans qu’aucun DSN soit posé.
           *
           * Hors précache, il est cherché sur le réseau à la première
           * erreur, et jamais si l’observabilité reste éteinte. Ne pas
           * l’avoir hors ligne est sans conséquence : rapporter une erreur
           * demande le réseau.
           */
          globIgnores: ['**/sentry-*.js'],
          // Le shell est mis en cache ; les appels aux projets Supabase
          // (REST + Storage) restent réseau.
          navigateFallbackDenylist: [/supabase\.(co|in)/],
        },
        manifest: {
          id: basePath,
          name: 'Miss Supatool',
          short_name: 'Supatool',
          description:
            "Copiez les données d'un projet Supabase vers un autre : tables via PostgREST, fichiers via l'API Storage. Tout se passe dans votre navigateur.",
          theme_color: '#0f9d63',
          background_color: '#f6faf8',
          display: 'standalone',
          orientation: 'portrait',
          scope: basePath,
          start_url: basePath,
          lang: 'fr',
          dir: 'ltr',
          categories: ['productivity', 'utilities', 'developer'],
          // Les deux captures de la fiche d'installation, prises par
          // `pwa-screenshots` du socle sur un build (06/09/2026) : sans elles,
          // Chrome propose une ligne et un bouton au lieu d'une fiche.
          screenshots: [
            {
              src: 'screenshots/narrow.png',
              sizes: '540x1170',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'L’application, sur téléphone',
            },
            {
              src: 'screenshots/wide.png',
              sizes: '1280x720',
              type: 'image/png',
              form_factor: 'wide',
              label: 'L’application, sur ordinateur',
            },
          ],
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icon-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
      }),
      ...(analyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              open: !process.env.CI,
            }) as PluginOption,
          ]
        : []),
    ],
  };
});
