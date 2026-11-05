/** One selectable face of a locally installed family, as stored in the theme. */
export interface ThemeFontFace {
  family: string;
  fullName: string;
  postscriptName: string;
  /** The face's own style name ("Regular", "Thin"); absent in values saved before it was recorded. */
  style?: string;
}

/** Font choices, shared by the light and dark themes. */
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
    fonts: ThemeFonts;
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
    sendShortcut: 'enter' | 'modifier-enter' | 'modifier-enter-multiline';
    /** Whether a follow-up sent during a running turn queues behind it or steers into it. */
    followUpMode: 'queue' | 'steer';
    /** Shows Full access in the composer's permission menu. Off by default. */
    showFullAccess: boolean;
    showContextUsage: boolean;
  };
  terminal: {
    /** Where the terminal shortcut opens a terminal: the bottom panel or a right-panel tab. */
    defaultLocation: 'bottom' | 'right';
    /** An installed font for terminals (e.g. a Nerd Font for prompt icons); empty uses the code font. */
    fontFamily: string;
  };
  agent: {
    // 'inherit' starts sessions in the mode from Noa's settings.json instead of overriding it.
    permissionDefault: 'inherit' | 'default' | 'acceptEdits' | 'plan' | 'auto';
  };
  notifications: {
    /** Finished turns: never, only while the window is not focused, or always. */
    turnMode: 'off' | 'unfocused' | 'always';
    /** macOS system sound name, 'default', 'classic' (plays the default), or 'none' (silent). */
    sound: string;
    permissions: boolean;
    /** Covers both questions Noa asks and input an MCP server requests. */
    questions: boolean;
    /** Badge on the Dock icon while a notification is waiting and the window is not focused. */
    dot: boolean;
  };
}

declare global {
  interface Window {
    noaDesktop?: {
      selectProjectDirectories?: () => Promise<string[]>;
      selectProjectDirectory?: () => Promise<string | undefined>;
      getPathForFile?: (file: File) => string;
      preview?: {
        command: (message: { action: string; id: string; cwd?: string; url?: string; rect?: { x: number; y: number; width: number; height: number } | null; viewport?: number[] }) => Promise<{ error?: string } | undefined>;
        subscribe: (listener: (state: { id: string; url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean; error?: string }) => void) => () => void;
      };
      appearance?: {
        supportsSidebarTranslucency?: boolean;
        setSidebarTranslucency?: (enabled: boolean, surfaceColor: string, theme: string) => Promise<void>;
      };
      notifications?: {
        configure: (settings: AppSettings['notifications']) => Promise<void>;
      };
    };
  }
}
