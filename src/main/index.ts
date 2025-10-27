import { App } from '@/app/app';
import path from 'path';

const app = App.create({});

// Global error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
    app.logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    app.logger.error('Uncaught Exception:', error);
});

app.whenReady().then(async () => {
    app.logger.info('App is ready');

    app.windowManager.events.on("window-closed", () => {
        if (!app.windowManager.hasWindows()) {
            app.quit();
        }
    });
    app.electronApp.on('before-quit', () => {
        app.logger.info('App is quitting...');
    });

    try {
        const launcher = await app.launchLauncher({
            backgroundColor: '#0f1115',
        });

        launcher.onKeyUp("F12", () => {
            launcher.toggleDevTools();
        });
    } catch (error) {
        app.logger.error('Failed to launch application:', error);
        app.quit();
    }
}).catch((error) => {
    console.error('Failed to initialize app:', error);
    process.exit(1);
});
