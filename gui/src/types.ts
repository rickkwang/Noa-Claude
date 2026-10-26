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
  agent: {
    defaultPermissionMode: 'default' | 'acceptEdits' | 'plan';
    showFullAccess: boolean;
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
