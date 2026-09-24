import { useState } from 'react';
import { Card, CardHeader } from '@mister-guiiug/dev-pwa-config/react/card';
import { Button } from '@mister-guiiug/dev-pwa-config/react/button';
import { TextField } from '@mister-guiiug/dev-pwa-config/react/field';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { FamilyApps } from '@mister-guiiug/dev-pwa-config/react/family-apps';
import { AppFooter } from '@mister-guiiug/dev-pwa-config/react/app-footer';
import { KeyRound, RotateCcw } from 'lucide-react';
import { APP_ID, REPO_URL } from '../../links.ts';
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

      {/* Plus de carte « À propos » : elle ne portait que le numéro de version
          et l'identifiant de build. Les deux liens ne sont plus recopiés ici
          non plus — le pied de page de la coquille les porte sur TOUS les
          écrans, celui-ci compris. */}

      <Card as="section">
        {/* Cette app n'a jamais réécrit l'habillage de la grille : elle prend
            la base du paquet telle quelle, et n'a donc pas besoin de
            `layout`. Ne manquait que le repli — dix-neuf cartes d'affilée
            font un mur, sept lignes non. */}
        <FamilyApps
          currentAppId={APP_ID}
          // Le code source et le soutien viennent du pied de page ci-dessous,
          // avec la version et le signalement : pas deux fois les mêmes liens.
          showSource={false}
          showSponsor={false}
          groupBy="category"
        />
      </Card>

      {/* Le code source, le soutien et le signalement : ici et sur l'accueil,
          nulle part ailleurs (règle famille du 06/09/2026). */}
      <AppFooter version issues repoUrl={REPO_URL} />

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
