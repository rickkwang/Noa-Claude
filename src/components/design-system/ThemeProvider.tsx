// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import useStdin from '../../ink/hooks/use-stdin.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getCachedCustomThemes, loadCustomThemes, mergeThemeOverrides, parseCustomThemeRef, pluginThemesStore, watchCustomThemes, type CustomTheme } from '../../utils/customThemes.js';
import { loadPluginThemes } from '../../utils/plugins/loadPluginThemes.js';
import { getSystemThemeName, type SystemTheme } from '../../utils/systemTheme.js';
import { getTheme, type Theme, type ThemeName, type ThemeSetting } from '../../utils/theme.js';
type ThemeContextValue = {
  /** The saved user preference. May be 'auto' or a `custom:<slug>` ref. */
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setPreviewTheme: (setting: ThemeSetting) => void;
  savePreview: () => void;
  cancelPreview: () => void;
  /** The resolved base theme name. Never 'auto'; custom refs map to their base. */
  currentTheme: ThemeName;
  /** The palette to render with: base theme plus any active custom overrides. */
  resolvedTheme: Theme;
  /** User + plugin custom themes, user first, sorted by name. */
  customThemes: readonly CustomTheme[];
  /** The custom theme the current setting refers to, if any. */
  activeCustomTheme: CustomTheme | undefined;
  reloadCustomThemes: () => void;
  /** Live palette overrides while the theme editor is open. null clears. */
  setPreviewOverrides: (overrides: Partial<Theme> | null) => void;
};

