import { app, BrowserWindow, ipcMain, desktopCapturer, shell, Tray, Menu, nativeImage, session, globalShortcut } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
// Set only by the tray "Quit" item and by app.before-quit, so the close button
// can hide to tray without the app becoming unquittable.
let isQuitting = false;
// Never hide the window when there is no tray to restore it from, or when the
// user has turned the behaviour off.
let trayAvailable = false;
let closeToTray = true;

const resolveAsset = (name) => {
    // Packaged builds keep build/ assets next to the asar via extraResources.
    const candidates = app.isPackaged
        ? [path.join(process.resourcesPath, 'build', name), path.join(__dirname, 'build', name)]
        : [path.join(__dirname, 'build', name)];
    return candidates[0];
};

// ---------------------------------------------------------------- screen share

ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : ''
    }));
});

// ---------------------------------------------------------------- external links

// Anchors inside chat messages are rendered into the page, so a plain click
// would try to navigate the SPA away. The renderer routes them here instead.
ipcMain.handle('open-external', async (_evt, url) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
});

// ---------------------------------------------------------------- link previews

const PREVIEW_TIMEOUT = 6000;
const PREVIEW_MAX_BYTES = 512 * 1024;
const previewCache = new Map();

const decodeEntities = (v) => String(v || '')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const metaContent = (html, patterns) => {
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1] && m[1].trim()) return decodeEntities(m[1].trim());
    }
    return '';
};

const ogTag = (prop) => [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
];

// Fetching happens in the main process because the renderer is blocked by CORS
// for arbitrary origins. Only metadata is returned, never the page body.
ipcMain.handle('fetch-link-preview', async (_evt, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    const cached = previewCache.get(url);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.data;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; P2PChat link preview)',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !/text\/html|application\/xhtml/i.test(type)) {
            previewCache.set(url, { at: Date.now(), data: null });
            return null;
        }

        // Read at most PREVIEW_MAX_BYTES; <head> is all we need.
        const reader = res.body?.getReader();
        let html = '';
        if (reader) {
            const decoder = new TextDecoder('utf-8');
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                html += decoder.decode(value, { stream: true });
                if (total >= PREVIEW_MAX_BYTES || /<\/head>/i.test(html)) {
                    try { await reader.cancel(); } catch { /* already closed */ }
                    break;
                }
            }
        } else {
            html = (await res.text()).slice(0, PREVIEW_MAX_BYTES);
        }

        const finalUrl = res.url || url;
        let image = metaContent(html, [...ogTag('og:image'), ...ogTag('twitter:image')]);
        if (image && !/^https?:\/\//i.test(image)) {
            try { image = new URL(image, finalUrl).href; } catch { image = ''; }
        }
        if (image && !/^https:\/\//i.test(image)) image = '';

        const data = {
            url: finalUrl,
            siteName: metaContent(html, ogTag('og:site_name')) || new URL(finalUrl).hostname.replace(/^www\./, ''),
            title: metaContent(html, [...ogTag('og:title'), ...ogTag('twitter:title'), /<title[^>]*>([^<]*)<\/title>/i]).slice(0, 200),
            description: metaContent(html, [...ogTag('og:description'), ...ogTag('twitter:description'), ...ogTag('description')]).slice(0, 400),
            image,
        };
        const result = data.title || data.description || data.image ? data : null;
        previewCache.set(url, { at: Date.now(), data: result });
        if (previewCache.size > 300) previewCache.clear();
        return result;
    } catch {
        previewCache.set(url, { at: Date.now(), data: null });
        return null;
    } finally {
        clearTimeout(timer);
    }
});

// ---------------------------------------------------------------- auto update

const sendToRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
};

