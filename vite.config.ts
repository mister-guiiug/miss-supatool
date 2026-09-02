import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';
import { pwaSeoPlugin } from '@mister-guiiug/dev-wpa-config/vite-pwa-base';
import { cspPlugin } from '@mister-guiiug/dev-wpa-config/vite-csp';

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
      react(),
      tailwindcss(),
      pwaSeoPlugin({
        basePath,
        logoPath: '/icon-512.png',
        themeColor: { light: '#f6faf8', dark: '#0b1a14' },
      }),
      cspPlugin({
        dev: command === 'serve',
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
