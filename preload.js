const { contextBridge, ipcRenderer } = require('electron');

// Securely expose only specific IPC methods to the renderer. Everything here is
// a narrow, named operation — no generic `invoke` passthrough.
contextBridge.exposeInMainWorld('electronAPI', {
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

    // Chat messages render real anchors; clicking one must reach the OS browser
    // rather than navigating the single-page app away.
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Open Graph metadata for link preview cards. CORS makes this impossible
    // from the renderer, so the main process fetches and returns metadata only.
    fetchLinkPreview: (url) => ipcRenderer.invoke('fetch-link-preview', url),

    getAppVersion: () => ipcRenderer.invoke('app:version'),
    setBadgeCount: (count) => ipcRenderer.invoke('app:set-badge', count),
    minimizeToTray: () => ipcRenderer.invoke('window:minimize-to-tray'),
    setCloseToTray: (enabled) => ipcRenderer.invoke('app:set-close-to-tray', enabled),

    shortcuts: {
        setGlobal: (binds) => ipcRenderer.invoke('shortcuts:set-global', binds),
        onFired: (handler) => {
            if (typeof handler !== 'function') return () => { };
            const listener = (_evt, action) => handler(String(action));
            ipcRenderer.on('shortcuts:fired', listener);
            return () => ipcRenderer.removeListener('shortcuts:fired', listener);
        },
    },

    // Used by the custom title bar. Deliberately narrow: no arbitrary window API.
    platform: process.platform,
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
        isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
        close: () => ipcRenderer.invoke('window:close'),
        onMaximizeChange: (handler) => {
            if (typeof handler !== 'function') return () => { };
            const listener = (_evt, value) => handler(!!value);
            ipcRenderer.on('window:maximize-change', listener);
            return () => ipcRenderer.removeListener('window:maximize-change', listener);
        },
    },

    updater: {
        check: () => ipcRenderer.invoke('updater:check'),
        download: () => ipcRenderer.invoke('updater:download'),
        install: () => ipcRenderer.invoke('updater:install'),
        onStatus: (handler) => {
            if (typeof handler !== 'function') return () => { };
            const listener = (_evt, payload) => handler(payload);
            ipcRenderer.on('updater:status', listener);
            return () => ipcRenderer.removeListener('updater:status', listener);
        },
    },
});
