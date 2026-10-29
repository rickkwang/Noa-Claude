// Single source for the app's surface colours. ThemeInjector publishes these as
// CSS variables; code that needs a literal (Electron window colour, inline SVG)
// reads them here.
export const THEME_SURFACES = {
  light: {
    primary: '#F9F9F7',
    // Neutral floor; was a beige that tinted the settings hairlines mixed from it.
    secondary: '#F9F9F7',
    // Absolutely (light) sidebar.
    sidebar: '#F4F4F2',
    sidebarMaterial: '#FAFAF8',
    // Row highlight; moves with the floor so it stays distinct from it.
    sidebarRaised: '#ECEBE8',
    // Right-column cards and the graph canvas.
    card: '#FFFFFF',
  },
  dark: {
    // Absolutely (dark) background.
    primary: '#2D2D2B',
    secondary: '#1E1E1C',
    // Dark sidebar; solid, not translucent.
    sidebar: '#30302F',
    // Translucent-sidebar tint over the native `menu` material.
    sidebarMaterial: '#343432',
    sidebarRaised: 'rgba(249,249,247,0.08)',
    // One step above primary, as primary is one above secondary (30 → 38 → 46): the dark ramp lightens
    // evenly with elevation, and stays well clear of near-black.
    card: '#2E2E2C',
  },
} as const;

export type ThemeSurfaces = (typeof THEME_SURFACES)[keyof typeof THEME_SURFACES];

export const themeSurfaces = (isDark: boolean): ThemeSurfaces =>
  isDark ? THEME_SURFACES.dark : THEME_SURFACES.light;
