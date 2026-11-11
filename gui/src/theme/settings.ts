import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from '../lib/fontFamily'
import type { AppSettings, ThemeFonts } from '../types'
import { defaultShortcuts } from '../lib/shortcuts'

const defaultFonts = (): ThemeFonts => ({
  ui: SYSTEM_DEFAULT_FONT,
  content: CONTENT_SAME_AS_UI,
  code: SYSTEM_DEFAULT_FONT,
})

export const defaultSettings: AppSettings = {
  appearance: {
    theme: 'system',
    fonts: defaultFonts(),
    contrast: { light: 45, dark: 60 },
    maxWidth: 800,
    usePointerCursors: true,
    translucentSidebar: { light: false, dark: false },
    motion: 'system',
    uiFontSize: 14,
    transcriptTextSize: 'medium',
    codeFontSize: 12,
    fontSmoothing: true,
  },
  composer: { sendShortcut: 'enter', followUpMode: 'queue', showFullAccess: false, showContextUsage: true },
  terminal: { defaultLocation: 'bottom', fontFamily: '' },
  shortcuts: defaultShortcuts,
  agent: {
    permissionDefault: 'inherit',
    outputStyle: 'inherit',
  },
  notifications: { turnMode: 'unfocused', sound: 'default', permissions: true, questions: true, dot: true },
};
