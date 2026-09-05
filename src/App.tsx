import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from '@mister-guiiug/dev-pwa-config/react/bottom-nav';
import { AppHeader } from '@mister-guiiug/dev-pwa-config/react/app-header';
import { PageContainer } from '@mister-guiiug/dev-pwa-config/react/page-container';
import { ThemeToggle } from '@mister-guiiug/dev-pwa-config/react/theme-toggle';
import {
  Boxes,
  DatabaseZap,
  FileClock,
  ListChecks,
  Plug,
  Settings,
} from 'lucide-react';
import { ConnectionsScreen } from './features/connections/ConnectionsScreen.tsx';
import { AnalyzeScreen } from './features/analyze/AnalyzeScreen.tsx';
import { StructureScreen } from './features/structure/StructureScreen.tsx';
import { RunScreen } from './features/run/RunScreen.tsx';
import { ReportScreen } from './features/report/ReportScreen.tsx';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';

/**
 * L'ordre est celui d'une migration : brancher, regarder, bâtir, remplir,
 * relire. Les Réglages viennent en dernier — au-delà du cinquième, la barre du
 * socle range la destination sous un bouton « Plus », ce qui est exactement
 * leur place.
 */
const NAV = [
  { href: '/', label: 'Projets', icon: <Plug aria-hidden="true" />, end: true },
  {
    href: '/analyse',
    label: 'Contenu',
    icon: <ListChecks aria-hidden="true" />,
  },
  {
    href: '/structure',
    label: 'Structure',
    icon: <Boxes aria-hidden="true" />,
  },
  { href: '/copie', label: 'Copie', icon: <DatabaseZap aria-hidden="true" /> },
  {
    href: '/rapport',
    label: 'Rapport',
    icon: <FileClock aria-hidden="true" />,
  },
  {
    href: '/reglages',
    label: 'Réglages',
    icon: <Settings aria-hidden="true" />,
  },
];

const TITLES: Record<string, string> = {
  '/': 'Projets',
  '/analyse': 'Contenu à copier',
  '/structure': 'Structure de la base',
  '/copie': 'Copie',
  '/rapport': 'Rapport',
  '/reglages': 'Réglages',
};

function Shell() {
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Miss Supatool';

  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only">
        Aller au contenu
      </a>
      <AppHeader title={title} actions={<ThemeToggle />} />
      <PageContainer as="main" id="contenu" width="lg" className="app-main">
        <Routes>
          <Route path="/" element={<ConnectionsScreen />} />
          <Route path="/analyse" element={<AnalyzeScreen />} />
          <Route path="/structure" element={<StructureScreen />} />
          <Route path="/copie" element={<RunScreen />} />
          <Route path="/rapport" element={<ReportScreen />} />
          <Route path="/reglages" element={<SettingsScreen />} />
          <Route path="*" element={<ConnectionsScreen />} />
        </Routes>
      </PageContainer>
      <UpdatePrompt />
      <BottomNav
        items={NAV}
        currentPath={location.pathname}
        linkComponent={Link}
        hrefProp="to"
        label="Étapes"
        // Les six destinations sont visibles : au réglage par défaut, la barre
        // en range DEUX sous « Plus » — dont le Rapport, qui est l'écran de fin
        // de course. Les libellés sont courts, ils tiennent sur un écran étroit.
        maxVisible={6}
      />
    </>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
