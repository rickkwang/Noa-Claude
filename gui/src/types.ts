export interface AppSettings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    fontFamily: string;
    uiFontStyle: 'light' | 'light-italic' | 'regular' | 'regular-italic' | 'medium' | 'medium-italic' | 'semibold' | 'semibold-italic' | 'bold' | 'bold-italic';
    maxWidth: number;
    usePointerCursors: boolean;
    translucentSidebar: boolean;
    reduceMotion: boolean;
    uiFontSize: number;
    codeFontSize: number;
    codeFontFamily: string;
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
    };
  }
}