// Non-'auto' default so useTheme() works without a provider (tests, tooling).
const DEFAULT_THEME: ThemeName = 'dark';
const ThemeContext = createContext<ThemeContextValue>({
  themeSetting: DEFAULT_THEME,
  setThemeSetting: () => {},
  setPreviewTheme: () => {},
  savePreview: () => {},
  cancelPreview: () => {},
  currentTheme: DEFAULT_THEME,
  resolvedTheme: getTheme(DEFAULT_THEME),
  customThemes: [],
  activeCustomTheme: undefined,
  reloadCustomThemes: () => {},
  setPreviewOverrides: () => {}
});
type Props = {
  children: React.ReactNode;
  initialState?: ThemeSetting;
  onThemeSave?: (setting: ThemeSetting) => void;
};
function defaultInitialTheme(): ThemeSetting {
  return getGlobalConfig().theme;
}
function defaultSaveTheme(setting: ThemeSetting): void {
  saveGlobalConfig(current => ({
    ...current,
    theme: setting
  }));
}
export function ThemeProvider({
  children,
  initialState,
  onThemeSave = defaultSaveTheme
}: Props) {
  const [themeSetting, setThemeSetting] = useState(initialState ?? defaultInitialTheme);
  const [previewTheme, setPreviewTheme] = useState<ThemeSetting | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Partial<Theme> | null>(null);
  const [userCustomThemes, setUserCustomThemes] = useState<readonly CustomTheme[]>(getCachedCustomThemes);
  const pluginThemes = useSyncExternalStore(pluginThemesStore.subscribe, pluginThemesStore.getState);
  const customThemes = useMemo(() => [...userCustomThemes, ...pluginThemes], [userCustomThemes, pluginThemes]);

  // Track terminal theme for 'auto' resolution. Seeds from $COLORFGBG (or
  // 'dark' if unset); the OSC 11 watcher corrects it on first poll.
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() => (initialState ?? themeSetting) === 'auto' ? getSystemThemeName() : 'dark');

  // The setting currently in effect (preview wins while picker is open)
  const activeSetting = previewTheme ?? themeSetting;
  const {
    internal_querier
  } = useStdin();
  const reloadCustomThemes = useMemo(() => () => {
    void loadCustomThemes().then(setUserCustomThemes);
  }, []);

  // Initial load of user + plugin themes, then live-reload user themes on
  // file changes so edits made outside the picker show up without a restart.
  useEffect(() => {
    reloadCustomThemes();
    void loadPluginThemes();
    return watchCustomThemes(reloadCustomThemes);
  }, [reloadCustomThemes]);

  // Watch for live terminal theme changes while 'auto' is active.
  // Positive feature() pattern so the watcher import is dead-code-eliminated
  // in external builds.
  useEffect(() => {
    if (feature('AUTO_THEME')) {
      if (activeSetting !== 'auto' || !internal_querier) return;
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      void import('../../utils/systemThemeWatcher.js').then(({
        watchSystemTheme
      }) => {
        if (cancelled) return;
        cleanup = watchSystemTheme(internal_querier, setSystemTheme);
      });
      return () => {
        cancelled = true;
        cleanup?.();
      };
    }
  }, [activeSetting, internal_querier]);
  const activeCustomSlug = parseCustomThemeRef(activeSetting);
  const activeCustomTheme = activeCustomSlug ? customThemes.find(theme => theme.slug === activeCustomSlug) : undefined;
  const currentTheme: ThemeName = activeCustomTheme ? activeCustomTheme.base : activeSetting === 'auto' ? systemTheme : activeCustomSlug ? 'dark' : activeSetting as ThemeName;
  const resolvedTheme = mergeThemeOverrides(getTheme(currentTheme), previewOverrides ?? activeCustomTheme?.overrides);
  const value = useMemo<ThemeContextValue>(() => ({
    themeSetting,
    setThemeSetting: (newSetting: ThemeSetting) => {
      setThemeSetting(newSetting);
      setPreviewTheme(null);
      // Switching to 'auto' restarts the watcher (activeSetting dep), whose
      // first poll fires immediately. Seed from the cache so the OSC
      // round-trip doesn't flash the wrong palette.
      if (newSetting === 'auto') {
        setSystemTheme(getSystemThemeName());
      }
      onThemeSave?.(newSetting);
    },
    setPreviewTheme: (newSetting_0: ThemeSetting) => {
      setPreviewTheme(newSetting_0);
      if (newSetting_0 === 'auto') {
        setSystemTheme(getSystemThemeName());
      }
    },
    savePreview: () => {
      if (previewTheme !== null) {
        setThemeSetting(previewTheme);
        setPreviewTheme(null);
        onThemeSave?.(previewTheme);
      }
    },
    cancelPreview: () => {
      if (previewTheme !== null) {
        setPreviewTheme(null);
      }
    },
    currentTheme,
    resolvedTheme,
    customThemes,
    activeCustomTheme,
    reloadCustomThemes,
    setPreviewOverrides
  }), [themeSetting, previewTheme, currentTheme, resolvedTheme, customThemes, activeCustomTheme, reloadCustomThemes, onThemeSave]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the resolved base theme name (never 'auto'; a custom theme resolves
 * to its base) and a setter that accepts any ThemeSetting (including 'auto'
 * and `custom:<slug>` refs). For rendering colors, prefer useResolvedTheme.
 */
export function useTheme() {
  const $ = _c(3);
  const {
    currentTheme,
    setThemeSetting
  } = useContext(ThemeContext);
  let t0;
  if ($[0] !== currentTheme || $[1] !== setThemeSetting) {
    t0 = [currentTheme, setThemeSetting];
    $[0] = currentTheme;
    $[1] = setThemeSetting;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return t0;
}

/**
 * Returns the raw theme setting as stored in config. Use this in UI that
 * needs to show 'auto' as a distinct choice (e.g., ThemePicker).
 */
export function useThemeSetting() {
  return useContext(ThemeContext).themeSetting;
}
export function usePreviewTheme() {
  const $ = _c(4);
  const {
    setPreviewTheme,
    savePreview,
    cancelPreview
  } = useContext(ThemeContext);
  let t0;
  if ($[0] !== cancelPreview || $[1] !== savePreview || $[2] !== setPreviewTheme) {
    t0 = {
      setPreviewTheme,
      savePreview,
      cancelPreview
    };
    $[0] = cancelPreview;
    $[1] = savePreview;
    $[2] = setPreviewTheme;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}

/**
 * Returns the palette to render with: the base theme merged with the active
 * custom theme's (or the theme editor's live preview) overrides.
 */
export function useResolvedTheme(): Theme {
  return useContext(ThemeContext).resolvedTheme;
}
export function useCustomThemes() {
  const $ = _c(5);
  const {
    customThemes,
    activeCustomTheme,
    reloadCustomThemes,
    setPreviewOverrides
  } = useContext(ThemeContext);
  let t0;
  if ($[0] !== activeCustomTheme || $[1] !== customThemes || $[2] !== reloadCustomThemes || $[3] !== setPreviewOverrides) {
    t0 = {
      customThemes,
      activeCustomTheme,
      reloadCustomThemes,
      setPreviewOverrides
    };
    $[0] = activeCustomTheme;
    $[1] = customThemes;
    $[2] = reloadCustomThemes;
    $[3] = setPreviewOverrides;
    $[4] = t0;
  } else {
    t0 = $[4];
  }
  return t0;
}
