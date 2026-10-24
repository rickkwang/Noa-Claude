/**
 * Resolves the stored `appearance.fontFamily` setting into a CSS font stack.
 * The setting is SYSTEM_DEFAULT_FONT or the family name of a locally installed
 * font (from `queryLocalFonts()`). Typefaces are not bundled.
 *
 * The system default uses CSS generic keywords, not a family name: browsers
 * won't resolve the platform UI face (`.AppleSystemUIFont`) by name, so that
 * name silently renders a different face.
 *
 * Keep SYSTEM_FONT_STACK in sync with `--font-ui` in `src/index.css`,
 * which paints before this module runs.
 */

import type { AppSettings } from '../types';

export const SYSTEM_DEFAULT_FONT = 'system-default';

export const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Family names reach CSS through a `<style>` element in ThemeInjector, so a
 * name carrying quotes, braces or semicolons could terminate the declaration
 * and inject rules. Real family names — including CJK ones — are letters,
 * digits, spaces and light punctuation, so anything else is rejected outright
 * rather than escaped.
 */
const SAFE_FAMILY = /^[\p{L}\p{N} ._-]{1,120}$/u;

export function isSafeFontFamilyName(value: string): boolean {
  return SAFE_FAMILY.test(value);
}

/**
 * Builds the CSS `font-family` value for a stored setting. Named fonts keep the
 * system stack as a suffix so uninstalling a font degrades to the platform UI
 * face instead of the browser's default serif.
 */
export function resolveFontFamily(fontFamily: string): string {
  if (!fontFamily || fontFamily === SYSTEM_DEFAULT_FONT) return SYSTEM_FONT_STACK;
  if (!isSafeFontFamilyName(fontFamily)) return SYSTEM_FONT_STACK;
  return `"${fontFamily}", ${SYSTEM_FONT_STACK}`;
}

/**
 * UI font style = weight + italic. Values are the stored setting, so renaming one is a migration.
 */
export const UI_FONT_STYLES: Record<
  AppSettings['appearance']['uiFontStyle'],
  { label: string; weight: number; italic: boolean }
> = {
  light: { label: 'Light', weight: 300, italic: false },
  'light-italic': { label: 'Light Italic', weight: 300, italic: true },
  regular: { label: 'Regular', weight: 400, italic: false },
  'regular-italic': { label: 'Regular Italic', weight: 400, italic: true },
  medium: { label: 'Medium', weight: 500, italic: false },
  'medium-italic': { label: 'Medium Italic', weight: 500, italic: true },
  semibold: { label: 'Semibold', weight: 600, italic: false },
  'semibold-italic': { label: 'Semibold Italic', weight: 600, italic: true },
  bold: { label: 'Bold', weight: 700, italic: false },
  'bold-italic': { label: 'Bold Italic', weight: 700, italic: true },
};

export const DEFAULT_UI_FONT_STYLE: AppSettings['appearance']['uiFontStyle'] = 'regular';

export function isUiFontStyle(value: unknown): value is AppSettings['appearance']['uiFontStyle'] {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UI_FONT_STYLES, value);
}
