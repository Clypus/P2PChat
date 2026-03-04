const { contextBridge, ipcRenderer } = require('electron');

// Securely expose only specific IPC methods to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
});
