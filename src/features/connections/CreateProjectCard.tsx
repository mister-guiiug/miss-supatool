import { useState } from 'react';
import { Card, CardHeader } from '@mister-guiiug/dev-pwa-config/react/card';
import { Button } from '@mister-guiiug/dev-pwa-config/react/button';
import { Badge } from '@mister-guiiug/dev-pwa-config/react/badge';
import {
  SelectField,
  TextField,
} from '@mister-guiiug/dev-pwa-config/react/field';
import { ConfirmDialog } from '@mister-guiiug/dev-pwa-config/react/confirm-dialog';
import { Dices, PlusCircle, RefreshCw } from 'lucide-react';
import { REGIONS } from '../../api/management.ts';
import { useManagementStore } from '../../store/useManagementStore.ts';

/**
 * Un mot de passe de base fabriqué localement.
 *
 * Il n'est ni transmis ailleurs qu'à Supabase, ni conservé : l'utilisateur doit
 * le noter, et l'écran le dit. Alphabet volontairement sans caractères que les
 * chaînes de connexion doivent échapper.
 */
function generatePassword(): string {
  const alphabet =
    'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_';
  const bytes = new Uint32Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map(value => alphabet[value % alphabet.length] ?? 'x')
    .join('');
}

export function CreateProjectCard() {
  const available = useManagementStore(s => s.available);
  const token = useManagementStore(s => s.token);
  const setToken = useManagementStore(s => s.setToken);
  const organizations = useManagementStore(s => s.organizations);
  const loading = useManagementStore(s => s.loadingOrganizations);
  const organizationsError = useManagementStore(s => s.organizationsError);
  const loadOrganizations = useManagementStore(s => s.loadOrganizations);
  const createProject = useManagementStore(s => s.createProject);
  const creating = useManagementStore(s => s.creating);
  const creationStep = useManagementStore(s => s.creationStep);
  const creationError = useManagementStore(s => s.creationError);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [region, setRegion] = useState('eu-west-3');
  const [dbPass, setDbPass] = useState('');
  const [confirming, setConfirming] = useState(false);

  const ready =
    name.trim() !== '' &&
    organizationSlug !== '' &&
    dbPass.length >= 12 &&
    !creating;

  if (!open) {
    return (
      <Card as="section">
        <CardHeader
          as="h2"
          title="Pas encore de projet cible ?"
          subtitle="Miss Supatool peut le créer pour vous, puis y recopier la structure."
          action={
            available ? null : <Badge tone="muted">relais non configuré</Badge>
          }
        />
        {available ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <PlusCircle aria-hidden="true" size={18} />
            Créer un projet Supabase
          </Button>
        ) : (
          <p className="text-sm text-[var(--st-text-soft)]">
            Cette page n'a pas de relais vers l'API de management, sans lequel
            aucune page web ne peut créer un projet ni exécuter du SQL. En
            développement (<span className="mono">npm run dev</span>) le relais
            est intégré ; en ligne, il faut déployer celui de{' '}
            <span className="mono">proxy/</span>. La copie des données, elle,
            fonctionne sans.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card as="section">
      <CardHeader
        as="h2"
        title="Créer le projet cible"
        subtitle="Le projet est créé sur votre compte Supabase, puis branché ici automatiquement."
        action={<Badge tone="warning">action facturable</Badge>}
      />

      <div className="grid gap-3">
        <TextField
          label="Jeton d'accès personnel Supabase"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={e => setToken(e.target.value)}
          hint="Créé dans Account → Access Tokens. Il ouvre TOUT votre compte : gardé en mémoire seulement, jamais enregistré."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={loading}
            aria-disabled={token.trim() === ''}
            onClick={() => {
              if (token.trim() !== '') void loadOrganizations();
            }}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Charger mes organisations
          </Button>
          {organizations.length > 0 ? (
            <span className="text-xs text-[var(--st-text-soft)]">
              {organizations.length} organisation(s) trouvée(s)
            </span>
          ) : null}
        </div>

        {organizationsError ? (
          <p role="alert" className="text-sm text-[var(--st-danger)]">
            {organizationsError}
          </p>
        ) : null}

        <SelectField
          label="Organisation"
          value={organizationSlug}
          onChange={e => setOrganizationSlug(e.target.value)}
          hint="Le plan et la facturation dépendent de l'organisation choisie."
        >
          <option value="">— choisir —</option>
          {organizations.map(organization => (
            <option key={organization.slug} value={organization.slug}>
              {organization.name}
            </option>
          ))}
        </SelectField>

        <TextField
          label="Nom du projet"
          value={name}
          autoComplete="off"
          onChange={e => setName(e.target.value)}
        />

        <SelectField
          label="Région"
          value={region}
          onChange={e => setRegion(e.target.value)}
          hint="Choisissez la même région que la source pour limiter la latence."
        >
          {REGIONS.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </SelectField>

        <TextField
          label="Mot de passe de la base"
          type="password"
          autoComplete="new-password"
          value={dbPass}
          onChange={e => setDbPass(e.target.value)}
          hint="12 caractères minimum. NOTEZ-LE : Supabase ne le réaffichera pas, et cette application ne le conserve pas."
        />
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDbPass(generatePassword())}
          >
            <Dices aria-hidden="true" size={16} />
            Proposer un mot de passe
          </Button>
        </div>

        {creationStep ? (
          <p className="text-sm text-[var(--st-text-soft)]" aria-live="polite">
            {creationStep}
          </p>
        ) : null}
        {creationError ? (
          <p role="alert" className="text-sm text-[var(--st-danger)]">
            {creationError}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={creating}
            aria-disabled={!ready}
            onClick={() => {
              if (ready) setConfirming(true);
            }}
          >
            <PlusCircle aria-hidden="true" size={18} />
            Créer le projet
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Créer un projet Supabase ?"
        message={`Un projet « ${name} » va être créé dans l'organisation « ${organizationSlug} », région ${region}. Selon votre plan, cela peut être facturé. Miss Supatool ne sait pas supprimer un projet : la suppression se fait depuis le tableau de bord Supabase.`}
        confirmLabel="Créer le projet"
        onConfirm={() => {
          setConfirming(false);
          void createProject({ name, organizationSlug, region, dbPass });
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