let updaterWired = false;
const wireUpdater = () => {
    if (updaterWired) return;
    updaterWired = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        sendToRenderer('updater:status', { state: 'available', version: info?.version });
    });
    autoUpdater.on('update-not-available', () => {
        sendToRenderer('updater:status', { state: 'none' });
    });
    autoUpdater.on('download-progress', (p) => {
        sendToRenderer('updater:status', { state: 'downloading', percent: Math.round(p?.percent || 0) });
    });
    autoUpdater.on('update-downloaded', (info) => {
        sendToRenderer('updater:status', { state: 'ready', version: info?.version });
    });
    autoUpdater.on('error', (err) => {
        sendToRenderer('updater:status', { state: 'error', message: String(err?.message || err) });
    });
};

ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    wireUpdater();
    try {
        await autoUpdater.checkForUpdates();
        return { state: 'checking' };
    } catch (err) {
        return { state: 'error', message: String(err?.message || err) };
    }
});

ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) return false;
    wireUpdater();
    try { await autoUpdater.downloadUpdate(); return true; } catch { return false; }
});

ipcMain.handle('updater:install', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return true;
});

ipcMain.handle('app:version', () => app.getVersion());

// ---------------------------------------------------------------- tray & window

ipcMain.handle('window:minimize-to-tray', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return true;
});

ipcMain.handle('app:set-close-to-tray', (_evt, enabled) => {
    closeToTray = enabled !== false;
    return closeToTray;
});

// ---------------------------------------------------------------- global hotkeys

// The renderer stores bindings as layout-independent key codes ("Ctrl+Shift+KeyM").
// Electron accelerators want display names, so translate the final token.
const ARROWS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
const PUNCTUATION = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};

const toAccelerator = (bind) => {
    if (typeof bind !== 'string' || !bind) return null;
    const parts = bind.split('+');
    const key = parts.pop();
    const mods = parts.map(m => (m === 'Ctrl' ? 'CommandOrControl' : m === 'Meta' ? 'Super' : m));

    let token = null;
    if (/^Key[A-Z]$/.test(key)) token = key.slice(3);
    else if (/^Digit[0-9]$/.test(key)) token = key.slice(5);
    else if (/^Numpad[0-9]$/.test(key)) token = 'num' + key.slice(6);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) token = key;
    else if (key === 'Space') token = 'Space';
    else if (key === 'Escape') token = 'Esc';
    else if (key === 'Enter') token = 'Return';
    else if (key === 'Tab') token = 'Tab';
    else if (key === 'Backspace') token = 'Backspace';
    else if (key === 'Delete') token = 'Delete';
    else if (ARROWS[key]) token = ARROWS[key];
    else if (PUNCTUATION[key]) token = PUNCTUATION[key];
    if (!token) return null;

    // A bare letter would swallow that key system-wide, so require a modifier.
    if (mods.length === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) return null;
    return [...mods, token].join('+');
};

let registeredShortcuts = [];

const clearGlobalShortcuts = () => {
    registeredShortcuts.forEach(acc => {
        try { globalShortcut.unregister(acc); } catch { /* already gone */ }
    });
    registeredShortcuts = [];
};

// binds: { actionName: "Ctrl+Shift+KeyM" }. Returns the actions that could not
// be claimed, usually because another application already owns the combination.
ipcMain.handle('shortcuts:set-global', (_evt, binds) => {
    clearGlobalShortcuts();
    const failed = [];
    if (!binds || typeof binds !== 'object') return { failed };

    Object.entries(binds).forEach(([action, bind]) => {
        const accelerator = toAccelerator(bind);
        if (!accelerator) {
            if (bind) failed.push(action);
            return;
        }
        try {
            const ok = globalShortcut.register(accelerator, () => {
                sendToRenderer('shortcuts:fired', action);
            });
            if (ok) registeredShortcuts.push(accelerator);
            else failed.push(action);
        } catch {
            failed.push(action);
        }
    });
    return { failed };
});

app.on('will-quit', clearGlobalShortcuts);

// ---------------------------------------------------------------- window chrome

// The native title bar is hidden so the renderer can draw its own. These are the
// operations that bar needs.
ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return true;
});

ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
});

ipcMain.handle('window:is-maximized', () => !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()));

// Goes through the normal close path, so the close-to-tray preference still
// applies to the custom button.
ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
});

