import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from '../lib/fontFamily'
import type { AppSettings, ThemeFonts } from '../types'

const defaultFonts = (): ThemeFonts => ({
  ui: SYSTEM_DEFAULT_FONT,
  content: CONTENT_SAME_AS_UI,
  code: SYSTEM_DEFAULT_FONT,
})

export const defaultSettings: AppSettings = {
  appearance: {
    theme: 'system',
    fonts: { light: defaultFonts(), dark: defaultFonts() },
    contrast: { light: 45, dark: 60 },
    maxWidth: 800,
    usePointerCursors: true,
    translucentSidebar: { light: false, dark: false },
    reduceMotion: false,
    uiFontSize: 14,
    codeFontSize: 12,
    fontSmoothing: true,
  },
  composer: { sendShortcut: 'enter', showContextUsage: true },
  agent: {
    permissionDefault: 'inherit',
  },
};
