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

    try {
        const launcher = await app.launchLauncher({
            backgroundColor: '#0f1115',
        });

        launcher.onClose(() => {
            // In development mode, don't quit when window closes unless it's the last window
            // This prevents the app from quitting during hot reloads
            if (!app.isDevMode() && !app.windowManager.hasWindows()) {
                app.quit();
            }
        });
        launcher.onKeyUp("F12", () => {
            launcher.toggleDevTools();
        });
        launcher.onReady(() => {
            launcher.show();
        });

        // Handle app before quit to ensure clean shutdown
        app.electronApp.on('before-quit', (event) => {
            app.logger.info('App is quitting...');
        });
    } catch (error) {
        app.logger.error('Failed to launch application:', error);
        app.quit();
    }
}).catch((error) => {
    console.error('Failed to initialize app:', error);
    process.exit(1);
});
