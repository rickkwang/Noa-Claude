import { useLayoutEffect } from 'react';
import { useIsDark } from '../hooks/useIsDark';
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI, MONO_FONT_STACK, resolveFontFamily } from '../lib/fontFamily';
import { faceFamilyName, faceFontFaceRule, quoteFamily } from '../lib/localFonts';
import { CONTRAST_DEFAULTS, activeContrast, effectiveContrast, inkAlpha, mixRgb } from '../lib/contrast';
import { activeTranslucency, supportsSidebarTranslucency } from '../lib/translucency';
import { themeSurfaces } from '../lib/themePalette';
import type { AppSettings, ThemeFontFace } from '../types';

interface ThemeInjectorProps {
  settings: AppSettings;
}

export default function ThemeInjector({ settings }: ThemeInjectorProps) {
  const isDark = useIsDark(settings.appearance.theme);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const surfaces = themeSurfaces(isDark);
    // One value drives every tier below, as in the reference theme: borders and dividers, the ghost hover wash, the
    // secondary/tertiary text and icon inks, and the floor behind the content card. `raw` (0-100) is what the slider
    // stores and scales the floor; `contrast` is the remapped value the alpha tiers use.
    const variant = isDark ? 'dark' : 'light';
    const raw = activeContrast(settings.appearance, isDark);
    const contrast = effectiveContrast(raw, variant);
    const ink = isDark ? '249,249,247' : '45,45,43';
    const alpha = (value: number) => `rgba(${ink},${value})`;
    // Structural rules (titlebar, panel edges, separators) sit on the default border tier, as the reference's
    // `border-default` separators do; the lighter tier is kept for rules inside a card or list.
    const divider = alpha(isDark ? inkAlpha(0.03, 0.02, contrast) : inkAlpha(0.04, 0.02, contrast));
    const border = alpha(inkAlpha(0.06, 0.04, contrast));
    const textSecondary = alpha(inkAlpha(0.65, 0.1, contrast));
    const textTertiary = alpha(isDark ? inkAlpha(0.42, 0.13, contrast) : inkAlpha(0.45, 0.1, contrast));
    const borderStrong = alpha(isDark ? inkAlpha(0.12, 0.06, contrast) : inkAlpha(0.09, 0.06, contrast));
    // Ghost hover is the control surface's hover tier, which moves with contrast; the pressed tier is a
    // fixed 12%/16% wash, so it does not.
    const fillHover = alpha(isDark ? 0.06 + contrast * 0.03 : 0.04 + contrast * 0.03);
    const surfaceRgb = isDark ? '45,45,43' : '249,249,247';
    // Floor behind the content card: in light the surface mixes toward the ink, in dark toward black, so the
    // card's rounded edge reads in both variants.
    const surfaceUnder = `rgb(${mixRgb(surfaceRgb, isDark ? '0,0,0' : ink, isDark ? 0.16 + (raw - CONTRAST_DEFAULTS.dark) * 0.0015 : 0.04 + (raw - CONTRAST_DEFAULTS.light) * 0.0012)})`;
    // theme-bootstrap.js paints <html> opaque for the pre-React frame; once body and the shell
    // take over it must go, or it covers the native material under the translucent sidebar.
    root.style.removeProperty('background-color');
    root.style.setProperty('--bg-primary', surfaces.primary);
    // Page surface: the colour the old remap gave the literal #F9F9F7 classes, in both themes.
    root.style.setProperty('--surface-page', 'var(--bg-primary)');
    // Light ink for text on dark surfaces. Fixed in both themes: it is only used in dark branches.
    root.style.setProperty('--ink-on-dark', '#F9F9F7');
    root.style.setProperty('--bg-secondary', surfaces.secondary);
    // Opaque sidebar floor; --sidebar-material-color is the separate translucent tint.
    root.style.setProperty('--bg-sidebar', surfaceUnder);
    root.style.setProperty('--sidebar-material-color', surfaces.sidebarMaterial);
    root.style.setProperty('--bg-card', surfaces.card);

    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--sidebar-material-tint', '70%');
      // Four stacked layers approximate light falloff; a single shadow reads as a band with a visible edge on dark.
      root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(0,0,0,0.07), 3px 0 6px -2px rgba(0,0,0,0.09), 10px 0 22px -6px rgba(0,0,0,0.11), 26px 0 54px -16px rgba(0,0,0,0.12)');
      // Codex Absolutely Dark: #2D2D2B surface + #F9F9F7 ink.
      root.style.setProperty('--text-primary', '#F9F9F7');
      root.style.setProperty('--text-secondary', textSecondary);
      root.style.setProperty('--text-tertiary', textTertiary);
      root.style.setProperty('--sidebar-text', 'rgba(249,249,247,0.85)');
      root.style.setProperty('--sidebar-text-muted', textSecondary);
      root.style.setProperty('--icon-ink', textSecondary);
      root.style.setProperty('--divider-subtle', border);
      root.style.setProperty('--border-default', border);
      root.style.setProperty('--border-light', divider);
      root.style.setProperty('--border-strong', borderStrong);
      root.style.setProperty('--border-primary', 'var(--border-default)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
      root.style.setProperty('--control-shadow-ink', '#000000');
      // Model/effort popover (dark).
      root.style.setProperty('--effort-menu', '#474745');
      root.style.setProperty('--effort-chip', 'rgba(249,249,247,0.052)');
      root.style.setProperty('--effort-track', 'rgba(249,249,247,0.084)');
      root.style.setProperty('--effort-dot', 'rgba(249,249,247,0.71)');
      root.style.setProperty('--effort-thumb', '#F9F9F7');
    } else {
      root.removeAttribute('data-theme');
      root.style.setProperty('--sidebar-material-tint', '70%');
      // Light counterpart of the dark stack, at lower weight since light floors don't band.
      root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(45,45,43,0.03), 3px 0 6px -2px rgba(45,45,43,0.035), 10px 0 22px -6px rgba(45,45,43,0.04), 26px 0 54px -16px rgba(45,45,43,0.05)');
      // Codex Absolutely Light: #F9F9F7 surface + #2D2D2B ink.
      root.style.setProperty('--text-primary', '#2D2D2B');
      root.style.setProperty('--text-secondary', textSecondary);
      root.style.setProperty('--text-tertiary', textTertiary);
      root.style.setProperty('--sidebar-text', 'rgba(45,45,43,0.85)');
      root.style.setProperty('--sidebar-text-muted', textSecondary);
      root.style.setProperty('--icon-ink', textSecondary);
      root.style.setProperty('--divider-subtle', border);
      root.style.setProperty('--border-default', border);
      root.style.setProperty('--border-light', divider);
      root.style.setProperty('--border-strong', borderStrong);
      root.style.setProperty('--border-primary', 'var(--border-default)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
      root.style.setProperty('--control-shadow-ink', '#000000');
      root.style.setProperty('--effort-menu', '#FAFAF8');
      root.style.setProperty('--effort-chip', 'rgba(45,45,43,0.049)');
      root.style.setProperty('--effort-track', 'rgba(45,45,43,0.078)');
      root.style.setProperty('--effort-dot', 'rgba(45,45,43,0.695)');
      root.style.setProperty('--effort-thumb', '#FAFAF9');
    }

    // Accent is a fixed theme token (coral in both themes), not user-configurable.
    root.style.setProperty('--accent-color', '#CC7D5E');
    // Interactive fills follow the same contrast-driven control tiers as the reference palette.
    root.style.setProperty('--fill-hover', fillHover);
    root.style.setProperty('--fill-active', alpha(isDark ? 0.16 : 0.12));
    // A stored preference stays inert where the shell has no window material to show through.
    const translucent = activeTranslucency(settings.appearance.translucentSidebar, isDark) && supportsSidebarTranslucency();
    root.dataset.pointerCursors = settings.appearance.usePointerCursors ? 'enabled' : 'disabled';
    root.dataset.translucentSidebar = translucent ? 'enabled' : 'disabled';
    root.dataset.reduceMotion = settings.appearance.reduceMotion ? 'true' : 'false';

    // The shell owns the native material; the renderer sends only the preference plus the opaque
    // fallback colour used when translucency is off or the platform has no backdrop support.
    void window.noaDesktop?.appearance?.setSidebarTranslucency?.(translucent, surfaces.primary, settings.appearance.theme)
      ?.catch(() => { /* desktop-only; ignore if the bridge is unavailable */ });
  }, [isDark, settings.appearance.theme, settings.appearance.contrast, settings.appearance.translucentSidebar, settings.appearance.usePointerCursors, settings.appearance.reduceMotion]);

  const variant = isDark ? 'dark' : 'light';
  const themeFonts = settings.appearance.fonts?.[variant];
  const uiFamily = themeFonts?.ui ?? SYSTEM_DEFAULT_FONT;
  const contentChoice = themeFonts?.content ?? CONTENT_SAME_AS_UI;
  const contentFamily = contentChoice === CONTENT_SAME_AS_UI ? uiFamily : contentChoice;
  const uiFace = themeFonts?.uiFace;
  const contentFace = contentChoice === CONTENT_SAME_AS_UI ? uiFace : themeFonts?.contentFace;
  const codeFamily = themeFonts?.code ?? SYSTEM_DEFAULT_FONT;
  const codeFace = themeFonts?.codeFace;

  // A selected face is declared through local() under its own family, so the exact face renders; the
  // family stack follows as the fallback, and the platform defaults have no face at all.
  const faceRules = [...new Map(
    [uiFace, contentFace, codeFace]
      .filter((face): face is ThemeFontFace => Boolean(face))
      .map((face) => [face.postscriptName, face]),
  ).values()].map(faceFontFaceRule).join('\n      ');
  const withFace = (face: ThemeFontFace | undefined, stack: string) =>
    face ? `${quoteFamily(faceFamilyName(face))}, ${stack}` : stack;
  const fontFamilyStyle = withFace(uiFace, resolveFontFamily(uiFamily));
  const contentFontFamilyStyle = withFace(contentFace, resolveFontFamily(contentFamily));
  const codeFontFamilyStyle = withFace(codeFace, resolveFontFamily(codeFamily, MONO_FONT_STACK));
  const uiFontSize = settings.appearance.uiFontSize;
  const textScale = uiFontSize / 14;

  // Second of two !important colour-remap layers (index.css holds the dark set). This sheet is later in
  // document order and wins any overlap; keep the two in sync.
  return (
    <style>{`
      ${faceRules}
      /* CSS variable-based overrides — work in both light and dark */
      .bg-\\[\\#EFEAE3\\]     { background-color: var(--bg-secondary) !important; }
      .bg-\\[\\#CC7D5E\\]     { background-color: var(--accent-color) !important; }
      .bg-\\[\\#EFEAE3\\]\\/30 { background-color: color-mix(in srgb, var(--bg-secondary) 30%, transparent) !important; }
      .bg-\\[\\#EFEAE3\\]\\/50 { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }
      .bg-\\[\\#CC7D5E\\]\\/10 { background-color: color-mix(in srgb, var(--accent-color) 10%, transparent) !important; }

      .text-\\[\\#2D2D2B\\]     { color: var(--text-primary) !important; }
      .text-\\[\\#CC7D5E\\]     { color: var(--accent-color) !important; }
      .text-\\[\\#2D2D2B\\]\\/50 { color: color-mix(in srgb, var(--text-primary) 50%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/60 { color: color-mix(in srgb, var(--text-primary) 60%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/70 { color: color-mix(in srgb, var(--text-primary) 70%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/30 { color: color-mix(in srgb, var(--text-primary) 30%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/35 { color: color-mix(in srgb, var(--text-primary) 35%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/40 { color: color-mix(in srgb, var(--text-primary) 40%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/75 { color: color-mix(in srgb, var(--text-primary) 75%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/80 { color: color-mix(in srgb, var(--text-primary) 80%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/85 { color: color-mix(in srgb, var(--text-primary) 85%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/90 { color: color-mix(in srgb, var(--text-primary) 90%, transparent) !important; }
      .hover\\:text-\\[\\#CC7D5E\\]:hover { color: var(--accent-color) !important; }
      .hover\\:text-\\[\\#2D2D2B\\]:hover { color: var(--text-primary) !important; }
      .group:hover .group-hover\\:text-\\[\\#CC7D5E\\] { color: var(--accent-color) !important; }

      .border-\\[\\#CC7D5E\\]      { border-color: var(--accent-color) !important; }
      .hover\\:border-\\[\\#CC7D5E\\]:hover  { border-color: var(--accent-color) !important; }
      .border-\\[\\#CC7D5E\\]\\/50 { border-color: color-mix(in srgb, var(--accent-color) 50%, transparent) !important; }
      .border-\\[\\#CC7D5E\\]\\/60 { border-color: color-mix(in srgb, var(--accent-color) 60%, transparent) !important; }

      .shadow-\\[4px_4px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 0 4px 12px 0 color-mix(in srgb, var(--control-shadow-ink) 28%, transparent) !important; }
      .shadow-\\[2px_2px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 0 2px 6px 0 color-mix(in srgb, var(--control-shadow-ink) 24%, transparent) !important; }
      .shadow-\\[inset_4px_0px_0px_0px_\\#CC7D5E\\]          { box-shadow: inset 4px 0px 0px 0px var(--accent-color) !important; }

      .selection\\:bg-\\[\\#CC7D5E\\] *::selection { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }
      .selection\\:bg-\\[\\#CC7D5E\\]::selection   { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }

      .prose-a\\:text-\\[\\#CC7D5E\\] a         { color: var(--accent-color) !important; }
      .prose-pre\\:text-\\[\\#2D2D2B\\] pre      { color: var(--text-primary) !important; }
      .prose-code\\:text-\\[\\#CC7D5E\\] code    { color: var(--accent-color) !important; }

      .font-ui { font-family: ${fontFamilyStyle} !important; }
      html {
        -webkit-font-smoothing: ${settings.appearance.fontSmoothing ? 'antialiased' : 'auto'};
        -moz-osx-font-smoothing: ${settings.appearance.fontSmoothing ? 'grayscale' : 'auto'};
      }
      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
        /* The selected face carries its own weight and slant; the body itself stays upright. */
        font-weight: 400;
        font-style: normal;
        /* Content bold sits a fixed step above the body so **strong** never flattens into the text around it. */
        --font-weight-content-bold: 600;
      }
      /* Code keeps its upright face; the UI font style is for prose and chrome. */
      code, pre, kbd, samp { font-style: normal; }
      /* Text tiers follow Codex Electron's 14px body / 13px small / 12px caption ramp. */
      :root {
        --font-ui-size: ${uiFontSize}px;
        --text-body: ${uiFontSize}px;
        --text-chat-sm: ${Math.round(13 * textScale)}px;
        --text-caption: ${Math.round(12 * textScale)}px;
        --text-micro: ${Math.round(11 * textScale)}px;
        --text-title: ${Math.round(26 * textScale)}px;
        --text-heading-sm: ${Math.round(18 * textScale)}px;
        --code-font-size: ${settings.appearance.codeFontSize}px;
        --font-mono: ${codeFontFamilyStyle};
        /* Conversation typeface: turn items read these so the composer and chrome stay on the UI font. */
        --font-content: ${contentFontFamilyStyle};
        --content-font-weight: 400;
        --content-font-style: normal;
      }
      code, pre { font-size: var(--code-font-size); }

      ${settings.appearance.usePointerCursors ? '' : `
      html[data-pointer-cursors="disabled"] button:not(:disabled),
      html[data-pointer-cursors="disabled"] a[href],
      html[data-pointer-cursors="disabled"] summary,
      html[data-pointer-cursors="disabled"] [role="button"],
      html[data-pointer-cursors="disabled"] [role="switch"],
      html[data-pointer-cursors="disabled"] input[type="button"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="submit"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="reset"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="checkbox"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="radio"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="color"]:not(:disabled),
      html[data-pointer-cursors="disabled"] .cursor-pointer:not(.cursor-default):not(.cursor-text):not(.cursor-not-allowed):not(.cursor-col-resize):not(.cursor-row-resize):not(.cursor-zoom-in):not(.cursor-zoom-out) {
        cursor: default !important;
      }
      `}
    `}</style>
  );
}
