import { dialog } from 'electron';
import { App } from '@/app/app';
import { getMainTranslator } from '@/app/application/i18n';

const app = App.create({});

/**
 * Whether the quit may proceed while an installer is downloading.
 *
 * True whenever nothing is downloading, so the common path costs one boolean. When something is,
 * the user gets the last word - and "Keep Downloading" is the default button, because that is the
 * answer that loses nothing.
 *
 * A failure to show the dialog must not become a quit that cannot be cancelled *or* an app that
 * cannot be quit; it resolves to "go ahead", which is what the user asked for in the first place.
 */
function confirmQuitDuringUpdate(instance: App): boolean {
    if (!instance.getUpdateManager().isDownloading()) {
        return true;
    }
    try {
        const { t } = getMainTranslator(instance);
        const choice = dialog.showMessageBoxSync({
            type: 'question',
            title: t('update.quitPrompt.title'),
            message: t('update.quitPrompt.message'),
            detail: t('update.quitPrompt.detail'),
            buttons: [t('update.quitPrompt.keepDownloading'), t('update.quitPrompt.quitAnyway')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
        return choice === 1;
    } catch (error) {
        instance.logger.warn('Failed to ask about quitting mid-update:', error);
        return true;
    }
}

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

// Another Studio already owns this profile. It has been told to show itself (see the
// 'second-instance' handler below); this process has nothing left to do. exit() rather than
// quit() so none of the shutdown work runs - the saves it would try to flush belong to the other
// process, not to this one.
if (!app.acquireSingleInstanceLock()) {
    app.logger.info('Another instance is already running; handing over to it.');
    app.electronApp.exit(0);
}

app.whenReady().then(async () => {
    app.logger.info('App is ready');

    // A second launch (Start menu, a shortcut, a file association) reaches the running instance
    // here instead of starting a rival one. Studio may well have no window at all at this point,
    // which is exactly the case this exists for.
    app.electronApp.on('second-instance', () => {
        void app.revealLauncher();
    });

    // macOS: clicking the Dock icon of an app with no windows. The Dock is what stands in for the
    // status-bar item there, so this is the same gesture as a tray click.
    app.electronApp.on('activate', () => {
        void app.revealLauncher();
    });

    app.windowManager.events.on("window-closed", (window) => {
        // Lore takes an EXCLUSIVE repository lock for as long as a store handle is
        // open, and a second process blocks (does not fail) trying to acquire it.
        // Holding it past the project's lifetime would leave the `lore` CLI and any
        // other tool hanging on a project the user already closed.
        //
        // Not while quitting, though. Windows close as part of the quit, AFTER the drain below
        // has already released every session - so this would find nothing to do in the good case,
        // and in the bad one (a session reopened in between) it would start Lore calls that
        // nothing waits for, moments before Node destroys the environment they must report back
        // into. That is not a leak, it is an abort: see VcsShuttingDownError.
        const projectPath = window.getProps()?.projectPath;
        if (typeof projectPath === "string" && projectPath.length > 0 && !app.isQuitting()) {
            void app.getVcsManager().closeProject(projectPath).catch((error) => {
                app.logger.warn("[Vcs] Failed to release session on window close", error);
            });
        }
        if (!app.windowManager.hasWindows()) {
            app.handleLastWindowClosed();
        }
    });
    // Quitting is the one exit that does not go through a window close guard, so it is the one exit
    // where the renderers' debounced auto-saves would otherwise be thrown away: by the time the
    // webContents are torn down there is no `app://fs` handler left for a PUT to land on.
    //
    // It is also the one exit that has to put version control down deliberately. Every Lore call
    // is a koffi `async` call whose result is delivered by calling back into JS; one still in
    // flight when Node destroys the main process's environment aborts the process
    // (`napi_fatal_error`), which is how a clean-looking quit produced a macOS crash report.
    // Draining the sessions here is what makes the callback land while there is still somewhere
    // for it to land.
    //
    // preventDefault() is what buys the time to do both. It is only safe because every path out of
    // the block below calls quit() again - including the hard deadline, which exists so a renderer
    // that has stopped answering turns into "lost the last few seconds" rather than "Cmd+Q does
    // nothing".
    let quitFlush: 'idle' | 'running' | 'done' = 'idle';
    app.electronApp.on('before-quit', (event) => {
        app.logger.info('App is quitting...');
        if (quitFlush === 'done') {
            return;
        }

        // An update coming down is the one thing worth interrupting a quit for: it is the reason
        // Studio stays resident with no windows at all, and abandoning it throws away however
        // many hundred megabytes have already arrived.
        //
        // A native message box, not an in-app one: there may be no window left to draw in, which
        // is precisely the state a background download runs in. Synchronous, because `before-quit`
        // cannot be awaited - by the time an async answer came back the quit would be over.
        if (!confirmQuitDuringUpdate(app)) {
            event.preventDefault();
            // BaseApp's own before-quit listener has already run and set `quitting`. Left set, it
            // would keep every window close guard standing aside for the rest of the session.
            app.cancelQuit();
            app.logger.info('Quit cancelled: an update is still downloading.');
            return;
        }

        // Hold the quit while the flush runs. A second quit request mid-flush (the last window
        // closing, another Cmd+Q) has to be held too, or it would cut the writes short.
        event.preventDefault();
        if (quitFlush === 'running') {
            return;
        }
        quitFlush = 'running';

        // Saves first, sessions second, and neither allowed to skip the other: a failed flush is
        // still a quit that has to close its stores, and a failed close is still a quit.
        const teardown = (async () => {
            await app.flushAllWorkspacesPendingSaves().catch(error => {
                app.logger.warn('Failed to flush pending saves before quit:', error);
            });
            await app.getVcsManager().dispose().catch(error => {
                app.logger.warn('Failed to close version control before quit:', error);
            });
        })();

        const HARD_DEADLINE_MS = 20 * 1000;
        const deadline = new Promise<void>(resolve => setTimeout(resolve, HARD_DEADLINE_MS));
        void Promise.race([teardown, deadline])
            .finally(() => {
                // The deadline is a bounded quit, not a safe one: expiring here means quitting
                // with Lore work still running, which is exactly the abort the drain exists to
                // avoid. Nothing better is available - the alternative is a Cmd+Q that hangs on a
                // network fetch - but it must not go unrecorded, because the crash report it
                // produces names koffi and says nothing about why the call was still open.
                if (app.getVcsManager().busy) {
                    app.logger.warn(
                        `Quitting with version control still busy after ${HARD_DEADLINE_MS}ms;`
                        + ' a call that outlives this may take the process down on the way out.',
                    );
                }
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
