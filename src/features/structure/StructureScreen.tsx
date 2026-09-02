import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader } from '@mister-guiiug/dev-wpa-config/react/card';
import { Button } from '@mister-guiiug/dev-wpa-config/react/button';
import { Badge } from '@mister-guiiug/dev-wpa-config/react/badge';
import { EmptyState } from '@mister-guiiug/dev-wpa-config/react/empty-state';
import { SegmentedControl } from '@mister-guiiug/dev-wpa-config/react/segmented-control';
import { TextField } from '@mister-guiiug/dev-wpa-config/react/field';
import { ConfirmDialog } from '@mister-guiiug/dev-wpa-config/react/confirm-dialog';
import { downloadText, dateSlug } from '@mister-guiiug/dev-wpa-config/download';
import { formatNumber } from '@mister-guiiug/dev-wpa-config/format';
import {
  Boxes,
  CircleStop,
  Download,
  Hammer,
  ScanSearch,
  Stethoscope,
} from 'lucide-react';
import { probeLabel } from '../../core/diagnostics.ts';
import {
  countByPhase,
  PHASE_LABELS,
  PHASE_ORDER,
} from '../../core/structure.ts';
import { useManagementStore, refOf } from '../../store/useManagementStore.ts';
import { useStore } from '../../store/useStore.ts';

