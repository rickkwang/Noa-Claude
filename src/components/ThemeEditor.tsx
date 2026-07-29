// @ts-nocheck
import { sep } from 'path';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text, useCustomThemes, useTheme } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { customThemeRef, dedupeThemeSlug, getThemesDir, isValidThemeColor, saveCustomTheme, type CustomTheme } from '../utils/customThemes.js';
import { logForDebugging } from '../utils/debug.js';
import { getTheme, type Theme, type ThemeName } from '../utils/theme.js';
import TextInput from './TextInput.js';
import { Byline } from './design-system/Byline.js';
import { FuzzyPicker } from './design-system/FuzzyPicker.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Pane } from './design-system/Pane.js';
export type ThemeEditorProps = {
  /** The theme being edited. Undefined creates a new theme; a plugin-provided
   * theme is forked into the user's themes directory on save. */
  initial?: CustomTheme;
  /** Base preset for new themes (the currently active theme). */
  defaultBase: ThemeName;
  onDone: (theme: CustomTheme) => void;
  onCancel: () => void;
};
function omitKey(obj: Partial<Theme>, key: string): Partial<Theme> {
  const next = {
    ...obj
  };
  delete next[key];
  return next;
}

/** Two-cell swatch rendered in the color it previews. */
function Swatch({
  value
}: {
  value: string;
}) {
  return <Text color={value}>██</Text>;
}
export function ThemeEditor({
  initial,
  defaultBase,
  onDone,
  onCancel
}: ThemeEditorProps) {
  const [, setTheme] = useTheme();
  const {
    customThemes,
    reloadCustomThemes,
    setPreviewOverrides
  } = useCustomThemes();
  const isPluginTheme = initial !== undefined && initial.source !== 'user';
  const [step, setStep] = useState<'name' | 'colors'>(initial && !isPluginTheme ? 'colors' : 'name');
  const [name, setName] = useState(initial?.name ?? '');
  const [nameCursorOffset, setNameCursorOffset] = useState((initial?.name ?? '').length);
  // Forking a plugin theme forces a fresh name so the slug can't shadow the
  // plugin's own `<plugin>:<slug>` namespace.
  const [slug, setSlug] = useState(isPluginTheme ? '' : initial?.slug ?? '');
  const [base] = useState<ThemeName>(() => initial?.base ?? defaultBase);
  const baseTheme = getTheme(base);
  const [overrides, setOverrides] = useState<Partial<Theme>>(initial?.overrides ?? {});
  const tokenNames = Object.keys(baseTheme).sort();
  const [query, setQuery] = useState('');
  const [editingToken, setEditingToken] = useState<keyof Theme | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editCursorOffset, setEditCursorOffset] = useState(0);
  const filteredTokens = query ? tokenNames.filter(token => token.toLowerCase().includes(query.toLowerCase())) : tokenNames;
  const effectiveSlug = slug || dedupeThemeSlug(name, customThemes);
  const customCount = Object.keys(overrides).length;

  // Stop the live preview when the editor unmounts for any reason.
  useEffect(() => () => setPreviewOverrides(null), [setPreviewOverrides]);
  const resolveToken = (token: keyof Theme): string => overrides[token] ?? baseTheme[token];
  const saveOverrides = (slugToSave: string, newOverrides: Partial<Theme>) => {
    setOverrides(newOverrides);
    setPreviewOverrides(newOverrides);
    saveCustomTheme({
      slug: slugToSave,
      name: name.trim(),
      base,
      overrides: newOverrides,
      source: 'user'
    }).catch(error => {
      logForDebugging(`[theme] save ${slugToSave} failed: ${error}`, {
        level: 'warn'
      });
    });
  };
  const selectToken = (token: keyof Theme) => {
    const value = resolveToken(token);
    setEditValue(value);
    setEditCursorOffset(value.length);
    setEditingToken(token);
  };
  const submitEdit = () => {
    if (editingToken === null || !isValidThemeColor(editValue)) {
      return;
    }
    saveOverrides(effectiveSlug, editValue === baseTheme[editingToken] ? omitKey(overrides, editingToken) : {
      ...overrides,
      [editingToken]: editValue
    });
    setEditingToken(null);
  };
  const cancelEdit = () => {
    setPreviewOverrides(overrides);
    setEditingToken(null);
  };
  const resetToken = (token: keyof Theme) => {
    if (!(token in overrides)) {
      return;
    }
    saveOverrides(effectiveSlug, omitKey(overrides, token));
  };
  const changeEditValue = (value: string) => {
    setEditValue(value);
    if (editingToken && isValidThemeColor(value)) {
      setPreviewOverrides({
        ...overrides,
        [editingToken]: value
      });
    }
  };
  const handleEscape = () => {
    if (editingToken !== null) {
      cancelEdit();
    } else {
      onCancel();
    }
  };
  useKeybinding('confirm:no', handleEscape, {
    context: 'Settings',
    isActive: step === 'name' || editingToken !== null
  });
  if (step === 'name') {
    const trimmedName = name.trim();
    const isNameValid = trimmedName.length > 0;
    const submitName = () => {
      if (!isNameValid) {
        return;
      }
      setSlug(effectiveSlug);
      setName(trimmedName);
      setStep('colors');
      saveCustomTheme({
        slug: effectiveSlug,
        name: trimmedName,
        base,
        overrides,
        source: 'user'
      }).then(() => reloadCustomThemes()).then(() => {
        setTheme(customThemeRef(effectiveSlug));
      }).catch(error => {
        logForDebugging(`[theme] save ${effectiveSlug} failed: ${error}`, {
          level: 'warn'
        });
      });
    };
    return <Pane color="permission">
        <Box flexDirection="column" gap={1}>
          <Text bold={true} color="permission">{isPluginTheme && initial ? `Fork ${initial.name} to your themes` : 'New custom theme'}</Text>
          <Box flexDirection="column">
            <Box>
              <Text>Name: </Text>
              <TextInput value={name} onChange={setName} onSubmit={submitName} onExit={onCancel} placeholder="my-theme" columns={40} cursorOffset={nameCursorOffset} onChangeCursorOffset={setNameCursorOffset} disableCursorMovementForUpDownKeys={true} disableEscapeDoublePress={true} focus={true} showCursor={true} />
            </Box>
            <Text dimColor={true}>{`based on ${base} · saved to ${getThemesDir()}${sep}${effectiveSlug}.json`}</Text>
          </Box>
          <Text dimColor={true}>
            <Byline>
              {isNameValid && <KeyboardShortcutHint shortcut="Enter" action="continue" />}
              <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            </Byline>
          </Text>
        </Box>
      </Pane>;
  }
  if (editingToken !== null) {
    const isValueValid = isValidThemeColor(editValue);
    const previewValue = isValueValid ? editValue : baseTheme[editingToken];
    return <Pane color="permission">
        <Box flexDirection="column" gap={1}>
          <Text bold={true} color="permission">{name}</Text>
          <Box flexDirection="column">
            <Box>
              <Swatch value={previewValue} />
              <Text> </Text>
              <Text bold={true}>{editingToken}</Text>
            </Box>
            <Text dimColor={true}>{`preset: ${baseTheme[editingToken]}`}</Text>
          </Box>
          <Box>
            <Text>Value: </Text>
            <TextInput value={editValue} onChange={changeEditValue} onSubmit={submitEdit} onExit={cancelEdit} placeholder="rgb(r,g,b) · #rrggbb · ansi:red" columns={40} cursorOffset={editCursorOffset} onChangeCursorOffset={setEditCursorOffset} disableCursorMovementForUpDownKeys={true} disableEscapeDoublePress={true} focus={true} showCursor={true} />
          </Box>
          <Text dimColor={true}>{isValueValid ? <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="save" />
                <KeyboardShortcutHint shortcut="Esc" action="cancel" />
              </Byline> : 'Accepts rgb(r,g,b), #rrggbb, ansi256(n), or ansi:name'}</Text>
        </Box>
      </Pane>;
  }
  const finishEditing = () => {
    setPreviewOverrides(null);
    onDone({
      slug: effectiveSlug,
      name,
      base,
      overrides,
      source: 'user'
    });
  };
  const matchLabel = customCount > 0 ? `${customCount} ${customCount === 1 ? 'color' : 'colors'} customized · ${effectiveSlug}.json` : `editing ${effectiveSlug}.json`;
  const renderToken = (token: keyof Theme, isFocused: boolean) => <Box>
      <Swatch value={resolveToken(token)} />
      <Text> </Text>
      <Text color={isFocused ? 'suggestion' : undefined}>{token}</Text>
      {overrides[token] !== undefined && <Text dimColor={true}> (custom)</Text>}
    </Box>;
  const renderTokenPreview = (token: keyof Theme) => <Box flexDirection="column">
      <Text>
        current: <Swatch value={resolveToken(token)} /> {resolveToken(token)}
      </Text>
      {overrides[token] !== undefined && <Text dimColor={true}>
          preset: <Swatch value={baseTheme[token]} /> {baseTheme[token]}
        </Text>}
    </Box>;
  return <FuzzyPicker title={`${name} · based on ${base}`} placeholder="Filter color tokens…" initialQuery={query} items={filteredTokens} getKey={token => token} renderItem={renderToken} renderPreview={renderTokenPreview} onQueryChange={setQuery} onSelect={selectToken} onTab={{
    action: 'reset',
    handler: token => {
      if (token) resetToken(token);
    }
  }} onCancel={finishEditing} emptyMessage={`No color named "${query}"`} matchLabel={matchLabel} selectAction="edit" cancelAction="done" />;
}
