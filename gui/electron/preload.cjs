const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('noaDesktop', {
  selectProjectDirectories: () => ipcRenderer.invoke('noa:select-project-directories'),
  selectProjectDirectory: () => ipcRenderer.invoke('noa:select-project-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  appearance: {
    // Keep in step with applySidebarTranslucency() in main.cjs.
    supportsSidebarTranslucency: process.platform === 'darwin',
    setSidebarTranslucency: (enabled, surfaceColor, theme) =>
      ipcRenderer.invoke('noa:set-sidebar-translucency', enabled, surfaceColor, theme),
  },
})
