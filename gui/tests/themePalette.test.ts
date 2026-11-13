import { describe, expect, test } from 'bun:test';
import { defaultSettings } from '../src/theme/settings';
import {
  DEFAULT_SEMANTIC_COLORS,
  deriveSurfaces,
  exportCodexThemeString,
  parseCodexThemeString,
  presetsForVariant,
  resolveChromeTheme,
  resolveCodeThemeId,
  resolveSemanticColors,
  resolveVariantFonts,
} from '../src/lib/themePalette';
import { getCodeThemeOptions, resolveCodeTheme } from '../src/lib/codeThemes';

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
});
