import { SYSTEM_DEFAULT_FONT, DEFAULT_UI_FONT_STYLE } from '../lib/fontFamily'
import type { AppSettings } from '../types'

export const defaultSettings: AppSettings = {
  appearance: {
    theme: 'system',
    fontFamily: SYSTEM_DEFAULT_FONT,
    uiFontStyle: DEFAULT_UI_FONT_STYLE,
    maxWidth: 800,
    usePointerCursors: true,
    translucentSidebar: false,
    reduceMotion: false,
    uiFontSize: 13,
    codeFontSize: 12,
    codeFontFamily: SYSTEM_DEFAULT_FONT,
    fontSmoothing: true,
  },
  agent: {
    defaultPermissionMode: 'default',
  },
};
