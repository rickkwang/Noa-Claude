import type { AppSettings, ChromeThemeConfig, SemanticColors, ThemeFonts } from '../types';
import { DEFAULT_CODE_THEME_ID, resolveCodeTheme } from './codeThemes';
import { CONTRAST_DEFAULTS, activeContrast, mixRgb } from './contrast';
import { CONTENT_SAME_AS_UI, SYSTEM_DEFAULT_FONT } from './fontFamily';

export type ThemeVariant = 'light' | 'dark';

export interface ThemeTokens {
  surface: string;
  ink: string;
  accent: string;
}

export interface ThemePresetDefinition {
  id: string;
  label: string;
  light?: ThemeTokens & { codeThemeId?: string };
  dark?: ThemeTokens & { codeThemeId?: string };
}

export const DEFAULT_PRESET_ID = 'noa';

/**
 * Built-in presets: Noa (aligned with Codex's Absolutely tokens) first,
 * followed by Codex and the full alphabetical list of Codex-aligned chrome themes.
 */
export const THEME_PRESETS: readonly ThemePresetDefinition[] = [
  {
    id: 'noa',
    label: 'Noa',
    light: { surface: '#F9F9F7', ink: '#2D2D2B', accent: '#CC7D5E' },
    dark: { surface: '#2D2D2B', ink: '#F9F9F7', accent: '#CC7D5E' },
  },
  {
    id: 'codex',
    label: 'Codex',
    light: { surface: '#FFFFFF', ink: '#1A1C1F', accent: '#339CFF' },
    dark: { surface: '#181818', ink: '#FFFFFF', accent: '#339CFF' },
  },
  {
    id: 'ayu',
    label: 'Ayu',
    dark: { surface: '#10141C', ink: '#BFBDB6', accent: '#E6B450', codeThemeId: 'ayu-dark' },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    light: { surface: '#EFF1F5', ink: '#4C4F69', accent: '#8839EF', codeThemeId: 'catppuccin-latte' },
    dark: { surface: '#1E1E2E', ink: '#CDD6F4', accent: '#CBA6F7', codeThemeId: 'catppuccin-mocha' },
  },
  {
    id: 'og',
    label: 'ChatGPT Classic',
    dark: { surface: '#343541', ink: '#D1D5DB', accent: '#10A37F' },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: { surface: '#282A36', ink: '#F8F8F2', accent: '#FF79C6', codeThemeId: 'dracula' },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    light: { surface: '#FDF6E3', ink: '#5C6A72', accent: '#93B259', codeThemeId: 'everforest-light' },
    dark: { surface: '#2D353B', ink: '#D3C6AA', accent: '#A7C080', codeThemeId: 'everforest-dark' },
  },
  {
    id: 'github',
    label: 'GitHub',
    light: { surface: '#FFFFFF', ink: '#1F2328', accent: '#0969DA', codeThemeId: 'github-light' },
    dark: { surface: '#0D1117', ink: '#E6EDF3', accent: '#1F6FEB', codeThemeId: 'github-dark' },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: { surface: '#FBF1C7', ink: '#3C3836', accent: '#458588', codeThemeId: 'gruvbox-light' },
    dark: { surface: '#282828', ink: '#EBDBB2', accent: '#458588', codeThemeId: 'gruvbox-dark' },
  },
  {
    id: 'linear',
    label: 'Linear',
    light: { surface: '#FCFCFD', ink: '#1B1B1B', accent: '#5E6AD2' },
    dark: { surface: '#0F0F11', ink: '#E3E4E6', accent: '#606ACC' },
  },
  {
    id: 'lobster',
    label: 'Lobster',
    dark: { surface: '#131B2E', ink: '#E5E7EB', accent: '#EF4444' },
  },
  {
    id: 'material',
    label: 'Material',
    dark: { surface: '#212121', ink: '#EEFFFF', accent: '#80CBC4', codeThemeId: 'material' },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    dark: { surface: '#272822', ink: '#F8F8F2', accent: '#A6E22E', codeThemeId: 'monokai' },
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    dark: { surface: '#011627', ink: '#D6DEEB', accent: '#82AAFF', codeThemeId: 'night-owl' },
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: { surface: '#2E3440', ink: '#D8DEE9', accent: '#88C0D0', codeThemeId: 'nord' },
  },
  {
    id: 'notion',
    label: 'Notion',
    light: { surface: '#FFFFFF', ink: '#37352F', accent: '#3183D8' },
    dark: { surface: '#191919', ink: '#D9D9D8', accent: '#3183D8' },
  },
  {
    id: 'one',
    label: 'One',
    light: { surface: '#FAFAFA', ink: '#383A42', accent: '#526FFF', codeThemeId: 'one-light' },
    dark: { surface: '#282C34', ink: '#ABB2BF', accent: '#4D78CC', codeThemeId: 'one-dark' },
  },
  {
    id: 'proof',
    label: 'Proof',
    light: { surface: '#F5F5F0', ink: '#2E332E', accent: '#2E6F40' },
  },
  {
    id: 'raycast',
    label: 'Raycast',
    light: { surface: '#FFFFFF', ink: '#1A1A1A', accent: '#FF6363' },
    dark: { surface: '#141414', ink: '#EEEEEE', accent: '#FF6363' },
  },
  {
    id: 'rose-pine',
    label: 'Rose Pine',
    light: { surface: '#FAF4ED', ink: '#575279', accent: '#D7827E', codeThemeId: 'rose-pine-dawn' },
    dark: { surface: '#191724', ink: '#E0DEF4', accent: '#EBBCBA', codeThemeId: 'rose-pine' },
  },
  {
    id: 'sentry',
    label: 'Sentry',
    dark: { surface: '#2D2935', ink: '#E6E2EE', accent: '#7055F6' },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    light: { surface: '#FDF6E3', ink: '#586E75', accent: '#B58900', codeThemeId: 'solarized-light' },
    dark: { surface: '#002B36', ink: '#93A1A1', accent: '#DC322F', codeThemeId: 'solarized-dark' },
  },
  {
    id: 'temple',
    label: 'Temple',
    dark: { surface: '#0B140E', ink: '#E2EDE5', accent: '#D4E600' },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    dark: { surface: '#1A1B26', ink: '#C0CAF5', accent: '#7AA2F7', codeThemeId: 'tokyo-night' },
  },
  {
    id: 'vercel',
    label: 'Vercel',
    light: { surface: '#FFFFFF', ink: '#171717', accent: '#0070F3' },
    dark: { surface: '#000000', ink: '#EDEDED', accent: '#0070F3' },
  },
  {
    id: 'vscode-plus',
    label: 'VS Code Plus',
    light: { surface: '#FFFFFF', ink: '#1F1F1F', accent: '#007ACC', codeThemeId: 'vscode-plus' },
    dark: { surface: '#1E1E1E', ink: '#D4D4D4', accent: '#007ACC', codeThemeId: 'vscode-plus' },
  },
  {
    id: 'xcode',
    label: 'Xcode',
    light: { surface: '#FFFFFF', ink: '#262626', accent: '#0066FF', codeThemeId: 'xcode' },
    dark: { surface: '#292A30', ink: '#DFDFE0', accent: '#4B8BF5', codeThemeId: 'xcode' },
  },
];

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = HEX_RE.exec(value.trim());
  const hex = match?.[1];
  return hex ? `#${hex.toUpperCase()}` : undefined;
}

