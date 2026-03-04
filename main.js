import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    return sources.map(source => ({
        id: source.id,
        name: source.name
    }));
});

function createWindow(windowIndex = 0) {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: windowIndex === 0 ? "P2P Chat" : `P2P Chat (Test User ${windowIndex + 1})`,
        
        x: windowIndex === 0 ? undefined : 100 + windowIndex * 50,
        y: windowIndex === 0 ? undefined : 100 + windowIndex * 50,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true
    });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    } else {
        mainWindow.loadURL('http://localhost:5173');
    }

    if (windowIndex > 0) {
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.executeJavaScript(`
                // Create a fresh test identity for Window ${windowIndex + 1}
                const testName = 'TestUser${windowIndex + 1}';
                const testId = testName.toLowerCase() + '-' + Math.random().toString(36).substring(2, 6);
                localStorage.setItem('p2p_chat_identity', JSON.stringify({ name: testName, id: testId }));
                // Reload to pick up the new identity
                location.reload();
            `);
        });
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            }
        };
    });

    return mainWindow;
}

app.whenReady().then(() => {
    const mainWin = createWindow(0);

    globalShortcut.register('CommandOrControl+Shift+D', () => {
        console.log('[Test] Opening second test window...');
        createWindow(1);
    });

    if (process.argv.includes('--dual')) {
        
        setTimeout(() => {
            createWindow(1);
        }, 2000);
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(0);
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
