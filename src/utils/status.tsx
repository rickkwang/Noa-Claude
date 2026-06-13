// @ts-nocheck
import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { color, Text } from '../ink.js';
import type { MCPServerConnection } from '../services/mcp/types.js';
import { getAccountInformation, isClaudeAISubscriber } from './auth.js';
import { getLargeMemoryFiles, getMemoryFiles, MAX_MEMORY_CHARACTER_COUNT } from './claudemd.js';
import { getDoctorDiagnostic } from './doctorDiagnostic.js';
import { getAWSRegion, getDefaultVertexRegion, isEnvTruthy } from './envUtils.js';
import { getDisplayPath } from './file.js';
import { formatNumber } from './format.js';
import { getIdeClientName, type IDEExtensionInstallationStatus, isJetBrainsIde, toIDEDisplayName } from './ide.js';
import { getInitializationStatus, getLspServerManager, isLspConnected } from '../services/lsp/manager.js';
import { getClaudeAiUserDefaultModelDescription, modelDisplayString } from './model/model.js';
import { getAPIProvider } from './model/providers.js';
import { getMTLSConfig } from './mtls.js';
import { checkInstall } from './nativeInstaller/index.js';
import { getProxyUrl } from './proxy.js';
import { getRipgrepStatus } from './ripgrep.js';
import { SandboxManager, getSandboxRuntimeCompatibility } from './sandbox/sandbox-adapter.js';
import { getSettingsWithAllErrors } from './settings/allErrors.js';
import { getEnabledSettingSources, getSettingSourceDisplayNameCapitalized } from './settings/constants.js';
import { getManagedFileSettingsPresence, getPolicySettingsOrigin, getSettingsForSource } from './settings/settings.js';
import type { ThemeName } from './theme.js';
import { getCurrentWorktreeSession } from './worktree.js';
import { getQuerySourceForREPL } from './promptCategory.js';
import { getPromptCache1hDiagnostic } from './promptCache1h.js';
export type Property = {
  label?: string;
  value: React.ReactNode | Array<string>;
};
export type Diagnostic = React.ReactNode;
export function buildSandboxProperties(): Property[] {
  if ("external" !== 'ant') {
    return [];
  }
  const isSandboxed = SandboxManager.isSandboxingEnabled();
  const compatibility = getSandboxRuntimeCompatibility();
  const properties: Property[] = [{
    label: 'Bash Sandbox',
    value: isSandboxed ? 'Enabled' : 'Disabled'
  }];
  if (compatibility.compatible) {
    properties.push({
      label: 'Sandbox runtime',
      value: compatibility.version ? `Compatible (v${compatibility.version})` : 'Compatible'
    });
  } else if (compatibility.isStubRuntime) {
    properties.push({
      label: 'Sandbox runtime',
      value: 'Stub runtime loaded; compatibility fallbacks active'
    });
  } else {
    properties.push({
      label: 'Sandbox runtime',
      value: compatibility.version ? `Partial compatibility (v${compatibility.version})` : 'Partial compatibility'
    });
  }
  return properties;
}
export function buildLspProperties(): Property[] {
  const status = getInitializationStatus();
  const manager = getLspServerManager();
  const servers = manager ? Array.from(manager.getAllServers().values()) : [];
  const healthyCount = servers.filter(server => server.state !== 'error').length;
  const failedCount = servers.filter(server => server.state === 'error').length;
  switch (status.status) {
    case 'success':
      return [{
        label: 'LSP',
        value: isLspConnected() ? `Connected (${healthyCount} server${healthyCount === 1 ? '' : 's'} ready${failedCount > 0 ? `, ${failedCount} failed` : ''})` : 'Initialized with no active servers'
      }, {
        label: 'LSP features',
        value: 'Diagnostics, hover, go-to-definition, references'
      }];
    case 'pending':
      return [{
        label: 'LSP',
        value: 'Initializing'
      }];
    case 'failed':
      return [{
        label: 'LSP',
        value: `Failed to initialize: ${status.error.message}`
      }, {
        label: 'LSP action',
        value: 'Check /doctor for startup errors or run /reload-plugins in ~/.noa if language servers were just installed'
      }];
    default:
      return [{
        label: 'LSP',
        value: 'Not started'
      }, {
        label: 'LSP action',
        value: 'LSP starts in normal interactive mode; bare/print mode does not initialize it'
      }];
  }
}
export function buildPluginProperties(enabledPlugins: unknown[] = [], pluginErrors: unknown[] = [], needsRefresh: boolean = false): Property[] {
  if (enabledPlugins.length === 0 && pluginErrors.length === 0 && !needsRefresh) {
    return [];
  }
  const parts: string[] = [];
  if (enabledPlugins.length > 0) {
    parts.push(`${enabledPlugins.length} enabled`);
  }
  if (pluginErrors.length > 0) {
    parts.push(`${pluginErrors.length} failed`);
  }
  if (needsRefresh) {
    parts.push('reload needed');
  }
  return [{
    label: 'Plugins',
    value: parts.join(', ')
  }];
}
export function buildIDEProperties(mcpClients: MCPServerConnection[], ideInstallationStatus: IDEExtensionInstallationStatus | null = null, theme: ThemeName): Property[] {
  const ideClient = mcpClients?.find(client => client.name === 'ide');
  if (ideInstallationStatus) {
    const ideName = toIDEDisplayName(ideInstallationStatus.ideType);
    const pluginOrExtension = isJetBrainsIde(ideInstallationStatus.ideType) ? 'plugin' : 'extension';
    if (ideInstallationStatus.error) {
      return [{
        label: 'IDE',
        value: <Text>
              {color('error', theme)(figures.cross)} Error installing {ideName}{' '}
              {pluginOrExtension}: {ideInstallationStatus.error}
              {'\n'}Please restart your IDE and try again.
            </Text>
      }];
    }
    if (ideInstallationStatus.installed) {
      if (ideClient && ideClient.type === 'connected') {
        if (ideInstallationStatus.installedVersion !== ideClient.serverInfo?.version) {
          return [{
            label: 'IDE',
            value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion} (server version: ${ideClient.serverInfo?.version})`
          }];
        } else {
          return [{
            label: 'IDE',
            value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion}`
          }];
        }
      } else {
        return [{
          label: 'IDE',
          value: `Installed ${ideName} ${pluginOrExtension}`
        }];
      }
    }
  } else if (ideClient) {
    const ideName = getIdeClientName(ideClient) ?? 'IDE';
    if (ideClient.type === 'connected') {
      return [{
        label: 'IDE',
        value: `Connected to ${ideName} extension`
      }];
    } else {
      return [{
        label: 'IDE',
        value: `${color('error', theme)(figures.cross)} Not connected to ${ideName}`
      }];
    }
  }
  return [];
}
export function buildMcpProperties(clients: MCPServerConnection[] = [], theme: ThemeName): Property[] {
  const servers = clients.filter(client => client.name !== 'ide');
  if (!servers.length) {
    return [];
  }

  // Summary instead of a full server list — 20+ servers wrapped onto many
  // rows, dominating the Status pane. Show counts by state + /mcp hint.
  const byState = {
    connected: 0,
    pending: 0,
    needsAuth: 0,
    failed: 0
  };
  for (const s of servers) {
    if (s.type === 'connected') byState.connected++;else if (s.type === 'pending') byState.pending++;else if (s.type === 'needs-auth') byState.needsAuth++;else byState.failed++;
  }
  const parts: string[] = [];
  if (byState.connected) parts.push(color('success', theme)(`${byState.connected} connected`));
  if (byState.needsAuth) parts.push(color('warning', theme)(`${byState.needsAuth} need auth`));
  if (byState.pending) parts.push(color('inactive', theme)(`${byState.pending} pending`));
  if (byState.failed) parts.push(color('error', theme)(`${byState.failed} failed`));
  return [{
    label: 'MCP servers',
    value: `${parts.join(', ')} ${color('inactive', theme)('· /mcp')}`
  }];
}
export async function buildMemoryDiagnostics(): Promise<Diagnostic[]> {
  const files = await getMemoryFiles();
  const largeFiles = getLargeMemoryFiles(files);
  const diagnostics: Diagnostic[] = [];
  largeFiles.forEach(file => {
    const displayPath = getDisplayPath(file.path);
    diagnostics.push(`Large ${displayPath} will impact performance (${formatNumber(file.content.length)} chars > ${formatNumber(MAX_MEMORY_CHARACTER_COUNT)})`);
  });
  return diagnostics;
}
export function buildSettingSourcesProperties(): Property[] {
  const enabledSources = getEnabledSettingSources();

  // Filter to only sources that actually have settings loaded
  const sourcesWithSettings = enabledSources.filter(source => {
    const settings = getSettingsForSource(source);
    return settings !== null && Object.keys(settings).length > 0;
  });

  // Map internal names to user-friendly names
  // For policySettings, distinguish between remote and local (or skip if neither exists)
  const sourceNames = sourcesWithSettings.map(source => {
    if (source === 'policySettings') {
      const origin = getPolicySettingsOrigin();
      if (origin === null) {
        return null; // Skip - no policy settings exist
      }
      switch (origin) {
        case 'remote':
          return 'Enterprise managed settings (remote)';
        case 'plist':
          return 'Enterprise managed settings (plist)';
        case 'hklm':
          return 'Enterprise managed settings (HKLM)';
        case 'file':
          {
            const {
              hasBase,
              hasDropIns
            } = getManagedFileSettingsPresence();
            if (hasBase && hasDropIns) {
              return 'Enterprise managed settings (file + drop-ins)';
            }
            if (hasDropIns) {
              return 'Enterprise managed settings (drop-ins)';
            }
            return 'Enterprise managed settings (file)';
          }
        case 'hkcu':
          return 'Enterprise managed settings (HKCU)';
      }
    }
    return getSettingSourceDisplayNameCapitalized(source);
  }).filter((name): name is string => name !== null);
  return [{
    label: 'Setting sources',
    value: sourceNames
  }];
}

