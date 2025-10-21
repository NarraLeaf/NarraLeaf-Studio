import { App } from '@/app/app';
import path from 'path';

const app = App.create({});

app.whenReady().then(async () => {
    app.logger.info('App is ready');

    const launcher = await app.launchLauncher({
        backgroundColor: '#0f1115',
    });

    launcher.onClose(() => {
        if (!app.windowManager.hasWindows()) {
            app.quit();
        }
    });
    launcher.onKeyUp("F12", () => {
        launcher.toggleDevTools();
    });
    launcher.onReady(() => {
        launcher.show();
    });
});
