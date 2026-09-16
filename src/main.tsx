import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installErrorReporter,
  initSentry,
} from '@mister-guiiug/dev-pwa-config/react/observability';
import { ThemeProvider } from '@mister-guiiug/dev-pwa-config/react/theme-provider';
import { ToastProvider } from '@mister-guiiug/dev-pwa-config/react/toast';
import { App } from './App.tsx';
import './index.css';

// Avant tout le reste : une erreur levée au montage doit déjà être capturée.
installErrorReporter();
void initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  // La version applicative, pour qu’une erreur soit rattachée à un build
  // précis : sans elle, toutes les traces se mélangent dans un seul tas.
  release: __APP_VERSION__,
  // `loader` REND L’IMPORT ANALYSABLE PAR VITE, et c’est ce qui permet au
  // `manualChunks` de le ranger dans son propre morceau. Sans lui, le socle
  // retombe sur un spécificateur volontairement non analysable — nécessaire
  // tant que la peer n’est pas installée, inutile maintenant qu’elle l’est.
  //
  // Rien ne part tant qu’aucun DSN n’est posé : `initSentry` rend `null`
  // AVANT l’import. Et le morceau est hors du précache du service worker,
  // sans quoi il serait téléchargé quand même (cf. vite.config.ts).
  loader: () => import('@sentry/react'),
});

const container = document.getElementById('app');
if (!container) throw new Error('Élément racine #app introuvable');

createRoot(container).render(
  <StrictMode>
    {/*
      `palette` n'est pas fourni : les jetons `--dwc-*` sont peints par
      `index.css`, avec les couleurs de l'app. Le fournisseur ne sert ici qu'à
      partager l'état clair/sombre et à tenir `data-theme` à jour — d'où
      `paint={false}`, qui évite de charger le catalogue des dix-sept palettes.
    */}
    <ThemeProvider
      paint={false}
      themeColor={{ light: '#0f9d63', dark: '#0b1a14' }}
    >
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
);
