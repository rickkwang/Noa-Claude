// Single source for the app's surface colours. ThemeInjector publishes these as
// CSS variables; code that needs a literal (Electron window colour, inline SVG)
// reads them here.
export const THEME_SURFACES = {
  light: {
    // Codex's Absolutely Light derives these from #F9F9F7 surface + #2D2D2B ink.
    primary: '#F9F9F7',
    secondary: '#F2F2F0',
    sidebarMaterial: '#FAFAF8',
    card: '#FAFAF9',
  },
  dark: {
    // Codex's Absolutely Dark derives these from #2D2D2B surface + #F9F9F7 ink.
    primary: '#2D2D2B',
    secondary: '#262624',
    sidebarMaterial: '#3B3B39',
    card: '#474745',
  },
} as const;

export type ThemeSurfaces = (typeof THEME_SURFACES)[keyof typeof THEME_SURFACES];

export const themeSurfaces = (isDark: boolean): ThemeSurfaces =>
  isDark ? THEME_SURFACES.dark : THEME_SURFACES.light;
