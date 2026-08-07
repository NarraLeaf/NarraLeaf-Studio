import { App } from '@/app/app';

const app = App.create({});

// A rejected promise nobody handled is a bug worth recording, but it is not proof that the process
// is unusable - most of them are a single failed IPC call. Logged, not fatal.
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
    app.logger.error('Unhandled Promise Rejection:', reason);
});

/**
 * An uncaught exception in the main process leaves it running with corrupted state: whatever was
 * half-done stays half-done, and every later operation builds on it. Logging and carrying on is how
 * "one bad IPC handler" turns into "the project file it later wrote is wrong" - so this reports and
 * terminates instead.
 *
 * `crash()` logs (the file sink means the reason survives the exit), shows the user an error box
 * rather than a window that silently vanishes, and exits. The re-entrancy guard is because the
 * reporting path can itself throw: without it, a failure inside `crash()` re-enters here forever.
 */
let handlingFatalError = false;
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (handlingFatalError) {
        process.exit(1);
    }
    handlingFatalError = true;
    app.crash(error instanceof Error ? error : new Error(String(error)));
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
    // Quitting is the one exit that does not go through a window close guard, so it is the one exit
    // where the renderers' debounced auto-saves would otherwise be thrown away: by the time the
    // webContents are torn down there is no `app://fs` handler left for a PUT to land on.
    //
    // preventDefault() is what buys the time to write. It is only safe because every path out of
    // the block below calls quit() again - including the hard deadline, which exists so a renderer
    // that has stopped answering turns into "lost the last few seconds" rather than "Cmd+Q does
    // nothing".
    let quitFlush: 'idle' | 'running' | 'done' = 'idle';
    app.electronApp.on('before-quit', (event) => {
        app.logger.info('App is quitting...');
        if (quitFlush === 'done') {
            return;
        }
        // Hold the quit while the flush runs. A second quit request mid-flush (the last window
        // closing, another Cmd+Q) has to be held too, or it would cut the writes short.
        event.preventDefault();
        if (quitFlush === 'running') {
            return;
        }
        quitFlush = 'running';

        const HARD_DEADLINE_MS = 20 * 1000;
        const deadline = new Promise<void>(resolve => setTimeout(resolve, HARD_DEADLINE_MS));
        void Promise.race([app.flushAllWorkspacesPendingSaves(), deadline])
            .catch(error => {
                app.logger.warn('Failed to flush pending saves before quit:', error);
            })
            .finally(() => {
                quitFlush = 'done';
                app.quit();
            });
    });

    try {
        // Goes through ensureLauncher - the same call the workspace's close guard uses, so the
        // home screen is built one way only - and then opens whatever --project asked for.
        await app.openStartupWindow();
    } catch (error) {
        app.logger.error('Failed to launch application:', error);
        app.quit();
    }
}).catch((error) => {
    console.error('Failed to initialize app:', error);
    process.exit(1);
});
