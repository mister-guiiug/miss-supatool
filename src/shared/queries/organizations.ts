import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ManagementClient, type Organization } from '../../api/management.ts';
import { MANAGEMENT_AVAILABLE, PROXY_BASE } from '../../api/managementBase.ts';
import { describeError } from '../../core/errors.ts';
import { useManagementStore } from '../../store/useManagementStore.ts';
import { queryKeys, tokenScope } from './keys.ts';

function clientForToken(token: string): ManagementClient {
  if (!MANAGEMENT_AVAILABLE) {
    throw new Error(
      'Aucun relais configuré : la création de projet et la copie de structure sont indisponibles sur ce déploiement (voir proxy/README.md).'
    );
  }
  if (token.trim() === '') {
    throw new Error("Renseignez votre jeton d'accès personnel Supabase.");
  }
  return new ManagementClient({ proxyBase: PROXY_BASE, token: token.trim() });
}

/** Lecture des organisations pour le `queryFn`. */
export async function fetchOrganizations(
  token: string
): Promise<Organization[]> {
  return clientForToken(token).listOrganizations();
}

function syncOrganizationsToStore(
  organizations: Organization[] | undefined,
  error: unknown | null,
  isFetching: boolean
): void {
  if (error) {
    useManagementStore.setState({
      organizations: [],
      organizationsError: describeError(error),
      loadingOrganizations: false,
    });
    return;
  }
  if (organizations) {
    useManagementStore.setState({
      organizations,
      organizationsError: undefined,
      loadingOrganizations: isFetching,
    });
    return;
  }
  useManagementStore.setState({
    loadingOrganizations: isFetching,
  });
}

/**
 * Organisations du compte — actives dès qu'un jeton est présent.
 * Miroir Zustand pour que CreateProjectCard garde la même API de lecture.
 */
export function useOrganizationsQuery(enabled = true) {
  const token = useManagementStore(s => s.token);
  const trimmed = token.trim();
  const canRun = enabled && MANAGEMENT_AVAILABLE && trimmed !== '';

  const query = useQuery({
    queryKey: queryKeys.organizations(tokenScope(trimmed)),
    queryFn: () => fetchOrganizations(trimmed),
    enabled: canRun,
  });

  useEffect(() => {
    if (!canRun) {
      useManagementStore.setState({
        loadingOrganizations: false,
      });
      return;
    }
    syncOrganizationsToStore(
      query.data,
      query.error,
      query.isFetching && !query.data
    );
  }, [canRun, query.data, query.error, query.isFetching]);

  return query;
}
