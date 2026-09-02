import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-wpa-config/react/card';
import { Button } from '@mister-guiiug/dev-wpa-config/react/button';
import { Badge } from '@mister-guiiug/dev-wpa-config/react/badge';
import { TextField } from '@mister-guiiug/dev-wpa-config/react/field';
import { EmptyState } from '@mister-guiiug/dev-wpa-config/react/empty-state';
import { SegmentedControl } from '@mister-guiiug/dev-wpa-config/react/segmented-control';
import {
  formatBytes,
  formatNumber,
} from '@mister-guiiug/dev-wpa-config/format';
import { CircleStop, DatabaseZap, FlaskConical, Rocket } from 'lucide-react';
import { hasBlocking } from '../../core/diff.ts';
import { normalizeProjectUrl } from '../../core/project.ts';
import { useStore } from '../../store/useStore.ts';
import { ProgressList } from './ProgressList.tsx';

/** Ce que l'utilisateur doit recopier pour armer une écriture réelle. */
function targetLabel(url: string): string {
  const normalized = normalizeProjectUrl(url);
  if (!normalized) return '';
  return normalized.ref ?? new URL(normalized.base).hostname;
}

export function RunScreen() {
  const navigate = useNavigate();
  const options = useStore(s => s.options);
  const setOptions = useStore(s => s.setOptions);
  const countStrategy = useStore(s => s.countStrategy);
  const setCountStrategy = useStore(s => s.setCountStrategy);
  const running = useStore(s => s.running);
  const start = useStore(s => s.start);
  const abort = useStore(s => s.abort);
  const target = useStore(s => s.target);
  const summary = useStore(s => s.summary);
  const buildPlan = useStore(s => s.plan);
  const [confirmation, setConfirmation] = useState('');

  const plan = buildPlan();
  if (!plan) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<DatabaseZap aria-hidden="true" />}
          title="Aucun plan de copie"
          description="Analysez d'abord les deux projets."
          action={
            <Link to="/">
              <Button variant="primary">Aller aux projets</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const expected = targetLabel(target.url);
  const blocked = hasBlocking(plan.issues);
  const armed =
    options.dryRun ||
    confirmation.trim().toLowerCase() === expected.toLowerCase();
  const canStart = !running && !blocked && armed && plan.tables.length > 0;

  const onStart = async (): Promise<void> => {
    await start();
    if (useStore.getState().summary) navigate('/rapport');
  };

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Mode"
          subtitle="La simulation lit tout et n'écrit rien. C'est le mode par défaut."
        />
        <SegmentedControl
          fullWidth
          ariaLabel="Mode d'exécution"
          value={options.dryRun ? 'simulation' : 'reel'}
          onChange={value => setOptions({ dryRun: value === 'simulation' })}
          options={[
            { value: 'simulation', label: 'Simulation' },
            { value: 'reel', label: 'Copie réelle' },
          ]}
        />
        <p className="mt-3 text-sm text-[var(--st-text-soft)]">
          {plan.tables.length} table(s) et {plan.buckets.length} seau(x) au
          programme, dans cet ordre&nbsp;:{' '}
          <span className="mono">
            {plan.tables
              .slice(0, 6)
              .map(t => t.table)
              .join(' → ')}
            {plan.tables.length > 6 ? ' → …' : ''}
          </span>
        </p>
      </Card>

      <Card as="section">
        <CardHeader as="h2" title="Réglages de la copie" />
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Écriture</legend>
            <SegmentedControl
              fullWidth
              size="sm"
              ariaLabel="Comportement en cas de ligne déjà présente"
              value={options.mode}
              onChange={value =>
                setOptions({ mode: value === 'upsert' ? 'upsert' : 'insert' })
              }
              options={[
                { value: 'upsert', label: 'Mettre à jour' },
                { value: 'insert', label: 'Insérer seulement' },
              ]}
            />
            <p className="text-xs text-[var(--st-text-soft)]">
              « Mettre à jour » remplace une ligne de même clé primaire&nbsp;:
              la copie devient rejouable. « Insérer seulement » échoue sur un
              doublon.
            </p>
          </fieldset>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--st-ok)]"
              checked={options.stopOnError}
              onChange={e => setOptions({ stopOnError: e.target.checked })}
            />
            S'arrêter à la première erreur
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--st-ok)]"
              checked={options.copyStorage}
              onChange={e => setOptions({ copyStorage: e.target.checked })}
            />
            Copier aussi les fichiers du stockage
          </label>

          {options.copyStorage ? (
            <div className="ml-8 grid gap-3">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--st-ok)]"
                  checked={options.createMissingBuckets}
                  onChange={e =>
                    setOptions({ createMissingBuckets: e.target.checked })
                  }
                />
                Créer les seaux absents de la cible
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--st-ok)]"
                  checked={options.overwriteObjects}
                  onChange={e =>
                    setOptions({ overwriteObjects: e.target.checked })
                  }
                />
                Remplacer un fichier déjà présent
              </label>
              <TextField
                label="Fichiers en parallèle"
                type="number"
                min={1}
                max={16}
                value={options.concurrency}
                onChange={e =>
                  setOptions({
                    concurrency: Math.max(
                      1,
                      Math.min(16, Number(e.target.value) || 1)
                    ),
                  })
                }
                hint="Au-delà de 8, la limitation de débit de Supabase se déclenche vite."
              />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Lignes lues par requête"
              type="number"
              min={100}
              max={10000}
              step={100}
              value={options.pageSize}
              onChange={e =>
                setOptions({
                  pageSize: Math.max(
                    100,
                    Math.min(10000, Number(e.target.value) || 1000)
                  ),
                })
              }
            />
            <TextField
              label="Lignes écrites par requête"
              type="number"
              min={50}
              max={5000}
              step={50}
              value={options.batchSize}
              onChange={e =>
                setOptions({
                  batchSize: Math.max(
                    50,
                    Math.min(5000, Number(e.target.value) || 500)
                  ),
                })
              }
            />
          </div>

          <TextField
            label="Colonnes à ne pas copier"
            placeholder="updated_at, search_vector"
            autoComplete="off"
            spellCheck={false}
            value={options.excludedColumns.join(', ')}
            onChange={e =>
              setOptions({
                excludedColumns: e.target.value
                  .split(',')
                  .map(name => name.trim())
                  .filter(name => name !== ''),
              })
            }
            hint="Appliqué à toutes les tables. Nécessaire pour les colonnes GENERATED ALWAYS, qui refusent toute valeur. Les colonnes de clé primaire ne sont jamais écartées."
          />

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Comptage des lignes</legend>
            <SegmentedControl
              fullWidth
              size="sm"
              ariaLabel="Stratégie de comptage"
              value={countStrategy}
              onChange={value =>
                setCountStrategy(value === 'exact' ? 'exact' : 'estimated')
              }
              options={[
                { value: 'estimated', label: 'Estimé (rapide)' },
                { value: 'exact', label: 'Exact (lent)' },
              ]}
            />
            <p className="text-xs text-[var(--st-text-soft)]">
              Le comptage ne sert qu'à la barre d'avancement&nbsp;; un compte
              exact parcourt toute la table.
            </p>
          </fieldset>
        </div>
      </Card>

      {blocked ? (
        <p role="alert" className="text-sm text-[var(--st-danger)]">
          Des anomalies bloquantes subsistent. Corrigez le schéma cible ou
          retirez les tables concernées de la sélection.
        </p>
      ) : null}

      {!options.dryRun ? (
        <Card as="section">
          <CardHeader
            as="h2"
            title="Confirmer le projet cible"
            subtitle="Une écriture réelle ne se déclenche pas par inadvertance."
            action={<Badge tone="danger">écriture réelle</Badge>}
          />
          <TextField
            label={`Recopiez « ${expected} » pour armer la copie`}
            value={confirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={e => setConfirmation(e.target.value)}
            hint="C'est la référence du projet qui va RECEVOIR les données."
          />
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant={options.dryRun ? 'primary' : 'danger'}
          block
          loading={running}
          aria-disabled={!canStart}
          onClick={() => {
            if (canStart) void onStart();
          }}
        >
          {options.dryRun ? (
            <FlaskConical aria-hidden="true" size={18} />
          ) : (
            <Rocket aria-hidden="true" size={18} />
          )}
          {options.dryRun ? 'Lancer la simulation' : 'Lancer la copie'}
        </Button>
        {running ? (
          <Button variant="outline" onClick={abort}>
            <CircleStop aria-hidden="true" size={18} />
            Arrêter
          </Button>
        ) : null}
      </div>

      <ProgressList />

      {summary && !running ? (
        <p className="text-sm text-[var(--st-text-soft)]">
          Dernière exécution&nbsp;:{' '}
          {formatNumber(summary.tables.reduce((acc, t) => acc + t.written, 0))}{' '}
          ligne(s) écrite(s),{' '}
          {formatBytes(summary.buckets.reduce((acc, b) => acc + b.bytes, 0))} de
          fichiers. <Link to="/rapport">Voir le rapport</Link>
        </p>
      ) : null}
    </div>
  );
}
