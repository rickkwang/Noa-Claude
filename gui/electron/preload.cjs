const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('noaDesktop', {
  selectProjectDirectories: () => ipcRenderer.invoke('noa:select-project-directories'),
  selectProjectDirectory: () => ipcRenderer.invoke('noa:select-project-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
})
