import { describe, expect, test } from 'bun:test';
import { defaultSettings } from '../src/theme/settings';
import {
  DEFAULT_SEMANTIC_COLORS,
  deriveSurfaces,
  exportCodexThemeString,
  getPresetDefaultCodeThemeId,
  parseCodexThemeString,
  presetsForVariant,
  resolveChromeTheme,
  resolveCodeThemeId,
  resolveSemanticColors,
  resolveVariantFonts,
  THEME_PRESETS,
} from '../src/lib/themePalette';
import { CODE_THEMES, getCodeThemeOptions, resolveCodeTheme } from '../src/lib/codeThemes';

describe('themePalette', () => {
  test('defaults to Noa light and dark tokens aligned with Absolutely', () => {
    const light = resolveChromeTheme(defaultSettings.appearance, false);
    expect(light).toEqual({
      presetId: 'noa',
      variant: 'light',
      surface: '#F9F9F7',
      ink: '#2D2D2B',
      accent: '#CC7D5E',
    });
    expect(deriveSurfaces(light, false, 45).primary).toBe('#F9F9F7');

    const dark = resolveChromeTheme(defaultSettings.appearance, true);
    expect(dark).toEqual({
      presetId: 'noa',
      variant: 'dark',
      surface: '#2D2D2B',
      ink: '#F9F9F7',
      accent: '#CC7D5E',
    });
    expect(deriveSurfaces(dark, true, 60).primary).toBe('#2D2D2B');
    expect(presetsForVariant('light').some((p) => p.id === 'absolutely')).toBe(false);
  });

  test('dark-only presets are excluded from light options and fall back safely', () => {
    const lightIds = presetsForVariant('light').map((p) => p.id);
    const darkIds = presetsForVariant('dark').map((p) => p.id);
    expect(lightIds).not.toContain('dracula');
    expect(darkIds).toContain('dracula');

    const resolvedLight = resolveChromeTheme(
      { ...defaultSettings.appearance, lightChromeTheme: { presetId: 'dracula' } },
      false,
    );
    expect(resolvedLight.presetId).toBe('noa');
  });

  test('applies preset and custom accent overrides and derives surfaces', () => {
    const resolved = resolveChromeTheme(
      {
        ...defaultSettings.appearance,
        darkChromeTheme: { presetId: 'catppuccin', accent: '#123456' },
      },
      true,
    );
    expect(resolved.presetId).toBe('catppuccin');
    expect(resolved.surface).toBe('#1E1E2E');
    expect(resolved.ink).toBe('#CDD6F4');
    expect(resolved.accent).toBe('#123456');

    const surfaces = deriveSurfaces(resolved, true, 60);
    expect(surfaces.primary).toBe('#1E1E2E');
    expect(surfaces.surfaceUnder).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  test('exports and imports codex-theme-v1 strings', () => {
    const customAppearance = {
      ...defaultSettings.appearance,
      darkChromeTheme: { presetId: 'github', accent: '#AABBCC' },
      contrast: { light: 45, dark: 75 },
    };
    const encoded = exportCodexThemeString(customAppearance, true);
    expect(encoded.startsWith('codex-theme-v1:')).toBe(true);

    const parsed = parseCodexThemeString(encoded);
    expect(parsed).toEqual({
      variant: 'dark',
      chromeTheme: { presetId: 'github', accent: '#AABBCC' },
      contrast: 75,
    });

    expect(parseCodexThemeString('not-a-theme')).toBeNull();
    expect(parseCodexThemeString('codex-theme-v1:{bad json')).toBeNull();
  });

  test('resolves per-variant code themes, semantic colors, and fonts', () => {
    expect(getCodeThemeOptions('light').some(([id]) => id === 'dracula')).toBe(false);
    expect(getCodeThemeOptions('dark').some(([id]) => id === 'dracula')).toBe(true);

    const appearance = {
      ...defaultSettings.appearance,
      lightChromeTheme: {
        presetId: 'noa',
        codeThemeId: 'github-light',
        semanticColors: { diffAdded: '#112233' },
        fonts: { ui: 'Inter' },
      },
      darkChromeTheme: {
        presetId: 'noa',
        codeThemeId: 'dracula',
        semanticColors: { skill: '#445566' },
        fonts: { code: 'JetBrains Mono' },
      },
    };

    expect(resolveCodeThemeId(appearance, false)).toBe('github-light');
    expect(resolveCodeThemeId(appearance, true)).toBe('dracula');
    expect(resolveCodeTheme('dracula', 'light').id).toBe('codex');

    expect(resolveSemanticColors(appearance, false)).toEqual({
      ...DEFAULT_SEMANTIC_COLORS.light,
      diffAdded: '#112233',
    });
    expect(resolveSemanticColors(appearance, true)).toEqual({
      ...DEFAULT_SEMANTIC_COLORS.dark,
      skill: '#445566',
    });

    expect(resolveVariantFonts(appearance, false).ui).toBe('Inter');
    expect(resolveVariantFonts(appearance, false).code).toBe(defaultSettings.appearance.fonts.code);
    expect(resolveVariantFonts(appearance, true).code).toBe('JetBrains Mono');
    expect(resolveVariantFonts(appearance, true).ui).toBe(defaultSettings.appearance.fonts.ui);

    const encoded = exportCodexThemeString(appearance, true);
    const parsed = parseCodexThemeString(encoded);
    expect(parsed?.chromeTheme.codeThemeId).toBe('dracula');
    expect(parsed?.chromeTheme.semanticColors).toEqual({ skill: '#445566' });
    expect(parsed?.chromeTheme.fonts).toEqual({ code: 'JetBrains Mono' });
  });

  test('includes Codex light/dark presets and pairs them with matching code themes', () => {
    const lightIds = presetsForVariant('light').map((p) => p.id);
    const darkIds = presetsForVariant('dark').map((p) => p.id);

    for (const id of ['proof', 'raycast', 'rose-pine', 'solarized', 'vercel', 'vscode-plus', 'xcode']) {
      expect(lightIds).toContain(id);
    }
    expect(lightIds).not.toContain('lobster');
    expect(lightIds).not.toContain('sentry');
    expect(lightIds).not.toContain('temple');
    expect(lightIds).not.toContain('tokyo-night');

    for (const id of ['lobster', 'raycast', 'rose-pine', 'sentry', 'solarized', 'temple', 'tokyo-night', 'vercel', 'vscode-plus', 'xcode']) {
      expect(darkIds).toContain(id);
    }
    expect(darkIds).not.toContain('proof');

    expect(getPresetDefaultCodeThemeId('solarized', 'light')).toBe('solarized-light');
    expect(getPresetDefaultCodeThemeId('solarized', 'dark')).toBe('solarized-dark');
    expect(getPresetDefaultCodeThemeId('rose-pine', 'light')).toBe('rose-pine-dawn');
    expect(getPresetDefaultCodeThemeId('rose-pine', 'dark')).toBe('rose-pine');
    expect(getPresetDefaultCodeThemeId('tokyo-night', 'dark')).toBe('tokyo-night');
    expect(getPresetDefaultCodeThemeId('everforest', 'dark')).toBe('everforest-dark');
    expect(getPresetDefaultCodeThemeId('night-owl', 'dark')).toBe('night-owl');
    expect(getPresetDefaultCodeThemeId('noa', 'dark')).toBe('codex');
  });

  test('every preset and code theme resolves, derives surfaces, and round-trips cleanly', () => {
    const hexRe = /^#[0-9A-F]{6}$/;
    const rgbRe = /^rgb\(\d+,\d+,\d+\)$/;

    for (const preset of THEME_PRESETS) {
      for (const variant of ['light', 'dark'] as const) {
        if (!preset[variant]) continue;
        const isDark = variant === 'dark';
        const key = isDark ? 'darkChromeTheme' : 'lightChromeTheme';
        const codeThemeId = getPresetDefaultCodeThemeId(preset.id, variant);
        const appearance = {
          ...defaultSettings.appearance,
          [key]: { presetId: preset.id, codeThemeId },
        };

        const resolved = resolveChromeTheme(appearance, isDark);
        expect(resolved.presetId).toBe(preset.id);
        expect(resolved.surface).toMatch(hexRe);
        expect(resolved.ink).toMatch(hexRe);
        expect(resolved.accent).toMatch(hexRe);

        const surfaces = deriveSurfaces(resolved, isDark, isDark ? 60 : 45);
        expect(surfaces.primary).toBe(resolved.surface);
        expect(surfaces.secondary).toMatch(rgbRe);
        expect(surfaces.sidebarMaterial).toMatch(rgbRe);
        expect(surfaces.card).toMatch(rgbRe);
        expect(surfaces.surfaceUnder).toMatch(rgbRe);

        expect(resolveCodeThemeId(appearance, isDark)).toBe(codeThemeId);

        const parsed = parseCodexThemeString(exportCodexThemeString(appearance, isDark));
        expect(parsed?.variant).toBe(variant);
        expect(parsed?.chromeTheme.presetId).toBe(preset.id);
      }
    }

    for (const codeTheme of CODE_THEMES) {
      const variants = codeTheme.variant === 'both' ? (['light', 'dark'] as const) : ([codeTheme.variant] as const);
      for (const variant of variants) {
        const resolved = resolveCodeTheme(codeTheme.id, variant);
        expect(resolved.id).toBe(codeTheme.id);
        expect(resolved.colors.keyword.length).toBeGreaterThan(0);
        expect(resolved.colors.string.length).toBeGreaterThan(0);
        expect(resolved.colors.comment.length).toBeGreaterThan(0);
      }
    }
  });
});
