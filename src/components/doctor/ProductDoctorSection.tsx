// @ts-nocheck
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getInitializationStatus, getLspServerManager, isLspConnected } from '../../services/lsp/manager.js';
import { buildProductPathsProperties, buildWorktreeProperties } from '../../utils/status.js';

function renderPropertyRows(properties) {
  return properties.map((property, index) => (
    <Box key={`${property.label ?? 'value'}-${index}`} flexDirection="row" gap={1}>
      {property.label !== undefined && <Text bold={true}>{property.label}:</Text>}
      {Array.isArray(property.value) ? (
        <Box flexWrap="wrap" columnGap={1}>
          {property.value.map((item, itemIndex) => (
            <Text key={itemIndex}>{item}{itemIndex < property.value.length - 1 ? ',' : ''}</Text>
          ))}
        </Box>
      ) : typeof property.value === 'string' ? (
        <Text>{property.value}</Text>
      ) : (
        property.value
      )}
    </Box>
  ));
}

function buildLspDoctorRows() {
  const status = getInitializationStatus();
  const manager = getLspServerManager();
  const servers = manager ? Array.from(manager.getAllServers().values()) : [];
  const healthyCount = servers.filter(server => server.state !== 'error').length;
  const failedCount = servers.filter(server => server.state === 'error').length;

  switch (status.status) {
    case 'success':
      return [
        <Text key="lsp-status">
          └ Status:{' '}
          {isLspConnected()
            ? `Ready (${healthyCount} active server${healthyCount === 1 ? '' : 's'}${failedCount > 0 ? `, ${failedCount} failed` : ''})`
            : 'Initialized with no active servers'}
        </Text>,
        <Text key="lsp-features" dimColor={true}>
          └ Features: diagnostics, hover, go-to-definition, references
        </Text>,
      ];
    case 'pending':
      return [<Text key="lsp-status">└ Status: Initializing</Text>];
    case 'failed':
      return [
        <Text key="lsp-status" color="error">
          └ Status: Failed to initialize ({status.error.message})
        </Text>,
        <Text key="lsp-action" dimColor={true}>
          └ Action: reload plugins if language servers were just installed, then reopen the session
        </Text>,
      ];
    default:
      return [
        <Text key="lsp-status">└ Status: Not started in this session</Text>,
        <Text key="lsp-action" dimColor={true}>
          └ LSP starts in normal interactive mode; bare and print mode do not initialize it
        </Text>,
      ];
  }
}

export function ProductDoctorSection() {
  const plugins = useAppState(state => state.plugins);
  const productRows = [...buildProductPathsProperties(), ...buildWorktreeProperties()];
  const hasPluginInfo =
    plugins.enabled.length > 0 || plugins.errors.length > 0 || plugins.needsRefresh;

  if (productRows.length === 0 && !hasPluginInfo) {
    return (
      <Box flexDirection="column">
        <Text bold={true}>Product Health</Text>
        {buildLspDoctorRows()}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold={true}>Product Health</Text>
      {renderPropertyRows(productRows)}
      {hasPluginInfo && (
        <>
          <Text>
            └ Plugins: {plugins.enabled.length} enabled
            {plugins.errors.length > 0 ? `, ${plugins.errors.length} failed` : ''}
            {plugins.needsRefresh ? ', reload required' : ''}
          </Text>
          {plugins.needsRefresh && (
            <Text dimColor={true}>
              └ Action: run /reload-plugins before relying on newly installed plugins or language servers
            </Text>
          )}
        </>
      )}
      {buildLspDoctorRows()}
    </Box>
  );
}
