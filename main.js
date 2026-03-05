import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
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

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "P2P Chat",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
        },
        autoHideMenuBar: true
    });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    } else {
        mainWindow.loadURL('http://localhost:5173');
    }

    mainWindow.webContents.setWindowOpenHandler(() => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.js'),
                    webSecurity: true,
                }
            }
        };
    });

    return mainWindow;
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
