import { SYSTEM_DEFAULT_FONT, DEFAULT_UI_FONT_STYLE } from '../lib/fontFamily'
import type { AppSettings } from '../types'

export const defaultSettings: AppSettings = {
  editor: {
    fontSize: 16,
    lineHeight: 1.5,
  },
  appearance: {
    theme: 'system',
    fontFamily: SYSTEM_DEFAULT_FONT,
    uiFontStyle: DEFAULT_UI_FONT_STYLE,
    maxWidth: 768,
    usePointerCursors: true,
    translucentSidebar: false,
    reduceMotion: false,
    uiFontSize: 13,
    codeFontSize: 12,
    fontSmoothing: true,
    emptyStateScene: 'island',
  },
  dailyNotes: {
    template: '',
    dateFormat: 'YYYY-MM-DD',
  },
  search: {
    caseSensitive: false,
    fuzzySearch: true,
  },
  corePlugins: {
    dailyNotes: true,
  },
  templates: {
    userTemplates: [],
  },
  backup: {
    autoBackupEnabled: false,
  },
  agent: {
    defaultPermissionMode: 'default',
  },
};
