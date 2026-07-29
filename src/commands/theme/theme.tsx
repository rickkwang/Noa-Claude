// @ts-nocheck
import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Pane } from '../../components/design-system/Pane.js';
import { ThemeEditor } from '../../components/ThemeEditor.js';
import { ThemePicker } from '../../components/ThemePicker.js';
import { useCustomThemes, useTheme } from '../../ink.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { customThemeRef, parseCustomThemeRef, type CustomTheme } from '../../utils/customThemes.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type PickerState = {
  kind: 'picker';
} | {
  kind: 'editor';
  initial?: CustomTheme;
};
function ThemePickerCommand({
  onDone
}: Props) {
  const [theme, setTheme] = useTheme();
  const {
    customThemes
  } = useCustomThemes();
  const [state, setState] = useState<PickerState>({
    kind: 'picker'
  });
  if (state.kind === 'editor') {
    const handleEditorDone = (newTheme: CustomTheme) => {
      setTheme(customThemeRef(newTheme.slug));
      onDone(`Using custom theme "${newTheme.name}"`);
    };
    const handleEditorCancel = () => {
      setState({
        kind: 'picker'
      });
    };
    return <ThemeEditor initial={state.initial} defaultBase={theme} onDone={handleEditorDone} onCancel={handleEditorCancel} />;
  }
  const handleThemeSelect = (setting: string) => {
    setTheme(setting);
    const slug = parseCustomThemeRef(setting);
    onDone(slug ? `Using custom theme "${customThemes.find(theme_0 => customThemeRef(theme_0.slug) === setting)?.name ?? setting}"` : `Theme set to ${setting}`);
  };
  const handleCustomTheme = (initial?: CustomTheme) => {
    setState({
      kind: 'editor',
      initial
    });
  };
  const handleCancel = () => {
    onDone("Theme picker dismissed", {
      display: "system"
    });
  };
  return <Pane color="permission"><ThemePicker onThemeSelect={handleThemeSelect} onCustomTheme={handleCustomTheme} onCancel={handleCancel} skipExitHandling={true} /></Pane>;
}
export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <ThemePickerCommand onDone={onDone} />;
};
