/**
 * The order in which one workspace window gives its place on screen to another.
 *
 * "Open in this window" is a request for one window to become another project, and the way it used
 * to run was the opposite of that on screen: the replacement appeared over the window it was
 * replacing, and a second or two later - once its project had answered - the one underneath closed.
 * Two windows, then one, for a gesture that was about there only ever being one.
 *
 * So the replacement is built hidden, and this is what happens next: it loads out of sight while the
 * window the author is still sitting in says what it is waiting for, and only when the project has
 * answered does that window go through its close in full and the replacement take the frame it
 * left. From the screen: one window, which closes, and the project it was traded for comes up where
 * it was.
 *
 * The order also decides what a project that does not open costs. Nothing has been closed by the
 * time the answer arrives, so a folder that turns out not to be a project loses nobody their
 * workspace - the error screen simply comes up beside it, out from under which it would be
 * indistinguishable from the window it failed to replace.
 *
 * Sequencing only. Every window operation is the host's, which is what lets this be read - and
 * tested - as the order of events it is.
 */

/** Where a window is, exactly enough for another window to take its place. */
export interface WorkspaceFrame {
    bounds: { x: number; y: number; width: number; height: number };
    maximized: boolean;
    fullScreen: boolean;
}

export interface WorkspaceHandOverHost {
    opener: {
        /** Put the "switching project" scrim away; the window is staying after all. */
        clearSwitchingStage(): void;
        /** Where the window is right now, for the replacement to take over. */
        captureFrame(): WorkspaceFrame;
        /** Flush, checkpoint, close. Resolves once it is done, whether or not it succeeded. */
        retire(): Promise<void>;
    };
    replacement: {
        isClosed(): boolean;
        /** The window's project settled: `true` if it opened, `false` for the error screen. */
        onLoadResult(fn: (ok: boolean) => void): void;
        /** The window went away before any of this could happen. */
        onClose(fn: () => void): void;
        /** Take the frame the retired window was occupying - bounds or maximised, not full screen. */
        adoptFrame(frame: WorkspaceFrame): void;
        /** Move out from exactly on top of the window that is now staying. */
        stepAside(): void;
        show(): void;
        /** Full screen, once the window is up: there is nothing to animate from while it is not. */
        enterFullScreen(): void;
    };
    /** How long to wait for a project that never answers at all. */
    timeoutMs: number;
    /** Said once, if the wait ran out; the window is still shown either way. */
    onTimeout(): void;
}

export function handOverWorkspace(host: WorkspaceHandOverHost): void {
    const { opener, replacement } = host;
    let settled = false;

    const settle = (run: () => void): void => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timeout);
        run();
    };

    const show = (): void => {
        if (replacement.isClosed()) {
            return;
        }
        replacement.show();
    };

    // A renderer that died before its preflight settled, or hung in it, would otherwise leave the
    // author under a scrim with nothing on the way. Both windows on screen is not the switch they
    // asked for, but it is two windows and a way out rather than one nobody can touch.
    const timeout = setTimeout(() => settle(() => {
        host.onTimeout();
        opener.clearSwitchingStage();
        show();
    }), host.timeoutMs);

    replacement.onClose(() => settle(() => {
        opener.clearSwitchingStage();
    }));

    replacement.onLoadResult(ok => settle(() => {
        if (!ok) {
            opener.clearSwitchingStage();
            replacement.stepAside();
            show();
            return;
        }

        // Read now rather than when the replacement was launched: the author has had the whole load
        // to move, maximise or full-screen the window they are sitting in, and what the replacement
        // takes over is the frame as it is at the moment it changes hands.
        const frame = opener.captureFrame();

        // Whatever the close made of itself, the replacement is what the author asked for and it is
        // still hidden: a retirement that threw must not be the reason they end up with no window.
        void opener.retire().catch(() => void 0).then(() => {
            if (replacement.isClosed()) {
                return;
            }
            replacement.adoptFrame(frame);
            replacement.show();
            if (frame.fullScreen) {
                replacement.enterFullScreen();
            }
        });
    }));
}
