import type { BrowserWindow } from "electron";
import type { RuntimeLogSink } from "./runtimeLog";

/**
 * Hold the display awake while the story is advancing on its own.
 *
 * Auto mode plays for an hour without a single input, and the system counts that as an idle
 * machine and blanks the screen mid-scene: DOM animation and Web Audio reset no idle timer, unlike
 * a playing `<video>`, so nothing the renderer draws keeps the display on. Nothing in the game can
 * compensate either - the host API has no reach into the platform's power state - which is why the
 * shell holds the block on the renderer's behalf.
 *
 * The renderer decides when, through {@link DisplaySleepInhibitor.setRequested}; the window decides
 * whether it counts. A block is taken only while the window is on screen, and dropped as soon as it
 * is minimised or hidden, so a game left playing behind other windows stops keeping the machine's
 * display alive. The request is dropped whenever the page starts loading: a reloaded window (the
 * crash recovery path) comes back with auto mode off, and a request left standing from the page
 * that died would never be withdrawn.
 *
 * Its own module, with the platform call passed in, so the sequence - which events take and drop a
 * block, and that a second one is never stacked - can be pinned without an Electron process.
 */
export interface DisplaySleepHost {
    /** Take one display-sleep block, returning the id that identifies it to {@link release}. */
    hold(): number;
    /** Drop the block {@link hold} returned. */
    release(id: number): void;
    log: RuntimeLogSink;
}

/** The renderer's half of the decision. */
export interface DisplaySleepInhibitor {
    /** Whether the game is advancing on its own and wants the display kept awake. */
    setRequested(requested: boolean): void;
}

export function installDisplaySleepInhibitor(win: BrowserWindow, host: DisplaySleepHost): DisplaySleepInhibitor {
    /** The block currently held, or null when the display is free to sleep. */
    let held: number | null = null;
    /** What the renderer last asked for. */
    let requested = false;
    /**
     * Set once the platform has refused to take a block. Some desktop environments have no service
     * behind this call, and there the refusal is permanent - retrying it on every window event
     * would write the same line into the game's log for as long as the game runs.
     */
    let unavailable = false;

    const onScreen = (): boolean => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

    const sync = (): void => {
        if (requested && onScreen()) {
            if (held !== null || unavailable) {
                return;
            }
            try {
                held = host.hold();
            } catch (error) {
                unavailable = true;
                host.log("warning", `[Power] The display cannot be kept awake on this system: ${describe(error)}`);
            }
            return;
        }
        if (held === null) {
            return;
        }
        const id = held;
        held = null;
        try {
            host.release(id);
        } catch (error) {
            host.log("warning", `[Power] Could not release the display block: ${describe(error)}`);
        }
    };

    win.on("show", sync);
    win.on("hide", sync);
    win.on("minimize", sync);
    win.on("restore", sync);
    win.on("closed", sync);
    win.webContents.on("did-start-loading", () => {
        requested = false;
        sync();
    });

    return {
        setRequested: next => {
            requested = next === true;
            sync();
        },
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.message || String(error)) : String(error);
}
