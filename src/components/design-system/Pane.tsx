// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import { Divider } from './Divider.js';
type PaneProps = {
  children: React.ReactNode;
  /**
   * Theme color for the top border line.
   */
  color?: keyof Theme;
  /**
   * Right-aligned label rendered on the top border line (e.g. the model
   * picker's "◐ medium · /effort" effort badge). Plain text, no ANSI.
   */
  topRight?: string;
};

/**
 * A pane — a region of the terminal that appears below the REPL prompt,
 * bounded by a colored top line with a one-row gap above and horizontal
 * padding. Used by all slash-command screens: /config, /help, /plugins,
 * /sandbox, /stats, /permissions.
 *
 * For confirm/cancel dialogs (Esc to dismiss, Enter to confirm), use
 * `<Dialog>` instead — it registers its own keybindings. For a full
 * rounded-border card, use `<Panel>`.
 *
 * Submenus rendered inside a Pane should use `hideBorder` on their Dialog
 * so the Pane's border remains the single frame.
 *
 * @example
 * <Pane color="permission">
 *   <Tabs title="Sandbox:">...</Tabs>
 * </Pane>
 */
export function Pane(t0) {
  const $ = _c(11);
  const {
    children,
    color,
    topRight
  } = t0;
  const {
    columns
  } = useTerminalSize();
  if (useIsInsideModal()) {
    let t1;
    if ($[0] !== children) {
      t1 = <Box flexDirection="column" paddingX={1} flexShrink={0}>{children}</Box>;
      $[0] = children;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== color || $[3] !== topRight || $[4] !== columns) {
    t1 = topRight ? <TopRightDivider color={color} label={topRight} width={columns} /> : <Divider color={color} />;
    $[2] = color;
    $[3] = topRight;
    $[4] = columns;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  let t2;
  if ($[6] !== children) {
    t2 = <Box flexDirection="column" paddingX={2}>{children}</Box>;
    $[6] = children;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  let t3;
  if ($[8] !== t1 || $[9] !== t2) {
    t3 = <Box flexDirection="column" paddingTop={1}>{t1}{t2}</Box>;
    $[8] = t1;
    $[9] = t2;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  return t3;
}

/**
 * The pane's top border line with a right-aligned dimmed label and a single
 * trailing dash: `────────── label ─`.
 */
function TopRightDivider({
  color,
  label,
  width
}: {
  color?: keyof Theme;
  label: string;
  width: number;
}) {
  const text = ` ${label} `;
  const fillWidth = Math.max(0, width - stringWidth(text) - 1);
  return <Text color={color} dimColor={!color}>{'─'.repeat(fillWidth)}<Text dimColor={true}>{text}</Text>{'─'}</Text>;
}
