import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-wpa-config/react/card';
import { Button } from '@mister-guiiug/dev-wpa-config/react/button';
import { Badge } from '@mister-guiiug/dev-wpa-config/react/badge';
import { EmptyState } from '@mister-guiiug/dev-wpa-config/react/empty-state';
import { formatNumber } from '@mister-guiiug/dev-wpa-config/format';
import {
  AlertTriangle,
  ArrowRight,
  CircleAlert,
  Info,
  Table2,
} from 'lucide-react';
import { countByLevel } from '../../core/diff.ts';
import { planWarnings } from '../../core/plan.ts';
import { useStore } from '../../store/useStore.ts';

export function AnalyzeScreen() {
  const sourceSchema = useStore(s => s.sourceSchema);
  const targetSchema = useStore(s => s.targetSchema);
  const sourceBuckets = useStore(s => s.sourceBuckets);
  const targetBucketNames = useStore(s => s.targetBucketNames);
  const selectedTables = useStore(s => s.selectedTables);
  const selectedBuckets = useStore(s => s.selectedBuckets);
  const storageError = useStore(s => s.storageError);
  const toggleTable = useStore(s => s.toggleTable);
  const toggleBucket = useStore(s => s.toggleBucket);
  const setSelectedTables = useStore(s => s.setSelectedTables);
  const setSelectedBuckets = useStore(s => s.setSelectedBuckets);
  const buildPlan = useStore(s => s.plan);

  if (!sourceSchema || !targetSchema) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<Table2 aria-hidden="true" />}
          title="Rien à montrer pour l'instant"
          description="Renseignez les deux projets, puis lancez l'analyse."
          action={
            <Link to="/">
              <Button variant="primary">Aller aux projets</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const plan = buildPlan();
  const targetNames = new Set(targetSchema.tables.map(t => t.name));
  const copyable = sourceSchema.tables.filter(
    t => t.insertable && targetNames.has(t.name)
  );
  const missingOnTarget = sourceSchema.tables.filter(
    t => !targetNames.has(t.name)
  );
  const issues = plan?.issues ?? [];
  const levels = countByLevel(issues);
  const warnings = plan ? planWarnings(plan) : [];

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Ce que les deux projets ont en commun"
          subtitle={`${copyable.length} table(s) copiable(s) sur ${sourceSchema.tables.length} à la source.`}
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="info">
            {formatNumber(sourceSchema.tables.length)} table(s) à la source
          </Badge>
          <Badge tone="info">
            {formatNumber(targetSchema.tables.length)} à la cible
          </Badge>
          <Badge tone={missingOnTarget.length > 0 ? 'warning' : 'muted'}>
            {formatNumber(missingOnTarget.length)} absente(s) de la cible
          </Badge>
          <Badge tone="muted">
            {formatNumber(sourceBuckets.length)} seau(x) de stockage
          </Badge>
        </div>
        {missingOnTarget.length > 0 ? (
          <p className="mt-2 text-sm text-[var(--st-text-soft)]">
            Absentes de la cible, donc non proposées&nbsp;:{' '}
            <span className="mono">
              {missingOnTarget
                .slice(0, 8)
                .map(t => t.name)
                .join(', ')}
              {missingOnTarget.length > 8 ? '…' : ''}
            </span>
          </p>
        ) : null}
      </Card>

      <Card as="section">
        <CardHeader
          as="h2"
          title="Tables à copier"
          subtitle={`${selectedTables.length} sélectionnée(s) — copiées dans l'ordre des clés étrangères.`}
          action={
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedTables(copyable.map(t => t.name))}
              >
                Tout
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedTables([])}
              >
                Rien
              </Button>
            </div>
          }
        />
        <ul className="grid gap-1">
          {copyable.map(table => {
            const tablePlan = plan?.tables.find(t => t.table === table.name);
            const position = plan
              ? plan.order.order.indexOf(table.name) + 1
              : 0;
            return (
              <li key={table.name}>
                <label className="flex items-center gap-3 rounded-[var(--radius-card)] px-2 py-2 hover:bg-[var(--st-surface-2)]">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--st-ok)]"
                    checked={selectedTables.includes(table.name)}
                    onChange={() => toggleTable(table.name)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mono block truncate">{table.name}</span>
                    <span className="block text-xs text-[var(--st-text-soft)]">
                      {tablePlan
                        ? `${tablePlan.columns.length} colonne(s) · ${
                            tablePlan.primaryKey.length > 0
                              ? `clé ${tablePlan.primaryKey.join(', ')}`
                              : 'sans clé primaire'
                          } · ${tablePlan.mode === 'upsert' ? 'mise à jour' : 'insertion'}`
                        : `${table.columns.length} colonne(s)`}
                    </span>
                  </span>
                  {position > 0 ? (
                    <Badge tone="muted" size="xs">
                      #{position}
                    </Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card as="section">
        <CardHeader
          as="h2"
          title="Fichiers (stockage)"
          subtitle={
            storageError
              ? 'Le stockage n’a pas pu être interrogé.'
              : `${selectedBuckets.length} seau(x) sélectionné(s).`
          }
          action={
            sourceBuckets.length > 0 ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelectedBuckets(sourceBuckets.map(b => b.name))
                  }
                >
                  Tout
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedBuckets([])}
                >
                  Rien
                </Button>
              </div>
            ) : null
          }
        />
        {storageError ? (
          <p className="text-sm text-[var(--st-warn)]">{storageError}</p>
        ) : sourceBuckets.length === 0 ? (
          <p className="text-sm text-[var(--st-text-soft)]">
            Aucun seau dans le projet source.
          </p>
        ) : (
          <ul className="grid gap-1">
            {sourceBuckets.map(bucket => (
              <li key={bucket.name}>
                <label className="flex items-center gap-3 rounded-[var(--radius-card)] px-2 py-2 hover:bg-[var(--st-surface-2)]">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--st-ok)]"
                    checked={selectedBuckets.includes(bucket.name)}
                    onChange={() => toggleBucket(bucket.name)}
                  />
                  <span className="mono min-w-0 flex-1 truncate">
                    {bucket.name}
                  </span>
                  {bucket.isPublic ? (
                    <Badge tone="warning" size="xs">
                      public
                    </Badge>
                  ) : null}
                  {targetBucketNames.includes(bucket.name) ? (
                    <Badge tone="muted" size="xs">
                      existe
                    </Badge>
                  ) : (
                    <Badge tone="info" size="xs">
                      à créer
                    </Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section">
        <CardHeader
          as="h2"
          title="Vérification"
          subtitle={
            levels.blocking > 0
              ? `${levels.blocking} anomalie(s) bloquante(s) : la copie échouerait.`
              : 'Aucun écart bloquant entre les deux schémas.'
          }
        />
        {issues.length === 0 && warnings.length === 0 ? (
          <p className="text-sm text-[var(--st-text-soft)]">
            Les colonnes de la sélection existent des deux côtés.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {issues.map(issue => (
              <li
                key={`${issue.table}-${issue.column ?? ''}-${issue.code}`}
                className="flex items-start gap-2"
              >
                {issue.level === 'blocking' ? (
                  <CircleAlert
                    aria-hidden="true"
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--st-danger)]"
                  />
                ) : issue.level === 'warning' ? (
                  <AlertTriangle
                    aria-hidden="true"
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--st-warn)]"
                  />
                ) : (
                  <Info
                    aria-hidden="true"
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--st-text-soft)]"
                  />
                )}
                <span>
                  <span className="mono">{issue.table}</span> — {issue.message}
                </span>
              </li>
            ))}
            {warnings.map(warning => (
              <li key={warning} className="flex items-start gap-2">
                <AlertTriangle
                  aria-hidden="true"
                  size={16}
                  className="mt-0.5 shrink-0 text-[var(--st-warn)]"
                />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link to="/copie">
        <Button variant="primary" block>
          Préparer la copie
          <ArrowRight aria-hidden="true" size={18} />
        </Button>
      </Link>
    </div>
  );
}
