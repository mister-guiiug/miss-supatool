import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from '@mister-guiiug/dev-wpa-config/react/bottom-nav';
import { AppHeader } from '@mister-guiiug/dev-wpa-config/react/app-header';
import { PageContainer } from '@mister-guiiug/dev-wpa-config/react/page-container';
import { ThemeToggle } from '@mister-guiiug/dev-wpa-config/react/theme-toggle';
import {
  DatabaseZap,
  FileClock,
  ListChecks,
  Plug,
  Settings,
} from 'lucide-react';
import { ConnectionsScreen } from './features/connections/ConnectionsScreen.tsx';
import { AnalyzeScreen } from './features/analyze/AnalyzeScreen.tsx';
import { RunScreen } from './features/run/RunScreen.tsx';
import { ReportScreen } from './features/report/ReportScreen.tsx';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';

const NAV = [
  { href: '/', label: 'Projets', icon: <Plug aria-hidden="true" />, end: true },
  {
    href: '/analyse',
    label: 'Contenu',
    icon: <ListChecks aria-hidden="true" />,
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
