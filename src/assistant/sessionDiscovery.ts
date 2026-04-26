import {
  axiosGetWithRetry,
  getOAuthHeaders,
  prepareApiRequest,
  type ListSessionsResponse,
  type SessionResource,
} from '../utils/teleport/api.js';
import { getOauthConfig } from '../constants/oauth.js';

export type AssistantSession = {
  id: string;
  title?: string;
  name?: string;
  environmentId?: string;
  environmentName?: string;
  cwd?: string;
  updatedAt?: string;
};

function isDiscoverableSession(session: SessionResource): boolean {
  return session.session_status !== 'archived';
}

function toAssistantSession(session: SessionResource): AssistantSession {
  return {
    id: session.id,
    title: session.title ?? undefined,
    name: session.title ?? undefined,
    environmentId: session.environment_id,
    cwd: session.session_context.cwd,
    updatedAt: session.updated_at,
  };
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  const { accessToken, orgUUID } = await prepareApiRequest();
  const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`;
  const response = await axiosGetWithRetry<ListSessionsResponse>(url, {
    headers: {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    },
  });

  if (response.status !== 200) {
    throw new Error(`Failed to discover sessions: ${response.status} ${response.statusText}`);
  }

  return response.data.data
    .filter(isDiscoverableSession)
    .sort((a, b) => {
      const at = Date.parse(a.updated_at);
      const bt = Date.parse(b.updated_at);
      return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
    })
    .map(toAssistantSession);
}
