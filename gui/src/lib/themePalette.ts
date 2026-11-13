import type { AppSettings, ChromeThemeConfig } from '../types';
import { CONTRAST_DEFAULTS, activeContrast, mixRgb } from './contrast';

export type ThemeVariant = 'light' | 'dark';

export interface ThemeTokens {
  surface: string;
  ink: string;
  accent: string;
}

export interface ThemePresetDefinition {
  id: string;
  label: string;
  light?: ThemeTokens;
  dark?: ThemeTokens;
}

export const DEFAULT_PRESET_ID = 'noa';

/**
 * Built-in presets: Noa (aligned with Codex's Absolutely tokens) first, followed by Codex's chrome themes.
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
    id: 'catppuccin',
    label: 'Catppuccin',
    light: { surface: '#EFF1F5', ink: '#4C4F69', accent: '#8839EF' },
    dark: { surface: '#1E1E2E', ink: '#CDD6F4', accent: '#CBA6F7' },
  },
  {
    id: 'github',
    label: 'GitHub',
    light: { surface: '#FFFFFF', ink: '#1F2328', accent: '#0969DA' },
    dark: { surface: '#0D1117', ink: '#E6EDF3', accent: '#1F6FEB' },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: { surface: '#FBF1C7', ink: '#3C3836', accent: '#458588' },
    dark: { surface: '#282828', ink: '#EBDBB2', accent: '#458588' },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    light: { surface: '#FDF6E3', ink: '#5C6A72', accent: '#93B259' },
    dark: { surface: '#2D353B', ink: '#D3C6AA', accent: '#A7C080' },
  },
  {
    id: 'linear',
    label: 'Linear',
    light: { surface: '#FCFCFD', ink: '#1B1B1B', accent: '#5E6AD2' },
    dark: { surface: '#0F0F11', ink: '#E3E4E6', accent: '#606ACC' },
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
    light: { surface: '#FAFAFA', ink: '#383A42', accent: '#526FFF' },
    dark: { surface: '#282C34', ink: '#ABB2BF', accent: '#4D78CC' },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    dark: { surface: '#282A36', ink: '#F8F8F2', accent: '#FF79C6' },
  },
  {
    id: 'nord',
    label: 'Nord',
    dark: { surface: '#2E3440', ink: '#D8DEE9', accent: '#88C0D0' },
  },
  {
    id: 'ayu',
    label: 'Ayu',
    dark: { surface: '#10141C', ink: '#BFBDB6', accent: '#E6B450' },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    dark: { surface: '#272822', ink: '#F8F8F2', accent: '#99947C' },
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    dark: { surface: '#011627', ink: '#D6DEEB', accent: '#44596B' },
  },
  {
    id: 'material',
    label: 'Material',
    dark: { surface: '#212121', ink: '#EEFFFF', accent: '#80CBC4' },
  },
  {
    id: 'og',
    label: 'ChatGPT Classic',
    dark: { surface: '#343541', ink: '#D1D5DB', accent: '#10A37F' },
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
  return preset?.[variant] ?? THEME_PRESETS[0]?.[variant] ?? fallback;
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

const CODEX_THEME_PREFIX = 'codex-theme-v1:';

export function exportCodexThemeString(
  appearance: AppSettings['appearance'],
  isDark: boolean,
): string {
  const resolved = resolveChromeTheme(appearance, isDark);
  const contrast = activeContrast(appearance, isDark);
  return `${CODEX_THEME_PREFIX}${JSON.stringify({
    codeThemeId: 'codex',
    variant: resolved.variant,
    theme: {
      presetId: resolved.presetId,
      surface: resolved.surface,
      ink: resolved.ink,
      accent: resolved.accent,
      contrast,
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
      variant?: unknown;
      theme?: {
        presetId?: unknown;
        surface?: unknown;
        ink?: unknown;
        accent?: unknown;
        contrast?: unknown;
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

    const chromeTheme: ChromeThemeConfig = {
      presetId,
      ...(surface !== base.surface && { surface }),
      ...(ink !== base.ink && { ink }),
      ...(accent !== base.accent && { accent }),
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