function promptCacheReasonLabel(reason: string): string {
  switch (reason) {
    case 'enabled':
      return 'enabled'
    case 'enabled_bedrock_env':
      return 'enabled (Bedrock env override)'
    case 'prompt_caching_disabled':
      return 'disabled (prompt caching disabled by environment/model switch)'
    case 'not_eligible':
      return 'disabled (not eligible: requires ant or subscriber without overage)'
    case 'allowlist_miss':
      return 'disabled (querySource not in allowlist)'
    case 'missing_query_source':
      return 'disabled (missing querySource)'
    default:
      return `disabled (${reason})`
  }
}

export function buildPromptCacheProperties(
  mainLoopModel?: string | null,
): Property[] {
  const querySource = getQuerySourceForREPL()
  const diag = getPromptCache1hDiagnostic(querySource, mainLoopModel ?? undefined)
  return [{
    label: 'Prompt cache 1h',
    value: promptCacheReasonLabel(diag.reason),
  }, {
    label: 'Prompt cache querySource',
    value: diag.querySource ?? 'n/a',
  }, {
    label: 'Prompt cache allowlist',
    value: diag.allowlist.length > 0 ? diag.allowlist : ['(empty)'],
  }]
}
export async function buildInstallationDiagnostics(): Promise<Diagnostic[]> {
  const installWarnings = await checkInstall();
  return installWarnings.map(warning => warning.message);
}
export async function buildInstallationHealthDiagnostics(): Promise<Diagnostic[]> {
  const diagnostic = await getDoctorDiagnostic();
  const items: Diagnostic[] = [];
  const {
    errors: validationErrors
  } = getSettingsWithAllErrors();
  if (validationErrors.length > 0) {
    const invalidFiles = Array.from(new Set(validationErrors.map(error => error.file)));
    const fileList = invalidFiles.join(', ');
    items.push(`Found invalid settings files: ${fileList}. They will be ignored.`);
  }

  // Add warnings from doctor diagnostic (includes leftover installations, config mismatches, etc.)
  diagnostic.warnings.forEach(warning => {
    items.push(warning.issue);
  });
  if (diagnostic.hasUpdatePermissions === false) {
    items.push('No write permissions for auto-updates (requires sudo)');
  }
  if (!diagnostic.ripgrepStatus.working) {
    items.push(
      diagnostic.ripgrepStatus.mode === 'system'
        ? `ripgrep is not working at ${diagnostic.ripgrepStatus.systemPath ?? 'system path'}`
        : 'ripgrep fallback is active; file search may be degraded',
    );
  }
  return items;
}
export function buildAccountProperties(): Property[] {
  const accountInfo = getAccountInformation();
  if (!accountInfo) {
    return [];
  }
  const properties: Property[] = [];
  if (accountInfo.subscription) {
    properties.push({
      label: 'Login method',
      value: `${accountInfo.subscription} Account`
    });
  }
  if (accountInfo.tokenSource) {
    properties.push({
      label: 'Auth token',
      value: accountInfo.tokenSource
    });
  }
  if (accountInfo.apiKeySource) {
    properties.push({
      label: 'API key',
      value: accountInfo.apiKeySource
    });
  }

  // Hide sensitive account info in demo mode
  if (accountInfo.organization && !process.env.IS_DEMO) {
    properties.push({
      label: 'Organization',
      value: accountInfo.organization
    });
  }
  if (accountInfo.email && !process.env.IS_DEMO) {
    properties.push({
      label: 'Email',
      value: accountInfo.email
    });
  }
  return properties;
}
export function buildAPIProviderProperties(): Property[] {
  const apiProvider = getAPIProvider();
  const properties: Property[] = [];
  if (apiProvider === 'firstParty') {
    const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const isThirdPartyAnthropicCompatible = !!anthropicBaseUrl && !anthropicBaseUrl.includes('anthropic.com');
    properties.push({
      label: 'Backend mode',
      value: isThirdPartyAnthropicCompatible ? 'Third-party Anthropic-compatible' : 'Official Anthropic'
    });
  } else {
    properties.push({
      label: 'Backend mode',
      value: 'Cloud provider gateway'
    });
  }
  if (apiProvider !== 'firstParty') {
    const providerLabel = {
      bedrock: 'AWS Bedrock',
      vertex: 'Google Vertex AI',
      foundry: 'Microsoft Foundry'
    }[apiProvider];
    properties.push({
      label: 'API provider',
      value: providerLabel
    });
  }
  if (apiProvider === 'firstParty') {
    const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const isThirdPartyAnthropicCompatible = !!anthropicBaseUrl && !anthropicBaseUrl.includes('anthropic.com');
    if (isThirdPartyAnthropicCompatible) {
      properties.push({
        label: 'Auth mode',
        value: 'API key/token (third-party compatible backend)',
      });
    }
    if (anthropicBaseUrl) {
      properties.push({
        label: 'Anthropic base URL',
        value: anthropicBaseUrl
      });
    }
  } else if (apiProvider === 'bedrock') {
    const bedrockBaseUrl = process.env.BEDROCK_BASE_URL;
    if (bedrockBaseUrl) {
      properties.push({
        label: 'Bedrock base URL',
        value: bedrockBaseUrl
      });
    }
    properties.push({
      label: 'AWS region',
      value: getAWSRegion()
    });
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
      properties.push({
        value: 'AWS auth skipped'
      });
    }
  } else if (apiProvider === 'vertex') {
    const vertexBaseUrl = process.env.VERTEX_BASE_URL;
    if (vertexBaseUrl) {
      properties.push({
        label: 'Vertex base URL',
        value: vertexBaseUrl
      });
    }
    const gcpProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    if (gcpProject) {
      properties.push({
        label: 'GCP project',
        value: gcpProject
      });
    }
    properties.push({
      label: 'Default region',
      value: getDefaultVertexRegion()
    });
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
      properties.push({
        value: 'GCP auth skipped'
      });
    }
  } else if (apiProvider === 'foundry') {
    const foundryBaseUrl = process.env.ANTHROPIC_FOUNDRY_BASE_URL;
    if (foundryBaseUrl) {
      properties.push({
        label: 'Microsoft Foundry base URL',
        value: foundryBaseUrl
      });
    }
    const foundryResource = process.env.ANTHROPIC_FOUNDRY_RESOURCE;
    if (foundryResource) {
      properties.push({
        label: 'Microsoft Foundry resource',
        value: foundryResource
      });
    }
    if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)) {
      properties.push({
        value: 'Microsoft Foundry auth skipped'
      });
    }
  }
  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    properties.push({
      label: 'Proxy',
      value: proxyUrl
    });
  }
  const mtlsConfig = getMTLSConfig();
  if (process.env.NODE_EXTRA_CA_CERTS) {
    properties.push({
      label: 'Additional CA cert(s)',
      value: process.env.NODE_EXTRA_CA_CERTS
    });
  }
  if (mtlsConfig) {
    if (mtlsConfig.cert && process.env.CLAUDE_CODE_CLIENT_CERT) {
      properties.push({
        label: 'mTLS client cert',
        value: process.env.CLAUDE_CODE_CLIENT_CERT
      });
    }
    if (mtlsConfig.key && process.env.CLAUDE_CODE_CLIENT_KEY) {
      properties.push({
        label: 'mTLS client key',
        value: process.env.CLAUDE_CODE_CLIENT_KEY
      });
    }
  }
  return properties;
}

