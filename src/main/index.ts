import { app as electronApp, dialog } from 'electron';
import { App } from '@/app/app';
import { decideWindowClosedTeardown } from '@/app/application/windowClosedTeardown';
import { getMainTranslator } from '@/app/application/i18n';
import { Logger } from '@shared/utils/logger';
import {
    createProcessRunEndHost,
    describeProfileInUse,
    endCommandLineRunOnFailure,
    installCommandLineRunEnd,
} from '@/app/application/commandLineRunEnd';

// Before anything that can fail. A `--build`, `--test` or `--lint` launch has nobody at the screen,
// and from here on every failure that would otherwise put something in front of a person - the
// error box Electron shows for a throw below, the crash prompt, a quit nobody asked for - ends the
// run with exit 4 and a report instead. Null for every other launch. See `commandLineRunEnd.ts`.
const commandLineRun = installCommandLineRunEnd(process.argv, createProcessRunEndHost(electronApp));
// And into the profile's log, as the run's own lines are. Log sinks are shared by every logger, so
// this reaches the file from the moment `BaseApp` opens it - including when `App.create` then fails
// a few statements later, which is exactly the log a person goes looking in.
const bootLogger = new Logger('MainProcess');
commandLineRun?.useLog(line => bootLogger.info(`[CommandLine] ${line}`));

/**
 * Build the app, or hand a failure to build it to the command-line run.
 *
 * `App.create` is where a profile Studio cannot use shows up - a `--*-user-data-dir` that cannot be
 * created, a settings file that will not parse - and it runs while this file is still loading. A
 * throw from here is answered by Electron with an error box and a process that never exits, which
 * is fair for somebody at the screen and a hung job for everybody else.
 */
