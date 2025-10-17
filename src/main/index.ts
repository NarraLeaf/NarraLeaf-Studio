import { app, BrowserWindow } from 'electron';
import path from 'path';

// This will print "NarraLeaf-Studio\build\win-unpacked\resources\app.asar" in production
// and "NarraLeaf-Studio\dist\main" in development
// The asar archive includes package.json and "dist" directory
console.log(`appDir: ${app.getAppPath()}`);
console.log(`__dirname: ${__dirname}`);

app.whenReady().then(() => {
    console.log('App is ready');
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(app.getAppPath(), '../windows/launcher/index.js'),
        },
        title: 'NarraLeaf-Studio',
    });
    mainWindow.loadFile(path.join(app.getAppPath(), '../windows/launcher/index.html'));

    mainWindow.webContents.openDevTools();
    mainWindow.on('closed', () => {
        app.quit();
    });
});
