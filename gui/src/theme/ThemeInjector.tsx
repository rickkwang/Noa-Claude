import { useLayoutEffect } from 'react';
import { useIsDark } from '../hooks/useIsDark';
import { UI_FONT_STYLES, resolveFontFamily } from '../lib/fontFamily';
import { themeSurfaces } from '../lib/themePalette';
import type { AppSettings } from '../types';

interface ThemeInjectorProps {
  settings: AppSettings;
}

export default function ThemeInjector({ settings }: ThemeInjectorProps) {
  const isDark = useIsDark(settings.appearance.theme);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const surfaces = themeSurfaces(isDark);
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
    root.style.setProperty('--bg-sidebar', surfaces.sidebar);
    root.style.setProperty('--sidebar-material-color', surfaces.sidebarMaterial);
    root.style.setProperty('--bg-sidebar-raised', surfaces.sidebarRaised);
    root.style.setProperty('--bg-card', surfaces.card);

    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--sidebar-material-tint', '70%');
      // Four stacked layers approximate light falloff; a single shadow reads as a band with a visible edge on dark.
      root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(0,0,0,0.07), 3px 0 6px -2px rgba(0,0,0,0.09), 10px 0 22px -6px rgba(0,0,0,0.11), 26px 0 54px -16px rgba(0,0,0,0.12)');
      // Dark text tiers are solid steps of one warm ramp, primary held off pure white (#F0EFEC).
      root.style.setProperty('--text-primary', '#F0EFEC');
      root.style.setProperty('--text-secondary', '#9C9B96');
      // Solid sidebar text tiers (primary is --text-primary): alpha text over the translucent material washes out.
      root.style.setProperty('--sidebar-text', '#C3C2B7');
      root.style.setProperty('--sidebar-text-muted', '#898781');
      // Resting icon ink: the secondary text tier, one step below primary (as Claude's desktop icons).
      root.style.setProperty('--icon-ink', '#C3C2B7');
      root.style.setProperty('--divider-subtle', 'color-mix(in srgb, var(--text-primary) 8%, transparent)');
      root.style.setProperty('--border-default', 'var(--divider-subtle)');
      root.style.setProperty('--border-strong', 'color-mix(in srgb, var(--text-primary) 16%, transparent)');
      root.style.setProperty('--border-primary', 'var(--divider-subtle)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
      root.style.setProperty('--control-shadow-ink', '#000000');
    } else {
      root.removeAttribute('data-theme');
      root.style.setProperty('--sidebar-material-tint', '70%');
      // Light counterpart of the dark stack, at lower weight since light floors don't band.
      root.style.setProperty('--sidebar-preview-shadow', '0 0 0 1px rgba(45,45,43,0.03), 3px 0 6px -2px rgba(45,45,43,0.035), 10px 0 22px -6px rgba(45,45,43,0.04), 26px 0 54px -16px rgba(45,45,43,0.05)');
      root.style.setProperty('--text-primary', '#2D2D2B');
      // Solid, as in dark.
      root.style.setProperty('--text-secondary', '#7B7974');
      root.style.setProperty('--sidebar-text', '#52514E');
      root.style.setProperty('--sidebar-text-muted', '#898781');
      root.style.setProperty('--icon-ink', '#52514E');
      // Hairlines: near-black at 10%, strong at 20%.
      root.style.setProperty('--divider-subtle', 'rgba(11,11,11,0.10)');
      root.style.setProperty('--border-default', 'var(--divider-subtle)');
      root.style.setProperty('--border-strong', 'rgba(11,11,11,0.20)');
      root.style.setProperty('--border-primary', 'var(--border-default)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
      root.style.setProperty('--control-shadow-ink', '#E6E2DA');
    }

    // Accent is a fixed theme token (coral in both themes), not user-configurable.
    root.style.setProperty('--accent-color', '#CC7D5E');
    root.dataset.pointerCursors = settings.appearance.usePointerCursors ? 'enabled' : 'disabled';
    root.dataset.translucentSidebar = settings.appearance.translucentSidebar ? 'enabled' : 'disabled';
    root.dataset.reduceMotion = settings.appearance.reduceMotion ? 'true' : 'false';

    // Main owns the exact alpha and vibrancy values; the renderer sends only
    // the preference plus the opaque theme fallback used when translucency is
    // disabled or the platform does not support native sidebar material.
    // Desktop-only bridge: the Electron shell does not expose it yet, so this is a no-op here.
    void (window as unknown as { noaDesktop?: { appearance?: { setSidebarTranslucency?: (...a: unknown[]) => Promise<unknown> } } }).noaDesktop?.appearance?.setSidebarTranslucency?.(
      settings.appearance.translucentSidebar,
      surfaces.primary,
      settings.appearance.theme,
    )
      ?.catch(() => { /* desktop-only; ignore if the bridge is unavailable */ });
  }, [isDark, settings.appearance.theme, settings.appearance.translucentSidebar, settings.appearance.usePointerCursors, settings.appearance.reduceMotion]);

  const fontFamilyStyle = resolveFontFamily(settings.appearance.fontFamily);
  const uiFont = UI_FONT_STYLES[settings.appearance.uiFontStyle];

  // Second of two !important colour-remap layers (index.css holds the dark set). This sheet is later in
  // document order and wins any overlap; keep the two in sync.
  return (
    <style>{`
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
      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
        font-weight: ${uiFont.weight};
        -webkit-font-smoothing: ${settings.appearance.fontSmoothing ? 'antialiased' : 'auto'};
        font-style: ${uiFont.italic ? 'italic' : 'normal'};
        /* Content bold sits a fixed step above the body, as Obsidian's --bold-modifier does, so a Semibold or Bold
           body doesn't leave **strong** level with (or lighter than) the text around it. */
        --font-weight-content-bold: ${Math.min(uiFont.weight + 200, 900)};
      }
      /* Code keeps its upright face; the UI font style is for prose and chrome. */
      code, pre, kbd, samp { font-style: normal; }
      /* Text tiers scale together from the 13px body baseline so caption and micro stay one step below body. */
      :root {
        --text-body: ${settings.appearance.uiFontSize}px;
        --code-font-size: ${settings.appearance.codeFontSize}px;
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