export function StructureScreen() {
  const available = useManagementStore(s => s.available);
  const token = useManagementStore(s => s.token);
  const setToken = useManagementStore(s => s.setToken);
  const reading = useManagementStore(s => s.reading);
  const readProgress = useManagementStore(s => s.readProgress);
  const rows = useManagementStore(s => s.rows);
  const phases = useManagementStore(s => s.phases);
  const togglePhase = useManagementStore(s => s.togglePhase);
  const readSourceStructure = useManagementStore(s => s.readSourceStructure);
  const buildStatements = useManagementStore(s => s.statements);
  const applyStructure = useManagementStore(s => s.applyStructure);
  const applying = useManagementStore(s => s.applying);
  const applyProgress = useManagementStore(s => s.applyProgress);
  const results = useManagementStore(s => s.results);
  const structureError = useManagementStore(s => s.structureError);
  const dryRun = useManagementStore(s => s.dryRun);
  const setDryRun = useManagementStore(s => s.setDryRun);
  const abort = useManagementStore(s => s.abort);
  const probing = useManagementStore(s => s.probing);
  const probes = useManagementStore(s => s.probes);
  const diagnosis = useManagementStore(s => s.diagnosis);
  const runDiagnostics = useManagementStore(s => s.runDiagnostics);

  const source = useStore(s => s.source);
  const target = useStore(s => s.target);
  const [confirming, setConfirming] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const sourceRef = refOf(source.url);
  const targetRef = refOf(target.url);

  if (!available) {
    return (
      <div className="py-6">
        <EmptyState
          icon={<Boxes aria-hidden="true" />}
          title="Copie de structure indisponible ici"
          description="Créer des tables demande du SQL, et l'API de management de Supabase refuse le CORS depuis une page web. Il faut un relais."
        >
          <p className="text-sm text-[var(--st-text-soft)]">
            En développement (<span className="mono">npm run dev</span>), le
            relais est intégré au serveur : rien à faire. En ligne, déployez
            celui de <span className="mono">proxy/</span> et renseignez{' '}
            <span className="mono">VITE_SUPABASE_PROXY</span> au build. La copie
            des <Link to="/analyse">données</Link> fonctionne sans.
          </p>
        </EmptyState>
      </div>
    );
  }

  const statements = buildStatements();
  const counts = countByPhase(statements);
  const failed = results.filter(r => r.status === 'failed');
  const applied = results.filter(r => r.status === 'applied');
  const notAttempted = results.filter(r => r.status === 'not-attempted');

  return (
    <div className="grid gap-4 py-4">
      <Card as="section">
        <CardHeader
          as="h2"
          title="Recopier la structure"
          subtitle="Tables, contraintes, index, vues, fonctions, déclencheurs, RLS et droits — relevés sur la source, rejoués sur la cible."
        />
        <p className="text-sm text-[var(--st-text-soft)]">
          Le relevé demande à Postgres de décrire lui-même ses objets (
          <span className="mono">pg_get_constraintdef</span>,{' '}
          <span className="mono">pg_get_indexdef</span>,{' '}
          <span className="mono">pg_get_functiondef</span>…) : les définitions
          sont exactes, pas reconstituées. La lecture se fait en{' '}
          <strong>lecture seule</strong> côté serveur.
        </p>
        <div className="mt-3 grid gap-3">
          <TokenField token={token} onChange={setToken} />
          {!sourceRef || !targetRef ? (
            <p className="text-sm text-[var(--st-warn)]">
              {!sourceRef
                ? "Le projet source n'est pas identifiable par sa référence"
                : "Le projet cible n'est pas identifiable par sa référence"}{' '}
              (domaine personnalisé ou instance auto-hébergée) : l'API de
              management ne le connaît pas.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              loading={reading}
              aria-disabled={!sourceRef || token.trim() === ''}
              onClick={() => {
                if (sourceRef && token.trim() !== '')
                  void readSourceStructure();
              }}
            >
              <ScanSearch aria-hidden="true" size={18} />
              Relever la structure de la source
            </Button>
            {reading && readProgress.total > 0 ? (
              <span className="self-center text-sm text-[var(--st-text-soft)]">
                {readProgress.done} / {readProgress.total} requêtes
              </span>
            ) : null}
          </div>
        </div>
        {structureError ? (
          <p role="alert" className="mt-3 text-sm text-[var(--st-danger)]">
            {structureError}
          </p>
        ) : null}
      </Card>

      <Card as="section">
        <CardHeader
          as="h2"
          title="Droits du jeton"
          subtitle="Quatre sondes — chaque projet, en lecture puis en écriture — avec une requête qui ne touche à rien."
          action={
            <Button
              size="sm"
              variant="outline"
              loading={probing}
              aria-disabled={token.trim() === ''}
              onClick={() => {
                if (token.trim() !== '') void runDiagnostics();
              }}
            >
              <Stethoscope aria-hidden="true" size={16} />
              Sonder
            </Button>
          }
        />
        <p className="text-sm text-[var(--st-text-soft)]">
          Quand l'API refuse, son message ne dit pas si c'est le projet ou le
          mode qui motive le refus. Ces quatre mesures le disent.
        </p>
        {probes.length > 0 ? (
          <ul className="mt-3 grid gap-1 text-sm">
            {probes.map(probe => (
              <li
                key={`${probe.side}-${probe.mode}`}
                className="flex items-center gap-2"
              >
                <Badge tone={probe.ok ? 'success' : 'danger'} size="xs">
                  {probe.ok ? 'OK' : (probe.status ?? '—')}
                </Badge>
                <span className="min-w-0 flex-1">{probeLabel(probe)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {diagnosis ? (
          <div className="mt-3 grid gap-1 text-sm">
            <p className="font-medium">{diagnosis.conclusion}</p>
            {diagnosis.advice ? (
              <p className="text-[var(--st-text-soft)]">{diagnosis.advice}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {!rows ? null : (
        <>
          <Card as="section">
            <CardHeader
              as="h2"
              title="Ce qui sera créé"
              subtitle={`${formatNumber(statements.length)} instruction(s), dans l'ordre des dépendances.`}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    downloadText(
                      statements.map(s => s.sql).join('\n\n'),
                      `structure-${dateSlug()}.sql`,
                      'application/sql'
                    )
                  }
                >
                  <Download aria-hidden="true" size={16} />
                  SQL
                </Button>
              }
            />
            <ul className="grid gap-1">
              {PHASE_ORDER.map(phase => {
                const count = counts.find(c => c.phase === phase)?.count ?? 0;
                return (
                  <li key={phase}>
                    <label className="flex items-center gap-3 rounded-[var(--radius-card)] px-2 py-1.5 hover:bg-[var(--st-surface-2)]">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[var(--st-ok)]"
                        checked={phases.includes(phase)}
                        onChange={() => togglePhase(phase)}
                      />
                      <span className="flex-1">{PHASE_LABELS[phase]}</span>
                      <Badge tone={count > 0 ? 'info' : 'muted'} size="xs">
                        {formatNumber(count)}
                      </Badge>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSql(v => !v)}
              >
                {showSql ? 'Masquer le SQL' : 'Afficher le SQL'}
              </Button>
            </div>
            {showSql ? (
              <pre className="mono mt-2 max-h-80 overflow-auto rounded-[var(--radius-card)] bg-[var(--st-surface-2)] p-3">
                {statements.map(s => s.sql).join('\n\n')}
              </pre>
            ) : null}
          </Card>

          <Card as="section">
            <CardHeader
              as="h2"
              title="Appliquer à la cible"
              subtitle="Chaque instruction est envoyée séparément : on sait exactement ce qui est passé."
            />
            <SegmentedControl
              fullWidth
              ariaLabel="Mode d'application"
              value={dryRun ? 'simulation' : 'reel'}
              onChange={value => setDryRun(value === 'simulation')}
              options={[
                { value: 'simulation', label: 'Simulation' },
                { value: 'reel', label: 'Appliquer' },
              ]}
            />
            <p className="mt-2 text-xs text-[var(--st-text-soft)]">
              Les instructions sont <strong>rejouables</strong> : une contrainte
              ou une politique déjà présente est ignorée, pas remplacée. Une
              seconde passe rattrape les dépendances qu'un ordre statique ne
              peut pas connaître.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={dryRun ? 'primary' : 'danger'}
                loading={applying}
                aria-disabled={!targetRef || statements.length === 0}
                onClick={() => {
                  if (!targetRef || statements.length === 0) return;
                  if (dryRun) void applyStructure();
                  else setConfirming(true);
                }}
              >
                <Hammer aria-hidden="true" size={18} />
                {dryRun ? 'Simuler' : 'Créer la structure'}
              </Button>
              {applying ? (
                <Button variant="outline" onClick={abort}>
                  <CircleStop aria-hidden="true" size={18} />
                  Arrêter
                </Button>
              ) : null}
            </div>

            {applying && applyProgress.total > 0 ? (
              <p
                className="mt-2 text-sm text-[var(--st-text-soft)]"
                aria-live="polite"
              >
                {applyProgress.done} / {applyProgress.total}
                {applyProgress.current ? ` — ${applyProgress.current}` : ''}
              </p>
            ) : null}

            {results.length > 0 ? (
              <div className="mt-3 grid gap-2">
                <p className="flex flex-wrap gap-1 text-sm">
                  <Badge tone="success" size="xs">
                    {formatNumber(applied.length)} appliquée(s)
                  </Badge>
                  {failed.length > 0 ? (
                    <Badge tone="danger" size="xs">
                      {formatNumber(failed.length)} en échec
                    </Badge>
                  ) : null}
                  {notAttempted.length > 0 ? (
                    <Badge tone="muted" size="xs">
                      {formatNumber(notAttempted.length)} non tentée(s)
                    </Badge>
                  ) : null}
                </p>
                {failed.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {failed.map(result => (
                      <li key={result.statement.object}>
                        <span className="mono">{result.statement.object}</span>{' '}
                        —{' '}
                        <span className="text-[var(--st-danger)]">
                          {result.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {notAttempted.length > 0 ? (
                  <p className="text-sm text-[var(--st-text-soft)]">
                    L'exécution s'est arrêtée au premier refus de droits&nbsp;:
                    les instructions suivantes auraient reçu la même réponse.
                    Rien n'a été laissé à moitié fait de ce côté-là.
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="Créer la structure dans le projet cible ?"
        message={`${statements.length} instruction(s) vont être exécutées sur « ${targetRef ?? ''} ». Les objets déjà présents sont laissés en place ; rien n'est supprimé.`}
        confirmLabel="Créer la structure"
        onConfirm={() => {
          setConfirming(false);
          void applyStructure();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function TokenField({
  token,
  onChange,
}: {
  token: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label="Jeton d'accès personnel Supabase"
      type="password"
      autoComplete="off"
      spellCheck={false}
      value={token}
      onChange={e => onChange(e.target.value)}
      hint="Le même que pour la création de projet. Mémoire seulement : jamais enregistré."
    />
  );
}
