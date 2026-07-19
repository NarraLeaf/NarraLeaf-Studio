import { App } from '@/app/app';

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

    app.windowManager.events.on("window-closed", (window) => {
        // Lore takes an EXCLUSIVE repository lock for as long as a store handle is
        // open, and a second process blocks (does not fail) trying to acquire it.
        // Holding it past the project's lifetime would leave the `lore` CLI and any
        // other tool hanging on a project the user already closed.
        const projectPath = window.getProps()?.projectPath;
        if (typeof projectPath === "string" && projectPath.length > 0) {
            void app.getVcsManager().closeProject(projectPath).catch((error) => {
                app.logger.warn("[Vcs] Failed to release session on window close", error);
            });
        }
        if (!app.windowManager.hasWindows()) {
            app.quit();
        }
    });
    app.electronApp.on('before-quit', () => {
        app.logger.info('App is quitting...');
    });

    try {
        // Same call the workspace's close guard uses, so the home screen is built one way only.
        await app.ensureLauncher();
    } catch (error) {
        app.logger.error('Failed to launch application:', error);
        app.quit();
    }
}).catch((error) => {
    console.error('Failed to initialize app:', error);
    process.exit(1);
});
