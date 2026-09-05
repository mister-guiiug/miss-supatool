import { Card, CardHeader } from '@mister-guiiug/dev-pwa-config/react/card';
import { Badge } from '@mister-guiiug/dev-pwa-config/react/badge';
import {
  formatBytes,
  formatNumber,
} from '@mister-guiiug/dev-pwa-config/format';
import type { BadgeTone } from '@mister-guiiug/dev-pwa-config/react/badge';
import { useStore, type EntityStatus } from '../../store/useStore.ts';

const TONES: Record<EntityStatus, BadgeTone> = {
  pending: 'muted',
  running: 'info',
  done: 'success',
  error: 'danger',
  skipped: 'warning',
};

const LABELS: Record<EntityStatus, string> = {
  pending: 'en attente',
  running: 'en cours',
  done: 'terminé',
  error: 'erreur',
  skipped: 'ignoré',
};

/** Barre d'avancement accessible : la valeur est aussi dite, pas seulement peinte. */
function Bar({ value, max }: { value: number; max?: number }) {
  const ratio = max && max > 0 ? Math.min(1, value / max) : undefined;
  return (
    <div
      className="bar mt-1"
      role="progressbar"
      aria-valuemin={0}
      {...(max ? { 'aria-valuemax': max, 'aria-valuenow': value } : {})}
      aria-label={
        max
          ? `${formatNumber(value)} sur ${formatNumber(max)}`
          : `${formatNumber(value)} traité(s)`
      }
    >
      <span
        style={{
          width: ratio === undefined ? '100%' : `${Math.round(ratio * 100)}%`,
          opacity: ratio === undefined ? 0.35 : 1,
        }}
      />
    </div>
  );
}

export function ProgressList() {
  const tableProgress = useStore(s => s.tableProgress);
  const bucketProgress = useStore(s => s.bucketProgress);
  const journal = useStore(s => s.journal);

  const tables = Object.entries(tableProgress);
  const buckets = Object.entries(bucketProgress);
  if (tables.length === 0 && buckets.length === 0) return null;

  return (
    <>
      {tables.length > 0 ? (
        <Card as="section">
          <CardHeader as="h2" title="Tables" />
          <ul className="grid gap-3">
            {tables.map(([name, progress]) => (
              <li key={name}>
                <div className="flex items-baseline gap-2">
                  <span className="mono min-w-0 flex-1 truncate">{name}</span>
                  <Badge tone={TONES[progress.status]} size="xs">
                    {LABELS[progress.status]}
                  </Badge>
                </div>
                <Bar
                  value={progress.read}
                  {...(progress.estimated !== undefined
                    ? { max: progress.estimated }
                    : {})}
                />
                <p className="mt-1 text-xs text-[var(--st-text-soft)]">
                  {formatNumber(progress.read)} lue(s) ·{' '}
                  {formatNumber(progress.written)} écrite(s)
                  {progress.estimated !== undefined
                    ? ` · ≈ ${formatNumber(progress.estimated)} attendue(s)`
                    : ''}
                  {progress.message ? ` — ${progress.message}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {buckets.length > 0 ? (
        <Card as="section">
          <CardHeader as="h2" title="Fichiers" />
          <ul className="grid gap-3">
            {buckets.map(([name, progress]) => (
              <li key={name}>
                <div className="flex items-baseline gap-2">
                  <span className="mono min-w-0 flex-1 truncate">{name}</span>
                  <Badge tone={TONES[progress.status]} size="xs">
                    {LABELS[progress.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-[var(--st-text-soft)]">
                  {formatNumber(progress.objects)} copié(s) ·{' '}
                  {formatBytes(progress.bytes)}
                  {progress.skipped > 0
                    ? ` · ${formatNumber(progress.skipped)} laissé(s) en place`
                    : ''}
                  {progress.errors > 0
                    ? ` · ${formatNumber(progress.errors)} en erreur`
                    : ''}
                  {progress.message ? ` — ${progress.message}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {journal.length > 0 ? (
        <Card as="section">
          <CardHeader
            as="h2"
            title="Journal"
            subtitle="Les clés éventuellement présentes dans les messages sont masquées."
          />
          <ol
            className="mono grid max-h-72 gap-1 overflow-y-auto"
            aria-live="polite"
          >
            {journal.map((line, index) => (
              <li
                key={`${line.at}-${index}`}
                className={
                  line.level === 'error'
                    ? 'text-[var(--st-danger)]'
                    : line.level === 'warn'
                      ? 'text-[var(--st-warn)]'
                      : 'text-[var(--st-text-soft)]'
                }
              >
                {line.text}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}