// Unread count drives the tray tooltip and the taskbar overlay.
ipcMain.handle('app:set-badge', (_evt, count) => {
    const n = Number(count) || 0;
    if (tray && !tray.isDestroyed()) {
        tray.setToolTip(n > 0 ? `P2P Chat — ${n} unread` : 'P2P Chat');
    }
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
        try {
            mainWindow.setOverlayIcon(n > 0 ? buildBadgeIcon(n) : null, n > 0 ? `${n} unread` : '');
        } catch { /* overlay unsupported */ }
    }
    if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge(n > 0 ? String(n) : '');
    }
    return true;
});

// nativeImage has no SVG rasteriser, so the overlay uses pre-rendered PNGs.
const badgeIconCache = new Map();
const buildBadgeIcon = (n) => {
    const name = n >= 10 ? 'badge-more.png' : `badge-${n}.png`;
    if (badgeIconCache.has(name)) return badgeIconCache.get(name);
    const img = nativeImage.createFromPath(resolveAsset(name));
    const result = img.isEmpty() ? null : img;
    badgeIconCache.set(name, result);
    return result;
};

const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
};

const createTray = () => {
    if (tray && !tray.isDestroyed()) return;
    try {
        let image = nativeImage.createFromPath(resolveAsset('tray.png'));
        if (image.isEmpty()) image = nativeImage.createFromPath(resolveAsset('icon.png'));
        if (image.isEmpty()) throw new Error('no tray image available');
        tray = new Tray(image);
        tray.setToolTip('P2P Chat');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Open P2P Chat', click: showWindow },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => { isQuitting = true; app.quit(); }
            },
        ]));
        tray.on('click', showWindow);
        tray.on('double-click', showWindow);
        trayAvailable = true;
    } catch (err) {
        console.warn('[Tray] Unavailable, close will quit instead:', err?.message || err);
        trayAvailable = false;
    }
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 940,
        minHeight: 560,
        title: 'P2P Chat',
        icon: resolveAsset('icon.png'),
        backgroundColor: '#1e1f22',
        show: false,
        // 'hidden' keeps native resizing, snapping and shadows while removing the
        // system title bar; macOS keeps its traffic lights via 'hiddenInset'.
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
        trafficLightPosition: { x: 12, y: 8 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
        },
        autoHideMenuBar: true
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Keep the custom maximize/restore glyph in sync with reality, including
    // changes made by keyboard shortcuts or Windows snap.
    const pushMaximizeState = () => sendToRenderer('window:maximize-change', mainWindow.isMaximized());
    mainWindow.on('maximize', pushMaximizeState);
    mainWindow.on('unmaximize', pushMaximizeState);

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    } else {
        mainWindow.loadURL('http://localhost:5173');
    }

    // SECURITY: never spawn an in-app window that would inherit our preload
    // (and the screen-capture bridge). Route external links to the OS browser
    // and deny everything else.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // SECURITY: block in-page navigation away from the app (e.g. a link that
    // replaces the SPA) — external links should open in the browser instead.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const isDevServer = url.startsWith('http://localhost:5173');
        const isLocalFile = url.startsWith('file://');
        if (!isDevServer && !isLocalFile) {
            event.preventDefault();
            if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        }
    });

    // Closing hides to tray instead of quitting, so calls and P2P connections
    // survive. Quit explicitly from the tray menu.
    mainWindow.on('close', (event) => {
        if (!isQuitting && trayAvailable && closeToTray) {
            event.preventDefault();
            mainWindow.hide();
            return;
        }
        isQuitting = true;
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    return mainWindow;
}

// Keeping a single instance means tray clicks and second launches focus the
// window we already have rather than starting a rival P2P identity.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', showWindow);

    app.whenReady().then(() => {
        // Screen, camera and microphone requests come from our own UI only.
        session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
            const allowed = ['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'];
            callback(allowed.includes(permission));
        });

        createWindow();
        createTray();

        if (app.isPackaged) {
            wireUpdater();
            // Give the renderer a moment to mount before any update banner.
            setTimeout(() => { autoUpdater.checkForUpdates().catch(() => { }); }, 8000);
        }

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
            else showWindow();
        });
    });
}

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', function () {
    // With a tray present the app intentionally outlives its window; without one
    // closing the last window quits as usual.
    if (process.platform === 'darwin') return;
    if (isQuitting || !trayAvailable || !closeToTray) app.quit();
});
