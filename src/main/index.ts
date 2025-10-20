import { App } from '@/app/app';

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
    }, {});
    launcher.win.setTitle('Launcher - NarraLeaf Studio');

    launcher.onClose(() => {
        app.quit();
    });
    launcher.onKeyUp("F12", () => {
        launcher.toggleDevTools();
    });
});
