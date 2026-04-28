// @ts-nocheck
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { buildWorktreeProperties } from '../../utils/status.js';

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

export function ProductDoctorSection() {
  const plugins = useAppState(state => state.plugins);
  const worktreeRows = buildWorktreeProperties();
  const hasPluginInfo =
    plugins.enabled.length > 0 || plugins.errors.length > 0 || plugins.needsRefresh;

  if (worktreeRows.length === 0 && !hasPluginInfo) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold={true}>Product Health</Text>
      {renderPropertyRows(worktreeRows)}
      {hasPluginInfo && (
        <>
          <Text>
            └ Plugins: {plugins.enabled.length} enabled
            {plugins.errors.length > 0 ? `, ${plugins.errors.length} failed` : ''}
            {plugins.needsRefresh ? ', reload required' : ''}
          </Text>
          {plugins.needsRefresh && (
            <Text dimColor={true}>
              └ Action: run /reload-plugins in ~/.claude-agent before relying on newly installed plugins or language servers
            </Text>
          )}
        </>
      )}
    </Box>
  );
}
