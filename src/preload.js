const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings management
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  
  // File/folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: (options) => ipcRenderer.invoke('select-files', options),
  scanImageFiles: (folderPath) => ipcRenderer.invoke('scan-image-files', folderPath),
  
  // File system operations
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
  
  // Path operations
  path: {
    join: (...args) => ipcRenderer.invoke('path-join', ...args),
    dirname: (filePath) => ipcRenderer.invoke('path-dirname', filePath),
    basename: (filePath) => ipcRenderer.invoke('path-basename', filePath),
    extname: (filePath) => ipcRenderer.invoke('path-extname', filePath)
  },
  
  // License management
  validateLicense: (data) => ipcRenderer.invoke('validate-license', data),
  loadLicense: () => ipcRenderer.invoke('load-license'),
  openMainApp: () => ipcRenderer.invoke('open-main-app'),
  
  // App info
  getVersion: () => process.env.npm_package_version || '1.0.0',
  getPlatform: () => process.platform
});