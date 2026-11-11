import { CONTENT_SAME_AS_UI, SYSTEM_DEFAULT_FONT } from './fontFamily';
import type { AppSettings, ThemeFontFace, ThemeFonts } from '../types';

const LEGACY_STYLE_NAMES: Record<string, string> = {
  light: 'Light', 'light-italic': 'Light Italic',
  'regular-italic': 'Italic',
  medium: 'Medium', 'medium-italic': 'Medium Italic',
  semibold: 'Semibold', 'semibold-italic': 'Semibold Italic',
  bold: 'Bold', 'bold-italic': 'Bold Italic',
};

/**
 * The face an old weight/italic setting asked for, named the way installed faces usually are ("Inter Bold Italic").
 * Best effort: the face loads through local(), so a name that does not match falls back to the family's regular face.
 * The platform default has no selectable face and Regular is the default face, so neither needs one.
 */
function legacyFace(family: string, style: unknown): ThemeFontFace | undefined {
  const name = typeof style === 'string' ? LEGACY_STYLE_NAMES[style] : undefined;
  if (!name || family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI) return undefined;
  return { family, fullName: `${family} ${name}`, postscriptName: `${family.replace(/\s+/g, '')}-${name.replace(/\s+/g, '')}`, style: name };
}

function isDefaultFonts(fonts: ThemeFonts | undefined): boolean {
  return !fonts || (fonts.ui === SYSTEM_DEFAULT_FONT && fonts.content === CONTENT_SAME_AS_UI && fonts.code === SYSTEM_DEFAULT_FONT && !fonts.uiFace && !fonts.contentFace && !fonts.codeFace);
}

/**
 * Older builds stored one global family per role plus a weight/italic enum, and later one font set per theme.
 * Fonts are now one set for both themes: a per-theme pair keeps the light set, or the dark one when only
 * dark was ever customised. Superseded keys are dropped.
 */
export function migrateAppearance(raw: unknown): Partial<AppSettings['appearance']> {
  if (!raw || typeof raw !== 'object') return {};
  const saved = { ...(raw as Record<string, unknown>) };

  if (!saved.fonts || typeof saved.fonts !== 'object') {
    const ui = typeof saved.fontFamily === 'string' ? saved.fontFamily : SYSTEM_DEFAULT_FONT;
    const content = typeof saved.contentFontFamily === 'string' ? saved.contentFontFamily : CONTENT_SAME_AS_UI;
    const code = typeof saved.codeFontFamily === 'string' ? saved.codeFontFamily : SYSTEM_DEFAULT_FONT;
    const uiFace = legacyFace(ui, saved.uiFontStyle);
    const contentFace = legacyFace(content, saved.contentFontStyle);
    saved.fonts = { ui, content, code, ...(uiFace && { uiFace }), ...(contentFace && { contentFace }) } satisfies ThemeFonts;
  } else if ('light' in saved.fonts || 'dark' in saved.fonts) {
    const { light, dark } = saved.fonts as { light?: ThemeFonts; dark?: ThemeFonts };
    const kept = isDefaultFonts(light) && !isDefaultFonts(dark) ? dark : light;
    if (kept) saved.fonts = kept;
    else delete saved.fonts;
  }

  if (typeof saved.translucentSidebar === 'boolean') {
    saved.translucentSidebar = { light: saved.translucentSidebar, dark: saved.translucentSidebar };
  }

  if (typeof saved.reduceMotion === 'boolean') {
    saved.motion ??= saved.reduceMotion ? 'reduced' : 'system';
  }
  delete saved.reduceMotion;

  delete saved.fontFamily;
  delete saved.uiFontStyle;
  delete saved.contentFontFamily;
  delete saved.contentFontStyle;
  delete saved.codeFontFamily;

  return saved as Partial<AppSettings['appearance']>;
}
