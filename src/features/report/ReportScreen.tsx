import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-pwa-config/react/card';
import { Button } from '@mister-guiiug/dev-pwa-config/react/button';
import { Badge } from '@mister-guiiug/dev-pwa-config/react/badge';
import { Stat } from '@mister-guiiug/dev-pwa-config/react/stat';
import { EmptyState } from '@mister-guiiug/dev-pwa-config/react/empty-state';
import { dateSlug, downloadJson } from '@mister-guiiug/dev-pwa-config/download';
import {
  formatBytes,
  formatDuration,
  formatNumber,
} from '@mister-guiiug/dev-pwa-config/format';
import { Download, FileClock, ListRestart } from 'lucide-react';
import { redactDeep } from '../../core/redact.ts';
import { totalObjects, totalRows } from '../../engine/events.ts';
import { useStore } from '../../store/useStore.ts';
import { useManagementStore } from '../../store/useManagementStore.ts';

/**
 * Le rattrapage des séquences, là où il se remarque : juste après une copie
 * réelle.
 *
 * Les lignes ont été insérées avec leurs identifiants, mais la séquence de la
 * cible est restée à 1 : la première insertion applicative entrerait en
 * conflit. Le README l'expliquait ; maintenant que l'application sait exécuter
 * du SQL, elle peut le faire.
 */
function SequenceReset() {
  const available = useManagementStore(s => s.available);
  const token = useManagementStore(s => s.token);
  const applying = useManagementStore(s => s.applying);
  const results = useManagementStore(s => s.results);
  const error = useManagementStore(s => s.structureError);
  const resetSequences = useManagementStore(s => s.resetSequences);
  if (!available) return null;

  const done = results.filter(r => r.statement.phase === 'sequence');

  return (
    <Card as="section">
      <CardHeader
        as="h2"
        title="Séquences de la cible"
        subtitle="À faire après une copie réelle : sans cela, la première insertion de votre application entrerait en conflit."
      />
      <Button
        variant="outline"
        loading={applying}
        aria-disabled={token.trim() === ''}
        onClick={() => {
          if (token.trim() !== '') void resetSequences();
        }}
      >
        <ListRestart aria-hidden="true" size={18} />
        Remettre les séquences à niveau
      </Button>
      {token.trim() === '' ? (
        <p className="mt-2 text-xs text-[var(--st-text-soft)]">
          Demande le jeton d'accès personnel, saisi dans l'écran Structure.
        </p>
      ) : null}
      {done.length > 0 ? (
        <p className="mt-2 text-sm text-[var(--st-text-soft)]">
          {formatNumber(done.length)} séquence(s) traitée(s).
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--st-danger)]">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export function ReportScreen() {
  const summary = useStore(s => s.summary);
  const journal = useStore(s => s.journal);
  const source = useStore(s => s.source);
  const target = useStore(s => s.target);

  if (!summary) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<FileClock aria-hidden="true" />}
          title="Aucune exécution"
          description="Le rapport s'écrit à la fin d'une simulation ou d'une copie."
          action={
            <Link to="/copie">
              <Button variant="primary">Aller à la copie</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const rows = totalRows(summary);
  const objects = totalObjects(summary);
  const duration = summary.finishedAt - summary.startedAt;

  const onDownload = (): void => {
    // Le rapport est fait pour être transmis : les URL y sont, les clés
    // jamais, et tout texte libre repasse par le masquage.
    downloadJson(
      redactDeep({
        app: 'miss-supatool',
        version: __APP_VERSION__,
        source: source.url,
        target: target.url,
        summary,
        journal,
      }),
      `miss-supatool-${dateSlug()}.json`
    );
  };

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title={summary.dryRun ? 'Simulation' : 'Copie réelle'}
          subtitle={new Date(summary.startedAt).toLocaleString('fr-FR')}
          action={
            summary.aborted ? (
              <Badge tone="warning">interrompue</Badge>
            ) : summary.errorCount > 0 ? (
              <Badge tone="danger">
                {formatNumber(summary.errorCount)} erreur(s)
              </Badge>
            ) : (
              <Badge tone="success">sans erreur</Badge>
            )
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lignes lues" value={formatNumber(rows.read)} />
          <Stat label="Lignes écrites" value={formatNumber(rows.written)} />
          <Stat label="Fichiers" value={formatNumber(objects.objects)} />
          <Stat label="Durée" value={formatDuration(duration)} />
        </div>
        {summary.dryRun ? (
          <p className="mt-3 text-sm text-[var(--st-text-soft)]">
            Aucune donnée n'a été écrite&nbsp;: c'était une simulation. Les
            volumes annoncés sont ceux qui seraient copiés.
          </p>
        ) : null}
      </Card>

      <Card as="section">
        <CardHeader as="h2" title="Détail par table" />
        <ul className="grid gap-2 text-sm">
          {summary.tables.map(table => (
            <li key={table.table} className="flex items-baseline gap-2">
              <span className="mono min-w-0 flex-1 truncate">
                {table.table}
              </span>
              <span className="text-[var(--st-text-soft)]">
                {formatNumber(table.read)} lue(s) ·{' '}
                {formatNumber(table.written)} écrite(s)
              </span>
              {table.error ? (
                <Badge tone="danger" size="xs">
                  erreur
                </Badge>
              ) : table.skipped ? (
                <Badge tone="warning" size="xs">
                  ignorée
                </Badge>
              ) : (
                <Badge tone="muted" size="xs">
                  {formatDuration(table.durationMs)}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {summary.buckets.length > 0 ? (
        <Card as="section">
          <CardHeader as="h2" title="Détail par seau" />
          <ul className="grid gap-2 text-sm">
            {summary.buckets.map(bucket => (
              <li key={bucket.bucket} className="flex items-baseline gap-2">
                <span className="mono min-w-0 flex-1 truncate">
                  {bucket.bucket}
                </span>
                <span className="text-[var(--st-text-soft)]">
                  {formatNumber(bucket.objects)} fichier(s) ·{' '}
                  {formatBytes(bucket.bytes)}
                </span>
                {bucket.created ? (
                  <Badge tone="info" size="xs">
                    créé
                  </Badge>
                ) : null}
                {bucket.errors > 0 ? (
                  <Badge tone="danger" size="xs">
                    {formatNumber(bucket.errors)}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {summary.dryRun ? null : <SequenceReset />}

      <Button variant="outline" block onClick={onDownload}>
        <Download aria-hidden="true" size={18} />
        Télécharger le rapport (JSON)
      </Button>
    </div>
  );
}
