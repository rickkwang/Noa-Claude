/** One selectable face of a locally installed family, as stored in the theme. */
export interface ThemeFontFace {
  family: string;
  fullName: string;
  postscriptName: string;
  /** The face's own style name ("Regular", "Thin"); absent in values saved before it was recorded. */
  style?: string;
}

/** Font choices for one theme variant; the reference theme editor stores these per theme. */
export interface ThemeFonts {
  /** Family name, or SYSTEM_DEFAULT_FONT for the platform UI face. */
  ui: string;
  uiFace?: ThemeFontFace;
  /** Family name, SYSTEM_DEFAULT_FONT, or CONTENT_SAME_AS_UI to follow the UI pair. */
  content: string;
  contentFace?: ThemeFontFace;
  /** Family name, or SYSTEM_DEFAULT_FONT for the platform monospace face. */
  code: string;
  codeFace?: ThemeFontFace;
}

export interface AppSettings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    fonts: { light: ThemeFonts; dark: ThemeFonts };
    /** 0–100 per variant: the light and dark palettes have different resting points. */
    contrast: { light: number; dark: number };
    maxWidth: number;
    usePointerCursors: boolean;
    /** Native window material behind the sidebar; per variant, like the other theme colours. */
    translucentSidebar: { light: boolean; dark: boolean };
    reduceMotion: boolean;
    uiFontSize: number;
    codeFontSize: number;
    fontSmoothing: boolean;
  };
  composer: {
    sendShortcut: 'enter' | 'modifier-enter';
    showContextUsage: boolean;
  };
  agent: {
    // 'inherit' starts sessions in the mode from Noa's settings.json instead of overriding it.
    permissionDefault: 'inherit' | 'default' | 'acceptEdits' | 'plan' | 'auto';
  };
}

declare global {
  interface Window {
    noaDesktop?: {
      selectProjectDirectories?: () => Promise<string[]>;
      selectProjectDirectory?: () => Promise<string | undefined>;
      getPathForFile?: (file: File) => string;
      appearance?: {
        supportsSidebarTranslucency?: boolean;
        setSidebarTranslucency?: (enabled: boolean, surfaceColor: string, theme: string) => Promise<void>;
      };
    };
  }
}
