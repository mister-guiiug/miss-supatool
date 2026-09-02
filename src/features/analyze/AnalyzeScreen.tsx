import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-wpa-config/react/card';
import { Button } from '@mister-guiiug/dev-wpa-config/react/button';
import { Badge } from '@mister-guiiug/dev-wpa-config/react/badge';
import { EmptyState } from '@mister-guiiug/dev-wpa-config/react/empty-state';
import { formatNumber } from '@mister-guiiug/dev-wpa-config/format';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
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
  /**
   * Toutes les tables de la source, y compris celles qui manquent à la cible.
   *
   * Elles étaient auparavant écartées de la liste : « absentes de la cible,
   * donc non proposées ». C'était vrai tant que l'outil ne savait pas créer de
   * structure — ce n'est plus le cas. Une table absente n'est plus un
   * cul-de-sac, c'est une table à créer avant d'être remplie, et la choisir ici
   * est le seul moyen de dire qu'on la veut.
   */
  const selectable = sourceSchema.tables.filter(t => t.insertable);
  const missingOnTarget = selectable.filter(t => !targetNames.has(t.name));
  const missingSelected = missingOnTarget.filter(t =>
    selectedTables.includes(t.name)
  );
  const issues = plan?.issues ?? [];
  const levels = countByLevel(issues);
  const warnings = plan ? planWarnings(plan) : [];

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Ce que les deux projets contiennent"
          subtitle={`${selectable.length} table(s) à la source, dont ${missingOnTarget.length} à créer dans la cible.`}
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
            Absentes de la cible&nbsp;:{' '}
            <span className="mono">
              {missingOnTarget
                .slice(0, 8)
                .map(t => t.name)
                .join(', ')}
              {missingOnTarget.length > 8 ? '…' : ''}
            </span>
            . Sélectionnez-les quand même&nbsp;: l'étape{' '}
            <Link to="/structure">Structure</Link> les créera, et elles seront
            alors remplissables.
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
                onClick={() => setSelectedTables(selectable.map(t => t.name))}
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
          {selectable.map(table => {
            const absent = !targetNames.has(table.name);
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
                      {absent
                        ? `${table.columns.length} colonne(s) · à créer dans la cible`
                        : tablePlan
                          ? `${tablePlan.columns.length} colonne(s) · ${
                              tablePlan.primaryKey.length > 0
                                ? `clé ${tablePlan.primaryKey.join(', ')}`
                                : 'sans clé primaire'
                            } · ${tablePlan.mode === 'upsert' ? 'mise à jour' : 'insertion'}`
                          : `${table.columns.length} colonne(s)`}
                    </span>
                  </span>
                  {absent ? (
                    <Badge tone="warning" size="xs">
                      à créer
                    </Badge>
                  ) : null}
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
          action={
            missingSelected.length > 0 ? (
              <Link to="/structure">
                <Button size="sm" variant="primary">
                  <Boxes aria-hidden="true" size={16} />
                  Créer la structure
                </Button>
              </Link>
            ) : null
          }
        />
        {missingSelected.length > 0 ? (
          <p className="mb-2 text-sm">
            {formatNumber(missingSelected.length)} table(s) sélectionnée(s)
            n'existent pas encore dans la cible. Créez la structure d'abord,
            puis relancez l'analyse&nbsp;: elles deviendront remplissables.
          </p>
        ) : null}
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
