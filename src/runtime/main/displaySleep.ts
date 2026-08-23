import type { BrowserWindow } from "electron";
import type { RuntimeLogSink } from "./runtimeLog";

/**
 * Hold the display awake while the game is on screen.
 *
 * A visual novel is minutes of reading between two clicks, and in auto mode it can be an hour with
 * no input at all. The system counts that as an idle machine and blanks the screen mid-scene: DOM
 * animation and Web Audio carry no idle reset of their own, unlike a `<video>` element, so nothing
 * the renderer draws keeps the display on. Nothing in the game can compensate either - the host API
 * has no reach into the platform's power state - which is why the shell holds the block itself
 * rather than offering it as a switch.
 *
 * The block follows the window rather than the process: it is taken when the window is on screen
 * and dropped as soon as it is minimised or hidden, so a game left running behind other windows
 * stops keeping the machine's display alive.
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

export function installDisplaySleepInhibitor(win: BrowserWindow, host: DisplaySleepHost): void {
    /** The block currently held, or null when the display is free to sleep. */
    let held: number | null = null;
    /**
     * Set once the platform has refused to take a block. Some desktop environments have no service
     * behind this call, and there the refusal is permanent - retrying it on every window event
     * would write the same line into the game's log for as long as the game runs.
     */
    let unavailable = false;

    const onScreen = (): boolean => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

    const sync = (): void => {
        if (onScreen()) {
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
    // The window is built hidden and shown on first paint, so the events above carry every change
    // that follows; this settles whatever state it is already in when it is wired up.
    sync();
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.message || String(error)) : String(error);
}
