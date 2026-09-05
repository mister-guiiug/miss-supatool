import { useState } from 'react';
import { Card, CardHeader } from '@mister-guiiug/dev-pwa-config/react/card';
import { Button } from '@mister-guiiug/dev-pwa-config/react/button';
import { TextField } from '@mister-guiiug/dev-pwa-config/react/field';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { FamilyApps } from '@mister-guiiug/dev-pwa-config/react/family-apps';
import { KeyRound, RotateCcw } from 'lucide-react';
import { APP_ID, REPO_URL, SPONSOR_URL } from '../../links.ts';
import { useStore } from '../../store/useStore.ts';

export function SettingsScreen() {
  const schemaName = useStore(s => s.schemaName);
  const setSchemaName = useStore(s => s.setSchemaName);
  const forgetKeys = useStore(s => s.forgetKeys);
  const reset = useStore(s => s.reset);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Schéma Postgres"
          subtitle="« public » dans la quasi-totalité des projets."
        />
        <TextField
          label="Schéma exposé par l'API"
          value={schemaName}
          autoComplete="off"
          spellCheck={false}
          onChange={e => setSchemaName(e.target.value.trim() || 'public')}
          hint="Un autre schéma n'est lisible que s'il est déclaré dans « Exposed schemas » (Settings → API) des DEUX projets."
        />
      </Card>

      <Card as="section">
        <CardHeader
          as="h2"
          title="Sécurité"
          subtitle="Ce que cette application garde, et ce qu'elle ne garde pas."
        />
        <p className="text-sm text-[var(--st-text-soft)]">
          Les clés de service restent en mémoire&nbsp;: fermer l'onglet les
          efface. Sont conservées sur cet appareil&nbsp;: les URL des projets,
          la sélection de tables et de seaux, et les réglages de copie. Aucune
          donnée de vos bases n'est stockée — elle transite du projet source au
          projet cible et n'est pas conservée ici.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={forgetKeys}>
            <KeyRound aria-hidden="true" size={18} />
            Oublier les clés maintenant
          </Button>
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <RotateCcw aria-hidden="true" size={18} />
            Réinitialiser l'analyse
          </Button>
        </div>
      </Card>

      <Card as="section">
        <CardHeader as="h2" title="À propos" />
        <p className="text-sm text-[var(--st-text-soft)]">
          Version <span className="mono">{__APP_VERSION__}</span> · build{' '}
          <span className="mono">{__APP_BUILD_ID__}</span>
        </p>
        <p className="mt-2 text-sm">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Code source
          </a>
          {' · '}
          <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer">
            Soutenir le projet
          </a>
        </p>
      </Card>

      <Card as="section">
        <FamilyApps currentAppId={APP_ID} repoUrl={REPO_URL} />
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Réinitialiser l'analyse ?"
        message="Les schémas relevés, la sélection et le dernier rapport seront effacés. Les URL des projets sont conservées."
        confirmLabel="Réinitialiser"
        onConfirm={() => {
          reset();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
