import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  installErrorReporter,
  initSentry,
} from '@mister-guiiug/dev-wpa-config/react/observability';
import { ThemeProvider } from '@mister-guiiug/dev-wpa-config/react/theme-provider';
import { ToastProvider } from '@mister-guiiug/dev-wpa-config/react/toast';
import { App } from './App.tsx';
import './index.css';

// Avant tout le reste : une erreur levée au montage doit déjà être capturée.
installErrorReporter();
void initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
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
