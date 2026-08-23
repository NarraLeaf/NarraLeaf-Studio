import type { RuntimeLogSink } from "./runtimeLog";

/**
 * One copy of a shipped game at a time.
 *
 * Two processes of the same game share one player directory, and everything a playthrough is worth
 * lives in it: saves, persistent variables, which lines have been read, which endings and gallery
 * entries are unlocked, hours played. Each process keeps its own in-memory copy of those stores and
 * writes the whole file back, atomically - so no single file is ever left corrupt, and the last
 * process to write simply erases what the other one did. A player who double-clicks the shortcut
 * twice, or launches from a storefront while the game is already up, loses the hours banked in
 * whichever copy they close first, with nothing on screen to say so.
 *
 * The lock Electron takes lives in the app's user-data directory, which this build has already
 * pointed at the game's own; two different games therefore never block each other, while two copies
 * of one game always do.
 *
 * The copy that loses raises the window of the copy that won, rather than exiting silently: the
 * player asked for this game and should get it in front of them, which is also the answer to
 * "nothing happened when I ran it".
 */

/** The window the running copy raises. Structural so a harness can stand in for one. */
export interface SingleInstanceWindow {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isVisible(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
}

export interface SingleInstanceHost {
    /** `app.requestSingleInstanceLock()`. */
    requestLock(): boolean;
    /** `app.quit()`. */
    quit(): void;
    /** `app.on("second-instance", …)`, called on the copy that holds the lock. */
    onSecondInstance(listener: () => void): void;
    /** The game's window, or null before it has been built and after it has gone. */
    window(): SingleInstanceWindow | null;
    log: RuntimeLogSink;
}

/**
 * Take the lock, or stand down.
 *
 * @returns whether this process is the copy that should go on running.
 */
export function claimSingleInstance(host: SingleInstanceHost): boolean {
    if (!host.requestLock()) {
        // Written to the log for the player who reports that launching the game does nothing: the
        // window they already have is the answer, and this is where it says so.
        host.log("info", "Another copy of this game is already running; raising its window.");
        host.quit();
        return false;
    }
    host.onSecondInstance(() => {
        const win = host.window();
        if (!win || win.isDestroyed()) {
            // A launch that lands between the window closing and the process finishing its quit.
            // There is nothing to raise, and the copy that just stood down has already gone.
            return;
        }
        // Minimised and hidden are different states with different answers, and a window can be
        // neither - one behind other windows only needs the focus.
        if (win.isMinimized()) {
            win.restore();
        }
        if (!win.isVisible()) {
            win.show();
        }
        win.focus();
    });
    return true;
}