function createApp(): App | null {
    try {
        return App.create({});
    } catch (error) {
        if (endCommandLineRunOnFailure(`Studio could not start: ${describeError(error)}`)) {
            return null;
        }
        throw error;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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

const app = createApp();
if (app) {
    start(app);
}

/** Everything this entry point does once there is an app to do it with. */
function start(app: App): void {
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
     * `crash()` logs (the file sink means the reason survives the exit), gives the open workspaces a
     * bounded chance to write out what they had not written yet, shows the user an error box rather
     * than a window that silently vanishes, and exits. The re-entrancy guard is `crash()`'s own: the
     * reporting path can itself throw, and the flush it now waits for means further failures arrive
     * while the first one is still being handled. Ending the process here on the second one would cut
     * that flush short, which is exactly the work it exists to save.
     *
     * A command-line run has nobody to show the error box to, so there `crash()` ends the run instead
     * - exit 4, the failure on its log and in its report. See `commandLineRunEnd.ts`.
     */
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        app.crash(error instanceof Error ? error : new Error(String(error)));
    });

    // The one teardown an exit that skips `before-quit` still reaches: a fatal error, a command-line
    // build carrying an exit code, anything else that calls exit() outright. Every project this Studio
    // took stays claimed until somebody works out that this process is gone, and while that recovers on
    // its own (the claim names a process id, and a dead one is taken over), leaving the file behind
    // turns the next ordinary open into a takeover that has to be explained. Synchronous because there
    // is no event loop left to await on.
    process.on('exit', () => {
        app.getProjectSessionLockManager().releaseAllSync();
    });

    // macOS hands a double-clicked document over here and nowhere else - the path never appears in
    // argv - and it does so BEFORE `ready`, which is why this is registered here rather than beside
    // the other listeners below. `openLaunchRequest` holds anything that arrives this
    // early until there is a window to put it in; see `App.openStartupWindow`.
    //
    // preventDefault() because the default is to do nothing useful and log that the app has no handler.
    app.electronApp.on('open-file', (event, filePath) => {
        event.preventDefault();
        void app.openLaunchPaths([filePath]).catch((error) => {
            app.logger.error('Failed to open the file macOS handed over:', error);
        });
    });

    // Another Studio already owns this profile. It has been told what this launch was for (see the
    // 'second-instance' handler below); this process has nothing left to do. exit() rather than
    // quit() so none of the shutdown work runs - the saves it would try to flush belong to the other
    // process, not to this one.
    if (!app.acquireSingleInstanceLock()) {
        // Except for a headless run. Handing over is right for a launch that wants a window - the
        // running Studio opens it - and wrong for one that wants an exit code: the job would run inside
        // somebody's session, against a project they have open, while this process reported success it
        // has no way to know about. So it refuses, with the family's report, and says which of the two
        // things happened.
        if (commandLineRun && endCommandLineRunOnFailure(describeProfileInUse(commandLineRun.identity.kind))) {
            return;
        }
        app.logger.info('Another instance is already running; handing over to it.');
        app.electronApp.exit(0);
        return;
    }

    app.whenReady().then(async () => {
        app.logger.info('App is ready');

        // A second launch (Start menu, a shortcut, a file association) reaches the running instance
        // here instead of starting a rival one. Studio may well have no window at all at this point,
        // which is exactly the case this exists for.
        //
        // **What the second launch was FOR travels with it.** A double-clicked project arrives as a
        // path in that process's argv, resolved against that process's working directory - both of
        // which Electron reports here and neither of which this process can work out for itself. Only
        // a launch that named nothing Studio can open falls back to the home screen; answering a
        // double-clicked project with the launcher would look exactly like the association being
        // broken.
        app.electronApp.on('second-instance', (_event, argv, workingDirectory) => {
            void app.openLaunchPaths(argv, workingDirectory)
                .then((opened) => {
                    if (!opened) {
                        return app.revealLauncher();
                    }
                })
                .catch((error) => {
                    app.logger.error('Failed to act on a second launch:', error);
                });
        });

        // macOS: the Dock icon was clicked, or Studio was reopened some other way. Only a reopen that
        // finds nothing to come back to is the same gesture as a tray click; what the rest do, and why,
        // is in `handleReopen`.
        app.electronApp.on('activate', (_event, hasVisibleWindows) => {
            app.handleReopen(hasVisibleWindows);
        });

        app.windowManager.events.on("window-closed", (window) => {
            const projectPath = window.getProps()?.projectPath;
            const named = typeof projectPath === "string" && projectPath.length > 0 ? projectPath : null;
            // Both rules, and the reasoning for each, live in `decideWindowClosedTeardown`.
            const teardown = decideWindowClosedTeardown({
                windowType: window.getWindowType(),
                projectPath: named,
                quitting: app.isQuitting(),
                projectStillOpen: named !== null && app.hasLiveWindowForProject(named),
            });

            if (named && teardown.stopRuntimes) {
                void app.stopProjectRuntimes(named).catch((error) => {
                    app.logger.warn("[Runtime] Failed to stop this project's runtimes on window close", error);
                });
            }
            if (named && teardown.releaseVersionControl) {
                void app.getVcsManager().closeProject(named).catch((error) => {
                    app.logger.warn("[Vcs] Failed to release session on window close", error);
                });
            }
            if (named && teardown.releaseSessionLock) {
                void app.getProjectSessionLockManager().release(named).catch((error) => {
                    app.logger.warn("[Project] Failed to release the session lock on window close", error);
                });
            }
            // A launch that went straight into a project keeps the home screen hidden behind it, and
            // relies on the workspace reporting how its load went to decide what happens to it. A
            // workspace that goes away without ever answering - a renderer that crashed on load, a
            // window closed by its own error handling - would leave that hidden launcher as the only
            // window there is, which on screen is indistinguishable from Studio having died on launch.
            app.revealLauncherIfNothingElseIsUp();

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
            // A command-line run ends by `exit()` with the code it decided, which never comes through
            // here. Anything that asks to quit in the middle of one - the status-bar item's Quit, a
            // last window closing with no status-bar item to stay resident in, a startup that gave
            // up - would otherwise run the ordinary quit, and an ordinary quit exits 0: a run that
            // never answered would report success. So the quit is held and the run is ended instead.
            if (endCommandLineRunOnFailure('Studio was asked to quit before the run reported a result.')) {
                event.preventDefault();
                return;
            }
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

            // Saves first, then the runtimes, then the stores - and none of the three allowed to skip
            // another: a failed flush is still a quit that has to close what it started, and a failed
            // stop is still a quit.
            //
            // The runtimes are here rather than left to the windows closing because a preview and a
            // test run are separate *processes*. Windows' job object happens to reap them with their
            // parent; macOS and Linux reparent them, so quitting Studio left a game running with
            // nothing left to stop it from.
            //
            // The list itself lives on App, because a command-line build has to run the same three on
            // its way out and cannot come through here: carrying an exit code means `exit()`, which
            // never fires `before-quit`.
            // Bounded inside `drainForShutdown`, which is also where the warning about a version-control
            // call that outlived the deadline is written - a quit and a command-line build's exit want
            // the same bound, and duplicating it here is how one of them would eventually lose it.
            void app.drainForShutdown()
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
            // A command-line run that threw on its way to its answer has not answered, and quitting
            // would say it had - see the `before-quit` handler above.
            if (endCommandLineRunOnFailure(`Studio could not start the run: ${describeError(error)}`)) {
                return;
            }
            app.quit();
        }
    }).catch((error) => {
        console.error('Failed to initialize app:', error);
        // Not exit 1 for a command-line run, which a job reads as "the check failed".
        if (endCommandLineRunOnFailure(`Studio could not start: ${describeError(error)}`)) {
            return;
        }
        process.exit(1);
    });
}
