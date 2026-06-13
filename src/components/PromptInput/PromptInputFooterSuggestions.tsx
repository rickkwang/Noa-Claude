// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { truncatePathMiddle, truncateToWidth } from '../../utils/format.js';
import type { Theme } from '../../utils/theme.js';
export type SuggestionItem = {
  id: string;
  displayText: string;
  tag?: string;
  description?: string;
  metadata?: unknown;
  color?: keyof Theme;
  matchedPrefix?: string;
};
export type SuggestionType = 'command' | 'file' | 'directory' | 'agent' | 'shell' | 'custom-title' | 'slack-channel' | 'none';
// Fullscreen slash-command overlay can comfortably fit a few more rows
// without overwhelming the prompt area.
export const OVERLAY_VISIBLE_ITEMS = 12;
export const INLINE_VISIBLE_ITEMS = 12;

/**
 * Get the icon for a suggestion based on its type
 * Icons: + for files, ◇ for MCP resources, * for agents
 */
function getIcon(itemId: string): string {
  if (itemId.startsWith('file-')) return '+';
  if (itemId.startsWith('mcp-resource-')) return '◇';
  if (itemId.startsWith('agent-')) return '*';
  return '+';
}

/**
 * Check if an item is a unified suggestion type (file, mcp-resource, or agent)
 */
