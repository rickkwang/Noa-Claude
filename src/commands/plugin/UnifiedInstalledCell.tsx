// @ts-nocheck
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { plural } from '../../utils/stringUtils.js';
import type { UnifiedInstalledItem } from './unifiedTypes.js';

// Every row, in every scope section, lays out the same four columns so they
// line up down the whole list: status glyph · name · type · details.
const TYPE_COLUMN_WIDTH = 6; // "Plugin"
const MAX_NAME_COLUMN_WIDTH = 44;
const MIN_NAME_COLUMN_WIDTH = 12;
// Room kept for pointer + glyph + gaps, and for the type column plus a useful
// slice of details, before the name column may grow.
const ROW_CHROME_WIDTH = 20;
const MIN_DETAILS_WIDTH = 16;
const CHILD_PREFIX = '└ ';

type RowDescription = {
  glyph: string;
  tone: string | undefined;
  name: string;
  isChild: boolean;
  typeLabel: 'Plugin' | 'MCP';
  statusText: string;
  details: string[];
};

function describeItem(item: UnifiedInstalledItem): RowDescription {
  switch (item.type) {
    case 'plugin': {
      const base = {
        name: item.name,
        isChild: false,
        typeLabel: 'Plugin' as const,
        details: [item.marketplace],
      };
      if (item.isUninstalled) {
        return { ...base, glyph: figures.radioOff, tone: 'inactive', statusText: 'Uninstalled' };
      }
      if (item.pendingToggle) {
        return {
          ...base,
          glyph: figures.arrowRight,
          tone: 'suggestion',
          statusText: item.pendingToggle === 'will-enable' ? 'will enable' : 'will disable',
        };
      }
      if (item.errorCount > 0) {
        return {
          ...base,
          glyph: figures.cross,
          tone: 'error',
          statusText: `${item.errorCount} ${plural(item.errorCount, 'error')}`,
        };
      }
      if (!item.isEnabled) {
        return { ...base, glyph: figures.radioOff, tone: 'inactive', statusText: 'disabled' };
      }
      return { ...base, glyph: figures.tick, tone: 'success', statusText: 'enabled' };
    }
    case 'flagged-plugin':
      return {
        name: item.name,
        isChild: false,
        typeLabel: 'Plugin',
        glyph: figures.warning,
        tone: 'warning',
        statusText: 'removed',
        details: [item.marketplace],
      };
    case 'failed-plugin':
      return {
        name: item.name,
        isChild: false,
        typeLabel: 'Plugin',
        glyph: figures.cross,
        tone: 'error',
        statusText: 'failed to load',
        details: [`${item.errorCount} ${plural(item.errorCount, 'error')}`, item.marketplace],
      };
    default: {
      const base = {
        name: item.name,
        isChild: item.indented === true,
        typeLabel: 'MCP' as const,
        details: [],
      };
      switch (item.status) {
        case 'connected':
          return { ...base, glyph: figures.tick, tone: 'success', statusText: 'connected' };
        case 'disabled':
          return { ...base, glyph: figures.radioOff, tone: 'inactive', statusText: 'disabled' };
        case 'pending':
          return { ...base, glyph: figures.radioOff, tone: 'inactive', statusText: 'connecting…' };
        case 'needs-auth':
          return { ...base, glyph: figures.triangleUpOutline, tone: 'warning', statusText: 'Enter to auth' };
        default:
          return { ...base, glyph: figures.cross, tone: 'error', statusText: 'failed' };
      }
    }
  }
}

/**
 * Width of the shared name column: the widest name in the list, capped so the
 * type and details columns keep room on narrow terminals. Computed over the
 * whole list, not the visible page, so columns don't jump while scrolling.
 */
export function getInstalledNameColumnWidth(
  items: UnifiedInstalledItem[],
  columns: number,
): number {
  let widest = 0;
  for (const item of items) {
    const childPrefix = item.type === 'mcp' && item.indented ? stringWidth(CHILD_PREFIX) : 0;
    widest = Math.max(widest, stringWidth(item.name) + childPrefix);
  }
  return Math.min(
    widest,
    MAX_NAME_COLUMN_WIDTH,
    Math.max(MIN_NAME_COLUMN_WIDTH, columns - ROW_CHROME_WIDTH - MIN_DETAILS_WIDTH),
  );
}

type Props = {
  item: UnifiedInstalledItem;
  isSelected: boolean;
  nameWidth: number;
};

export function UnifiedInstalledCell({ item, isSelected, nameWidth }: Props): React.ReactNode {
  const row = describeItem(item);
  const selectedColor = isSelected ? 'suggestion' : undefined;
  return (
    <Box>
      <Text color={selectedColor}>{isSelected ? `${figures.pointer} ` : '  '}</Text>
      <Box flexShrink={0}>
        <Text color={row.tone}>{row.glyph}</Text>
      </Box>
      <Box width={nameWidth} flexShrink={0} marginLeft={1}>
        <Text wrap="truncate-end">
          {row.isChild && <Text dimColor={!isSelected}>{CHILD_PREFIX}</Text>}
          <Text color={selectedColor}>{row.name}</Text>
        </Text>
      </Box>
      <Box width={TYPE_COLUMN_WIDTH} flexShrink={0} marginLeft={1}>
        <Text dimColor>{row.typeLabel}</Text>
      </Box>
      <Box flexShrink={1} marginLeft={1}>
        <Text wrap="truncate-end" dimColor={!isSelected}>
          {row.statusText}
          {row.details.map(detail => ` · ${detail}`).join('')}
        </Text>
      </Box>
    </Box>
  );
}
