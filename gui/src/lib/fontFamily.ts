/**
 * Resolves a stored font family into a CSS font stack. The family is
 * SYSTEM_DEFAULT_FONT or the name of a locally installed font (from
 * `queryLocalFonts()`); a selected face is loaded by `faceCssFamily()`. Typefaces are not bundled.
 *
 * The system default uses CSS generic keywords, not a family name: browsers
 * won't resolve the platform UI face (`.AppleSystemUIFont`) by name, so that
 * name silently renders a different face.
 *
 * Keep SYSTEM_FONT_STACK in sync with `--font-ui` in `src/index.css`,
 * which paints before this module runs.
 */

export const SYSTEM_DEFAULT_FONT = 'system-default';

/** Content font sentinel: messages follow the UI family and style, as the reference editor's "Same as UI font". */
export const CONTENT_SAME_AS_UI = 'same-as-ui';

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
export const MONO_FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export function resolveFontFamily(fontFamily: string, fallback = SYSTEM_FONT_STACK): string {
  if (!fontFamily || fontFamily === SYSTEM_DEFAULT_FONT) return fallback;
  if (!isSafeFontFamilyName(fontFamily)) return fallback;
  return `"${fontFamily}", ${fallback}`;
}

