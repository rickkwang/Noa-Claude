// @ts-nocheck
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, useCustomThemes, usePreviewTheme, useTheme, useThemeSetting } from '../ink.js';
import { useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { useIsInsideModal } from '../context/modalContext.js';
import { customThemeRef, parseCustomThemeRef, type CustomTheme } from '../utils/customThemes.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import type { ThemeSetting } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { getColorModuleUnavailableReason, getSyntaxTheme } from './StructuredDiff/colorDiff.js';
import { StructuredDiff } from './StructuredDiff.js';

const NEW_CUSTOM_THEME_VALUE = '__new_custom_theme__';

export type ThemePickerProps = {
  onThemeSelect: (setting: ThemeSetting) => void;
  /** Provided when custom themes can be created/edited here. Called with the
   * theme to edit, or undefined to create a new one. */
  onCustomTheme?: (initial?: CustomTheme) => void;
  showIntroText?: boolean;
  helpText?: string;
  showHelpTextBelow?: boolean;
  hideEscToCancel?: boolean;
  /** Skip exit handling when running in a context that already has it (e.g., onboarding) */
  skipExitHandling?: boolean;
  /** Called when the user cancels (presses Escape). If skipExitHandling is true and this is provided, it will be called instead of just saving the preview. */
  onCancel?: () => void;
};

/**
 * Dashed top/bottom frame around the syntax-preview diff. Matches upstream's
 * shared preview wrapper: no side borders, hidden overflow, zero padding so
 * the diff controls its own width.
 */
function PreviewFrame({
  children
}: {
  children: React.ReactNode;
}) {
  const borderStyle = useIsInsideModal() ? undefined : 'dashed';
  return <Box borderStyle={borderStyle} borderColor="subtle" borderLeft={false} borderRight={false} flexDirection="column" overflow="hidden" paddingX={0}>{children}</Box>;
}
export function ThemePicker({
  onThemeSelect,
  onCustomTheme,
  showIntroText = false,
  helpText = '',
  showHelpTextBelow = false,
  hideEscToCancel = false,
  skipExitHandling = false,
  onCancel: onCancelProp
}: ThemePickerProps) {
  const [theme] = useTheme();
  const themeSetting = useThemeSetting();
  const {
    columns
  } = useTerminalSize();
  const colorModuleUnavailableReason = getColorModuleUnavailableReason();
  const syntaxTheme = colorModuleUnavailableReason === null ? getSyntaxTheme(theme) : null;
  const {
    setPreviewTheme,
    savePreview,
    cancelPreview
  } = usePreviewTheme();
  const {
    customThemes
  } = useCustomThemes();
  const syntaxHighlightingDisabled = useAppState(_temp) ?? false;
  const setAppState = useSetAppState();
  useRegisterKeybindingContext("ThemePicker");
  const syntaxToggleShortcut = useShortcutDisplay("theme:toggleSyntaxHighlighting", "ThemePicker", "ctrl+t");
  const editCustomShortcut = useShortcutDisplay("theme:editCustom", "ThemePicker", "ctrl+e");

  // The option currently highlighted in the list — drives the ctrl+e edit
  // affordance for custom themes.
  const [focusedValue, setFocusedValue] = useState<string>(themeSetting);
  const focusedSlug = parseCustomThemeRef(focusedValue);
  const focusedCustomTheme = focusedSlug ? customThemes.find(theme_0 => theme_0.slug === focusedSlug) : undefined;
  const toggleSyntaxHighlighting = () => {
    if (colorModuleUnavailableReason === null) {
      const newValue = !syntaxHighlightingDisabled;
      updateSettingsForSource("userSettings", {
        syntaxHighlightingDisabled: newValue
      });
      setAppState(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          syntaxHighlightingDisabled: newValue
        }
      }));
    }
  };
  useKeybinding("theme:toggleSyntaxHighlighting", toggleSyntaxHighlighting, {
    context: "ThemePicker"
  });
  const editFocusedCustomTheme = () => {
    if (focusedCustomTheme && onCustomTheme) {
      savePreview();
      onCustomTheme(focusedCustomTheme);
    }
  };
  useKeybinding("theme:editCustom", editFocusedCustomTheme, {
    context: "ThemePicker"
  });
  const exitState = useExitOnCtrlCDWithKeybindings(skipExitHandling ? _temp2 : undefined);
  const themeOptions = [...(feature("AUTO_THEME") ? [{
    label: "Auto (match terminal)",
    value: "auto" as const
  }] : []), {
    label: "Dark mode",
    value: "dark"
  }, {
    label: "Light mode",
    value: "light"
  }, {
    label: "Dark mode (colorblind-friendly)",
    value: "dark-daltonized"
  }, {
    label: "Light mode (colorblind-friendly)",
    value: "light-daltonized"
  }, {
    label: "Dark mode (ANSI colors only)",
    value: "dark-ansi"
  }, {
    label: "Light mode (ANSI colors only)",
    value: "light-ansi"
  }, ...customThemes.map(theme_1 => ({
    label: theme_1.source === "user" ? `${theme_1.name} (custom)` : `${theme_1.name} (from ${theme_1.source.plugin})`,
    value: customThemeRef(theme_1.slug)
  })), ...(onCustomTheme ? [{
    label: "New custom theme…",
    value: NEW_CUSTOM_THEME_VALUE
  }] : [])];
  const handleFocus = setting => {
    setFocusedValue(setting);
    if (setting === NEW_CUSTOM_THEME_VALUE) {
      cancelPreview();
    } else {
      setPreviewTheme(setting as ThemeSetting);
    }
  };
  const handleChange = setting_0 => {
    if (setting_0 === NEW_CUSTOM_THEME_VALUE) {
      cancelPreview();
      onCustomTheme?.(undefined);
      return;
    }
    savePreview();
    onThemeSelect(setting_0 as ThemeSetting);
  };
  const handleCancel = skipExitHandling ? () => {
    cancelPreview();
    onCancelProp?.();
  } : async () => {
    cancelPreview();
    await gracefulShutdown(0);
  };
  const select = <Select options={themeOptions} onFocus={handleFocus} onChange={handleChange} onCancel={handleCancel} visibleOptionCount={Math.min(themeOptions.length, 12)} defaultValue={themeSetting} defaultFocusValue={themeSetting} />;
  const header = <Box flexDirection="column" gap={1}>{showIntroText ? <Text>Let's get started.</Text> : <Text bold={true} color="permission">Theme</Text>}<Box flexDirection="column"><Text bold={true}>Choose the text style that looks best with your terminal</Text>{helpText && !showHelpTextBelow && <Text dimColor={true}>{helpText}</Text>}</Box>{select}</Box>;
  const demoPatch = {
    oldStart: 1,
    newStart: 1,
    oldLines: 3,
    newLines: 3,
    lines: [" function greet() {", "-  console.log(\"Hello, World!\");", "+  console.log(\"Hello, Claude!\");", " }"]
  };
  const syntaxStatus = colorModuleUnavailableReason === "env" ? `Syntax highlighting disabled (via CLAUDE_CODE_SYNTAX_HIGHLIGHT=${process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT})` : syntaxHighlightingDisabled ? `Syntax highlighting disabled (${syntaxToggleShortcut} to enable)` : syntaxTheme ? `Syntax theme: ${syntaxTheme.theme}${syntaxTheme.source ? ` (from ${syntaxTheme.source})` : ""} (${syntaxToggleShortcut} to disable)` : `Syntax highlighting enabled (${syntaxToggleShortcut} to disable)`;
  const preview = <Box flexDirection="column" width="100%"><PreviewFrame><StructuredDiff patch={demoPatch} dim={false} filePath="demo.js" firstLine={null} width={columns - 6} /></PreviewFrame><Text dimColor={true}>{" "}{syntaxStatus}</Text></Box>;
  const content = <Box flexDirection="column" gap={1}>{header}{preview}</Box>;
  if (!showIntroText) {
    return <>
        <Box flexDirection="column">{content}</Box>
        <Box marginTop={1}>{showHelpTextBelow && helpText && <Box marginLeft={3}><Text dimColor={true}>{helpText}</Text></Box>}{!hideEscToCancel && <Box><Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Byline><KeyboardShortcutHint shortcut="Enter" action="select" />{focusedCustomTheme && onCustomTheme && <KeyboardShortcutHint shortcut={editCustomShortcut} action="edit" />}<KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>}</Text></Box>}</Box>
      </>;
  }
  return content;
}
function _temp2() {}
function _temp(s) {
  return s.settings.syntaxHighlightingDisabled;
}