function isUnifiedSuggestion(itemId: string): boolean {
  return itemId.startsWith('file-') || itemId.startsWith('mcp-resource-') || itemId.startsWith('agent-');
}
const SuggestionItemRow = memo(function SuggestionItemRow(t0) {
  const $ = _c(36);
  const {
    item,
    maxColumnWidth,
    isSelected
  } = t0;
  const columns = useTerminalSize().columns;
  const isUnified = isUnifiedSuggestion(item.id);
  if (isUnified) {
    let t1;
    if ($[0] !== item.id) {
      t1 = getIcon(item.id);
      $[0] = item.id;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    const icon = t1;
    const textColor = isSelected ? "suggestion" : undefined;
    const dimColor = !isSelected;
    const isFile = item.id.startsWith("file-");
    const isMcpResource = item.id.startsWith("mcp-resource-");
    const separatorWidth = item.description ? 3 : 0;
    let displayText;
    if (isFile) {
      let t2;
      if ($[2] !== item.description) {
        t2 = item.description ? Math.min(20, stringWidth(item.description)) : 0;
        $[2] = item.description;
        $[3] = t2;
      } else {
        t2 = $[3];
      }
      const descReserve = t2;
      const maxPathLength = columns - 2 - 4 - separatorWidth - descReserve;
      let t3;
      if ($[4] !== item.displayText || $[5] !== maxPathLength) {
        t3 = truncatePathMiddle(item.displayText, maxPathLength);
        $[4] = item.displayText;
        $[5] = maxPathLength;
        $[6] = t3;
      } else {
        t3 = $[6];
      }
      displayText = t3;
    } else {
      if (isMcpResource) {
        let t2;
        if ($[7] !== item.displayText) {
          t2 = truncateToWidth(item.displayText, 30);
          $[7] = item.displayText;
          $[8] = t2;
        } else {
          t2 = $[8];
        }
        displayText = t2;
      } else {
        displayText = item.displayText;
      }
    }
    const availableWidth = columns - 2 - stringWidth(displayText) - separatorWidth - 4;
    let lineContent;
    if (item.description) {
      const maxDescLength = Math.max(0, availableWidth);
      let t2;
      if ($[9] !== item.description || $[10] !== maxDescLength) {
        t2 = truncateToWidth(item.description.replace(/\s+/g, " "), maxDescLength);
        $[9] = item.description;
        $[10] = maxDescLength;
        $[11] = t2;
      } else {
        t2 = $[11];
      }
      const truncatedDesc = t2;
      lineContent = `${icon} ${displayText} – ${truncatedDesc}`;
    } else {
      lineContent = `${icon} ${displayText}`;
    }
    let t2;
    if ($[12] !== dimColor || $[13] !== lineContent || $[14] !== textColor) {
      t2 = <Text color={textColor} dimColor={dimColor} wrap="truncate">{lineContent}</Text>;
      $[12] = dimColor;
      $[13] = lineContent;
      $[14] = textColor;
      $[15] = t2;
    } else {
      t2 = $[15];
    }
    return t2;
  }
  const maxNameWidth = Math.floor(columns * 0.4);
  const displayTextWidth = Math.min(maxColumnWidth ?? stringWidth(item.displayText) + 5, maxNameWidth);
  const textColor_0 = item.color || (isSelected ? "suggestion" : undefined);
  const shouldDim = !isSelected;
  let displayText_0 = item.displayText;
  if (stringWidth(displayText_0) > displayTextWidth - 2) {
    const t1 = displayTextWidth - 2;
    let t2;
    if ($[16] !== displayText_0 || $[17] !== t1) {
      t2 = truncateToWidth(displayText_0, t1);
      $[16] = displayText_0;
      $[17] = t1;
      $[18] = t2;
    } else {
      t2 = $[18];
    }
    displayText_0 = t2;
  }
  const paddedDisplayText = displayText_0 + " ".repeat(Math.max(0, displayTextWidth - stringWidth(displayText_0)));
  const tagText = item.tag ? `[${item.tag}] ` : "";
  const tagWidth = stringWidth(tagText);
  const descriptionWidth = Math.max(0, columns - displayTextWidth - tagWidth - 4);
  let t1;
  if ($[19] !== descriptionWidth || $[20] !== item.description) {
    t1 = item.description ? truncateToWidth(item.description.replace(/\s+/g, " "), descriptionWidth) : "";
    $[19] = descriptionWidth;
    $[20] = item.description;
    $[21] = t1;
  } else {
    t1 = $[21];
  }
  const truncatedDescription = t1;
  const highlightQuery = item.matchedPrefix;
  const renderHighlighted = (text, color, dim) => {
    if (!highlightQuery || !text) {
      return <Text color={color} dimColor={dim}>{text}</Text>;
    }
    const q = highlightQuery.toLowerCase();
    const lower = text.toLowerCase();
    const parts = [];
    let i = 0;
    let key = 0;
    while (i < text.length) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) {
        parts.push(<Text key={key++} color={color} dimColor={dim}>{text.slice(i)}</Text>);
        break;
      }
      if (idx > i) {
        parts.push(<Text key={key++} color={color} dimColor={dim}>{text.slice(i, idx)}</Text>);
      }
      parts.push(<Text key={key++} color="suggestion">{text.slice(idx, idx + q.length)}</Text>);
      i = idx + q.length;
    }
    return <>{parts}</>;
  };
  const nameNode = <Text wrap="truncate">{renderHighlighted(paddedDisplayText, textColor_0, shouldDim)}</Text>;
  const tagNode = tagText ? <Text dimColor={true}>{tagText}</Text> : null;
  const descColor = isSelected ? "suggestion" : undefined;
  const descDim = !isSelected;
  const descNode = renderHighlighted(truncatedDescription, descColor, descDim);
  return <Text wrap="truncate">{nameNode}{tagNode}{descNode}</Text>;
});
type Props = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  maxColumnWidth?: number;
  /**
   * When true, the suggestions are rendered inside a position=absolute
   * overlay. We omit minHeight and flex-end so the y-clamp in the
   * renderer doesn't push fewer items down into the prompt area.
   */
  overlay?: boolean;
  /**
   * Mouse click on a row — fullscreen overlay only. Ink gates mouse
   * dispatch on altScreenActive, so passing these in non-fullscreen would
   * be dead code (App.tsx:54-60). The fullscreen overlay caller wires them.
   * Index is absolute within `suggestions`.
   */
  onSelect?: (index: number) => void;
  enableMouseHover?: boolean;
};
export function PromptInputFooterSuggestions({
  suggestions,
  selectedSuggestion,
  maxColumnWidth: maxColumnWidthProp,
  overlay,
  onSelect,
  enableMouseHover,
}: Props): ReactNode {
  useTerminalSize();
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null);
  useEffect(() => {
    setHoveredSuggestion(null);
  }, [suggestions]);
  useEffect(() => {
    setHoveredSuggestion(null);
  }, [selectedSuggestion]);
  if (suggestions.length === 0) return null;
  const maxVisibleItems = overlay
    ? Math.min(suggestions.length, OVERLAY_VISIBLE_ITEMS)
    : Math.min(suggestions.length, INLINE_VISIBLE_ITEMS);
  const maxColumnWidth = maxColumnWidthProp ?? Math.max(...suggestions.map(_temp)) + 5;
  const startIndex = Math.max(0, Math.min(selectedSuggestion - Math.floor(maxVisibleItems / 2), suggestions.length - maxVisibleItems));
  const endIndex = Math.min(startIndex + maxVisibleItems, suggestions.length);
  const visibleItems = suggestions.slice(startIndex, endIndex);
  const highlightedSuggestion = overlay && hoveredSuggestion !== null ? hoveredSuggestion : selectedSuggestion;
  // SuggestionItemRow returns a <Text>. Hit-test skips text nodes, so we
  // wrap each in a Box that owns the click/hover handlers. Wrapping is
  // unconditional (keeps layout consistent regardless of mouse wiring);
  // handlers attach only when callers provide them (fullscreen overlay).
  return (
    <Box flexDirection="column" justifyContent={overlay ? undefined : 'flex-end'}>
      {visibleItems.map((item, i) => {
        const absoluteIndex = startIndex + i;
        return (
          <Box
            key={item.id}
            height={1}
            onClick={onSelect ? () => onSelect(absoluteIndex) : undefined}
            onMouseEnter={enableMouseHover ? () => setHoveredSuggestion(absoluteIndex) : undefined}
          >
            <SuggestionItemRow
              item={item}
              maxColumnWidth={maxColumnWidth}
              isSelected={item.id === suggestions[highlightedSuggestion]?.id}
            />
          </Box>
        );
      })}
    </Box>
  );
}
function _temp(item) {
  return stringWidth(item.displayText);
}
export default memo(PromptInputFooterSuggestions);