export function hexToRgbTriplet(hex: string): string {
  const clean = normalizeHex(hex)?.slice(1) ?? '000000';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function presetsForVariant(variant: ThemeVariant): ThemePresetDefinition[] {
  return THEME_PRESETS.filter((preset) => Boolean(preset[variant]));
}

export function getPresetTokens(presetId: string | undefined, variant: ThemeVariant): ThemeTokens {
  const preset = THEME_PRESETS.find((item) => item.id === presetId);
  const fallback: ThemeTokens = variant === 'dark'
    ? { surface: '#2D2D2B', ink: '#F9F9F7', accent: '#CC7D5E' }
    : { surface: '#F9F9F7', ink: '#2D2D2B', accent: '#CC7D5E' };
  const entry = preset?.[variant] ?? THEME_PRESETS[0]?.[variant] ?? fallback;
  return { surface: entry.surface, ink: entry.ink, accent: entry.accent };
}

export function getPresetDefaultCodeThemeId(presetId: string | undefined, variant: ThemeVariant): string {
  const preset = THEME_PRESETS.find((item) => item.id === presetId);
  const candidate = preset?.[variant]?.codeThemeId;
  return candidate ? resolveCodeTheme(candidate, variant).id : DEFAULT_CODE_THEME_ID;
}

export interface ResolvedChromeTheme extends ThemeTokens {
  presetId: string;
  variant: ThemeVariant;
}

export function resolveChromeTheme(
  appearance: AppSettings['appearance'] | undefined,
  isDark: boolean,
): ResolvedChromeTheme {
  const variant: ThemeVariant = isDark ? 'dark' : 'light';
  const stored: ChromeThemeConfig | undefined = isDark
    ? appearance?.darkChromeTheme
    : appearance?.lightChromeTheme;
  const preset = THEME_PRESETS.find((item) => item.id === stored?.presetId && Boolean(item[variant]));
  const presetId = preset?.id ?? DEFAULT_PRESET_ID;
  const base = getPresetTokens(presetId, variant);
  return {
    presetId,
    variant,
    surface: normalizeHex(stored?.surface) ?? base.surface,
    ink: normalizeHex(stored?.ink) ?? base.ink,
    accent: normalizeHex(stored?.accent) ?? base.accent,
  };
}

export interface ThemeSurfaces {
  primary: string;
  secondary: string;
  sidebarMaterial: string;
  card: string;
  surfaceUnder: string;
}

export function deriveSurfaces(
  tokens: ThemeTokens,
  isDark: boolean,
  rawContrast: number,
): ThemeSurfaces {
  const surfaceRgb = hexToRgbTriplet(tokens.surface);
  const inkRgb = hexToRgbTriplet(tokens.ink);
  if (isDark) {
    // Dark floor behind the content card: surface mixed toward black, scaled by contrast.
    const underRatio = 0.14 + (rawContrast - CONTRAST_DEFAULTS.dark) * 0.0015;
    const surfaceUnder = `rgb(${mixRgb(surfaceRgb, '0,0,0', underRatio)})`;
    return {
      primary: tokens.surface,
      secondary: `rgb(${mixRgb(surfaceRgb, '0,0,0', 0.16)})`,
      sidebarMaterial: `rgb(${mixRgb(surfaceRgb, inkRgb, 0.06)})`,
      card: `rgb(${mixRgb(surfaceRgb, inkRgb, 0.08)})`,
      surfaceUnder,
    };
  }
  return {
    primary: tokens.surface,
    secondary: `rgb(${mixRgb(surfaceRgb, inkRgb, 0.03)})`,
    sidebarMaterial: `rgb(${mixRgb(surfaceRgb, inkRgb, 0.02)})`,
    card: `rgb(${mixRgb(surfaceRgb, '255,255,255', 0.55)})`,
    surfaceUnder: `rgb(${mixRgb(surfaceRgb, inkRgb, 0.04)})`,
  };
}

export const themeSurfaces = (
  isDark: boolean,
  appearance?: AppSettings['appearance'],
): ThemeSurfaces => {
  const resolved = resolveChromeTheme(appearance, isDark);
  const rawContrast = appearance ? activeContrast(appearance, isDark) : CONTRAST_DEFAULTS[isDark ? 'dark' : 'light'];
  return deriveSurfaces(resolved, isDark, rawContrast);
};

export const DEFAULT_SEMANTIC_COLORS: Record<ThemeVariant, Required<SemanticColors>> = {
  light: {
    diffAdded: '#00a240',
    diffRemoved: '#ba2623',
    skill: '#924ff7',
  },
  dark: {
    diffAdded: '#40c977',
    diffRemoved: '#fa423e',
    skill: '#ad7bf9',
  },
};

export function resolveSemanticColors(
  appearance: AppSettings['appearance'] | undefined,
  isDark: boolean,
): Required<SemanticColors> {
  const variant: ThemeVariant = isDark ? 'dark' : 'light';
  const stored: ChromeThemeConfig | undefined = isDark
    ? appearance?.darkChromeTheme
    : appearance?.lightChromeTheme;
  const defaults = DEFAULT_SEMANTIC_COLORS[variant];
  return {
    diffAdded: normalizeHex(stored?.semanticColors?.diffAdded) ?? defaults.diffAdded,
    diffRemoved: normalizeHex(stored?.semanticColors?.diffRemoved) ?? defaults.diffRemoved,
    skill: normalizeHex(stored?.semanticColors?.skill) ?? defaults.skill,
  };
}

export function resolveCodeThemeId(
  appearance: AppSettings['appearance'] | undefined,
  isDark: boolean,
): string {
  const variant: ThemeVariant = isDark ? 'dark' : 'light';
  const stored: ChromeThemeConfig | undefined = isDark
    ? appearance?.darkChromeTheme
    : appearance?.lightChromeTheme;
  return resolveCodeTheme(stored?.codeThemeId, variant).id;
}

export function resolveVariantFonts(
  appearance: AppSettings['appearance'] | undefined,
  isDark: boolean,
): ThemeFonts {
  const stored: ChromeThemeConfig | undefined = isDark
    ? appearance?.darkChromeTheme
    : appearance?.lightChromeTheme;
  const base: ThemeFonts = appearance?.fonts ?? {
    ui: SYSTEM_DEFAULT_FONT,
    content: CONTENT_SAME_AS_UI,
    code: SYSTEM_DEFAULT_FONT,
  };
  return {
    ...base,
    ...stored?.fonts,
  };
}

const CODEX_THEME_PREFIX = 'codex-theme-v1:';

export function exportCodexThemeString(
  appearance: AppSettings['appearance'],
  isDark: boolean,
): string {
  const resolved = resolveChromeTheme(appearance, isDark);
  const contrast = activeContrast(appearance, isDark);
  const codeThemeId = resolveCodeThemeId(appearance, isDark);
  const semanticColors = resolveSemanticColors(appearance, isDark);
  const fonts = resolveVariantFonts(appearance, isDark);
  return `${CODEX_THEME_PREFIX}${JSON.stringify({
    codeThemeId,
    variant: resolved.variant,
    theme: {
      presetId: resolved.presetId,
      surface: resolved.surface,
      ink: resolved.ink,
      accent: resolved.accent,
      contrast,
      semanticColors,
      fonts: {
        ui: fonts.ui === SYSTEM_DEFAULT_FONT ? null : fonts.ui,
        code: fonts.code === SYSTEM_DEFAULT_FONT ? null : fonts.code,
      },
    },
  })}`;
}

export interface ParsedCodexThemeImport {
  variant: ThemeVariant;
  chromeTheme: ChromeThemeConfig;
  contrast?: number;
}

export function parseCodexThemeString(raw: string): ParsedCodexThemeImport | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(CODEX_THEME_PREFIX)) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(CODEX_THEME_PREFIX.length)) as {
      codeThemeId?: unknown;
      variant?: unknown;
      theme?: {
        presetId?: unknown;
        surface?: unknown;
        ink?: unknown;
        accent?: unknown;
        contrast?: unknown;
        semanticColors?: {
          diffAdded?: unknown;
          diffRemoved?: unknown;
          skill?: unknown;
        };
        fonts?: {
          ui?: unknown;
          code?: unknown;
        };
      };
    };
    const variant: ThemeVariant | null =
      parsed.variant === 'light' || parsed.variant === 'dark' ? parsed.variant : null;
    if (!variant || !parsed.theme || typeof parsed.theme !== 'object') return null;

    const surface = normalizeHex(parsed.theme.surface);
    const ink = normalizeHex(parsed.theme.ink);
    const accent = normalizeHex(parsed.theme.accent);
    if (!surface || !ink || !accent) return null;

    const candidatePreset = typeof parsed.theme.presetId === 'string' ? parsed.theme.presetId : DEFAULT_PRESET_ID;
    const presetExists = THEME_PRESETS.some((p) => p.id === candidatePreset && Boolean(p[variant]));
    const presetId = presetExists ? candidatePreset : DEFAULT_PRESET_ID;
    const base = getPresetTokens(presetId, variant);

    const resolvedCodeThemeId =
      typeof parsed.codeThemeId === 'string'
        ? resolveCodeTheme(parsed.codeThemeId, variant).id
        : DEFAULT_CODE_THEME_ID;

    const defaultSemantics = DEFAULT_SEMANTIC_COLORS[variant];
    const parsedAdded = normalizeHex(parsed.theme.semanticColors?.diffAdded);
    const parsedRemoved = normalizeHex(parsed.theme.semanticColors?.diffRemoved);
    const parsedSkill = normalizeHex(parsed.theme.semanticColors?.skill);
    const semanticColors: SemanticColors = {
      ...(parsedAdded && parsedAdded.toLowerCase() !== defaultSemantics.diffAdded.toLowerCase() && { diffAdded: parsedAdded }),
      ...(parsedRemoved && parsedRemoved.toLowerCase() !== defaultSemantics.diffRemoved.toLowerCase() && { diffRemoved: parsedRemoved }),
      ...(parsedSkill && parsedSkill.toLowerCase() !== defaultSemantics.skill.toLowerCase() && { skill: parsedSkill }),
    };

    const uiFont = typeof parsed.theme.fonts?.ui === 'string' && parsed.theme.fonts.ui.trim() ? parsed.theme.fonts.ui.trim() : undefined;
    const codeFont = typeof parsed.theme.fonts?.code === 'string' && parsed.theme.fonts.code.trim() ? parsed.theme.fonts.code.trim() : undefined;
    const fonts: Partial<ThemeFonts> | undefined =
      uiFont || codeFont
        ? {
            ...(uiFont && { ui: uiFont }),
            ...(codeFont && { code: codeFont }),
          }
        : undefined;

    const chromeTheme: ChromeThemeConfig = {
      presetId,
      ...(surface !== base.surface && { surface }),
      ...(ink !== base.ink && { ink }),
      ...(accent !== base.accent && { accent }),
      ...(resolvedCodeThemeId !== DEFAULT_CODE_THEME_ID && { codeThemeId: resolvedCodeThemeId }),
      ...(Object.keys(semanticColors).length > 0 && { semanticColors }),
      ...(fonts && { fonts }),
    };

    const contrast =
      typeof parsed.theme.contrast === 'number' && Number.isFinite(parsed.theme.contrast)
        ? Math.round(Math.min(100, Math.max(0, parsed.theme.contrast)))
        : undefined;

    return { variant, chromeTheme, contrast };
  } catch {
    return null;
  }
}
