const { contextBridge, ipcRenderer, webUtils } = require('electron')

ipcRenderer.on('noa:preview-shortcut', (_event, input) => window.dispatchEvent(new KeyboardEvent('keydown', input)))

contextBridge.exposeInMainWorld('noaDesktop', {
  selectProjectDirectories: () => ipcRenderer.invoke('noa:select-project-directories'),
  selectProjectDirectory: () => ipcRenderer.invoke('noa:select-project-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  preview: {
    command: (message) => ipcRenderer.invoke('noa:preview', message),
    subscribe: (listener) => {
      const receive = (_event, state) => listener(state)
      ipcRenderer.on('noa:preview-state', receive)
      return () => ipcRenderer.removeListener('noa:preview-state', receive)
    },
  },
  appearance: {
    // Keep in step with applySidebarTranslucency() in main.cjs.
    supportsSidebarTranslucency: process.platform === 'darwin',
    setSidebarTranslucency: (enabled, surfaceColor, theme) =>
      ipcRenderer.invoke('noa:set-sidebar-translucency', enabled, surfaceColor, theme),
  },
  notifications: {
    configure: (settings) => ipcRenderer.invoke('noa:configure-notifications', settings),
  },
})
