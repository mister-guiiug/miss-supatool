import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-wpa-config/react/card';
import { Button } from '@mister-guiiug/dev-wpa-config/react/button';
import { TextField } from '@mister-guiiug/dev-wpa-config/react/field';
import { Badge } from '@mister-guiiug/dev-wpa-config/react/badge';
import {
  ArrowRight,
  Database,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { checkConnection, isSameProject } from '../../core/project.ts';
import { useStore, type Connection } from '../../store/useStore.ts';
import { CreateProjectCard } from './CreateProjectCard.tsx';

/**
 * La prop s'appelle `side` et non `role` : `role` sur un composant JSX est lu
 * par eslint-plugin-jsx-a11y comme un rôle ARIA, et « source » n'en est pas un.
 */
function RoleBadge({
  connection,
  side,
}: {
  connection: Connection;
  side: 'source' | 'target';
}) {
  if (connection.key.trim() === '') return null;
  const check = checkConnection(connection, side);
  const info = check.normalized?.keyInfo;
  if (info?.role === 'service_role') {
    return (
      <Badge tone="success" icon={<ShieldCheck aria-hidden="true" size={14} />}>
        clé de service
      </Badge>
    );
  }
  if (info?.role === 'secret') {
    return (
      <Badge tone="warning" icon={<ShieldAlert aria-hidden="true" size={14} />}>
        clé secrète (nouveau format)
      </Badge>
    );
  }
  if (info?.role === 'anon' || info?.role === 'publishable') {
    return (
      <Badge tone="warning" icon={<ShieldAlert aria-hidden="true" size={14} />}>
        clé publique
      </Badge>
    );
  }
  return <Badge tone="muted">clé non reconnue</Badge>;
}

function ConnectionCard({
  side,
  title,
  subtitle,
}: {
  side: 'source' | 'target';
  title: string;
  subtitle: string;
}) {
  const connection = useStore(s => s[side]);
  const setConnection = useStore(s => s.setConnection);
  const [visible, setVisible] = useState(false);
  const check = checkConnection(connection, side);
  const touched = connection.url.trim() !== '' || connection.key.trim() !== '';

  return (
    <Card as="section">
      <CardHeader
        as="h2"
        title={title}
        subtitle={subtitle}
        action={<RoleBadge connection={connection} side={side} />}
      />
      <div className="grid gap-3">
        <TextField
          label="URL du projet"
          placeholder="https://xxxxxxxxxxxx.supabase.co"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={connection.url}
          onChange={e => setConnection(side, { url: e.target.value })}
          hint="L'adresse indiquée dans Settings → API. La référence seule suffit."
        />
        <div className="grid gap-1">
          <TextField
            label="Clé de service (service_role)"
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={connection.key}
            onChange={e => setConnection(side, { key: e.target.value })}
            hint="Conservée en mémoire uniquement : elle disparaît à la fermeture de l'onglet."
          />
          <div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setVisible(v => !v)}
            >
              {visible ? (
                <EyeOff aria-hidden="true" size={16} />
              ) : (
                <Eye aria-hidden="true" size={16} />
              )}
              {visible ? 'Masquer la clé' : 'Afficher la clé'}
            </Button>
          </div>
        </div>

        {touched && check.errors.length > 0 ? (
          <ul className="text-sm text-[var(--st-danger)]">
            {check.errors.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        {touched && check.warnings.length > 0 ? (
          <ul className="text-sm text-[var(--st-warn)]">
            {check.warnings.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

export function ConnectionsScreen() {
  const navigate = useNavigate();
  const source = useStore(s => s.source);
  const target = useStore(s => s.target);
  const analyze = useStore(s => s.analyze);
  const analyzing = useStore(s => s.analyzing);
  const analysisError = useStore(s => s.analysisError);

  const sourceOk = checkConnection(source, 'source').ok;
  const targetOk = checkConnection(target, 'target').ok;
  const sameProject = isSameProject(source.url, target.url);
  const ready = sourceOk && targetOk && !sameProject;

  const onAnalyze = async (): Promise<void> => {
    await analyze();
    if (!useStore.getState().analysisError) navigate('/analyse');
  };

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Migrer un projet Supabase vers un autre"
          subtitle="La structure de la base, les lignes de vos tables et les fichiers de vos seaux, d'un projet à l'autre, depuis ce navigateur."
        />
        <p className="text-sm text-[var(--st-text-soft)]">
          Trois temps&nbsp;: brancher les deux projets, recopier la{' '}
          <strong>structure</strong> (tables, contraintes, index, politiques
          RLS…), puis verser les <strong>données</strong> et les fichiers. Si le
          projet cible n'existe pas encore, Miss Supatool peut le créer. Chaque
          étape se simule avant de s'exécuter.
        </p>
      </Card>

      <ConnectionCard
        side="source"
        title="Projet source"
        subtitle="Lu, jamais modifié — l'outil refuse toute écriture vers lui."
      />
      <CreateProjectCard />

      <ConnectionCard
        side="target"
        title="Projet cible"
        subtitle="C'est ici que les données seront écrites."
      />

      {sameProject ? (
        <p role="alert" className="text-sm text-[var(--st-danger)]">
          Source et cible désignent le même projet. Choisissez deux projets
          différents.
        </p>
      ) : null}
      {analysisError ? (
        <p role="alert" className="text-sm text-[var(--st-danger)]">
          {analysisError}
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        loading={analyzing}
        aria-disabled={!ready}
        onClick={() => {
          if (ready) void onAnalyze();
        }}
      >
        {analyzing ? (
          <Loader2 aria-hidden="true" size={18} />
        ) : (
          <Database aria-hidden="true" size={18} />
        )}
        Analyser les deux projets
        <ArrowRight aria-hidden="true" size={18} />
      </Button>

      <p className="text-xs text-[var(--st-text-soft)]">
        Les clés ne sont jamais enregistrées&nbsp;: elles restent en mémoire le
        temps de l'onglet. Seules les URL, la sélection et les réglages sont
        conservés sur cet appareil.
      </p>
    </div>
  );
}
