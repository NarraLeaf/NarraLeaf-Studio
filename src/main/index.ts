import { App } from '@/app/app';
import path from 'path';

const app = App.create({});

app.whenReady().then(async () => {
    app.logger.info('App is ready');

    const launcher = await app.launchLauncher({
        minWidth: 800,
        minHeight: 500,
        width: 800,
        height: 500,
        frame: false,
        minimizable: true,
        maximizable: false,
        closable: true,
        titleBarStyle: 'hidden',
        backgroundColor: '#0f1115',
        show: false,
        icon: app.resolveResource("app-icon.ico"),
    }, {});
    launcher.win.setTitle('Launcher - NarraLeaf Studio');

    launcher.onClose(() => {
        app.quit();
    });
    launcher.onKeyUp("F12", () => {
        launcher.toggleDevTools();
    });
    launcher.onReady(() => {
        launcher.show();
    });
});