export function buildWorktreeProperties(): Property[] {
  const session = getCurrentWorktreeSession();
  if (!session) {
    return [];
  }
  const properties: Property[] = [{
    label: 'Worktree',
    value: session.worktreeName,
  }, {
    label: 'Worktree path',
    value: session.worktreePath,
  }];
  if (session.worktreeBranch) {
    properties.push({
      label: 'Worktree branch',
      value: session.worktreeBranch,
    });
  }
  if (session.originalCwd) {
    properties.push({
      label: 'Original cwd',
      value: session.originalCwd,
    });
  }
  return properties;
}
export function buildSearchToolProperties(): Property[] {
  const ripgrepStatus = getRipgrepStatus();
  if (!ripgrepStatus.mode) {
    return [];
  }
  const value =
    ripgrepStatus.mode === 'system'
      ? `ripgrep (${ripgrepStatus.working === false ? 'unhealthy' : 'ready'})`
      : `${ripgrepStatus.mode} ripgrep fallback`;
  return [{
    label: 'Search tool',
    value,
  }];
}
export function getModelDisplayLabel(mainLoopModel: string | null): string {
  let modelLabel = modelDisplayString(mainLoopModel);
  if (mainLoopModel === null && isClaudeAISubscriber()) {
    const description = getClaudeAiUserDefaultModelDescription();
    modelLabel = `${chalk.bold('Default')} ${description}`;
  }
  return modelLabel;
}
