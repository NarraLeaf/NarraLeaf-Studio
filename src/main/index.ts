import { BrowserWindow } from 'electron';
import path from 'path';
import { App } from '@/app/app';
import { AppWindow } from './app/application/managers/window/appWindow';

const app = App.create({});

// This will print "NarraLeaf-Studio\build\win-unpacked\resources\app.asar" in production
// and "NarraLeaf-Studio\dist\main" in development
// The asar archive includes package.json and "dist" directory
console.log(`appDir: ${app.getAppPath()}`);
console.log(`__dirname: ${__dirname}`);

app.whenReady().then(() => {
    console.log('App is ready');

    const mainWindow = new AppWindow(app, {
        options: {
            width: 800,
            height: 600,
            title: 'NarraLeaf-Studio',
        }
    }, {
        preload: app.getPreloadScript(),
    });
    mainWindow.loadFile(path.join(app.getDistDir(), 'windows', 'launcher', 'index.html'));

    mainWindow.toggleDevTools();
    mainWindow.onClose(() => {
        app.quit();
    });
});
