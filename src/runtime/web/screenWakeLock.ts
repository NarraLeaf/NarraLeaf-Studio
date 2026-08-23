/**
 * Hold the screen awake while the exported game is the page being looked at.
 *
 * The desktop shell takes a display block for the same reason (see `main/displaySleep.ts`):
 * reading is idle as far as the system is concerned, and auto mode plays for as long as the script
 * runs without a single input, so the screen blanks mid-scene. Canvas, DOM animation and Web Audio
 * reset no idle timer; only a playing `<video>` does.
 *
 * A browser lends the lock rather than granting it: it is dropped the moment the tab stops being
 * visible and has to be asked for again when it comes back, which is what this keeps track of.
 *
 * A separate module rather than a few lines inside `web.ts`, which installs itself on `window` at
 * import and so cannot be brought into a test.
 *
 * Comments in English per project convention.
 */

/** The part of a `WakeLockSentinel` this needs; the browser's carries more. */
export interface ScreenWakeLockSentinel {
    release(): Promise<void>;
}

export interface ScreenWakeLockHost {
    /**
     * `navigator.wakeLock.request("screen")`, or null in a browser that has no Screen Wake Lock.
     * Nothing is reported for its absence: the game plays either way, and a player's console is
     * not the place to say that their browser is older than the feature.
     */
    request: (() => Promise<ScreenWakeLockSentinel>) | null;
    /** Whether the document is on screen. A hidden page may not hold the lock. */
    isVisible(): boolean;
    onVisibilityChange(listener: () => void): void;
    warn(message: string): void;
}

export function installScreenWakeLock(host: ScreenWakeLockHost): void {
    const request = host.request;
    if (!request) {
        return;
    }
    /** The lock currently held, or null when the screen is free to sleep. */
    let held: ScreenWakeLockSentinel | null = null;
    /** True while a request is in flight, so a burst of visibility changes asks once. */
    let asking = false;
    /**
     * Set once a request has been refused. Browsers refuse this for reasons that do not change
     * within a session - an insecure origin, a policy, a battery saver - and retrying on every
     * visibility change would fill the console of a game that is running perfectly well.
     */
    let refused = false;

    const acquire = async (): Promise<void> => {
        if (held || asking || refused || !host.isVisible()) {
            return;
        }
        asking = true;
        try {
            const sentinel = await request();
            // The tab can go away while the request is in flight; the lock granted to a page
            // nobody is looking at is exactly the one this must not keep.
            if (host.isVisible()) {
                held = sentinel;
            } else {
                void sentinel.release().catch(() => undefined);
            }
        } catch (error) {
            refused = true;
            host.warn(`[GameRuntime] The screen cannot be kept awake in this browser: ${describe(error)}`);
        } finally {
            asking = false;
        }
    };

    host.onVisibilityChange(() => {
        if (host.isVisible()) {
            void acquire();
            return;
        }
        const sentinel = held;
        held = null;
        // The browser drops the lock on its own when the page is hidden; releasing it here as well
        // is what keeps this from believing it still holds one it does not.
        void sentinel?.release().catch(() => undefined);
    });
    void acquire();
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.message || String(error)) : String(error);
}
