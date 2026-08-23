/**
 * Hold the screen awake while the exported game advances on its own.
 *
 * The desktop shell takes a display block for the same reason (see `main/displaySleep.ts`): auto
 * mode plays for an hour without a single input, and neither the animation nor the audio a page
 * draws resets the system's idle timer - only a playing `<video>` does - so the screen blanks
 * mid-scene.
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

/** The game's half of the decision. */
export interface ScreenWakeLockKeeper {
    /** Whether the game is advancing on its own and wants the screen kept awake. */
    setRequested(requested: boolean): void;
}

export function installScreenWakeLock(host: ScreenWakeLockHost): ScreenWakeLockKeeper {
    const request = host.request;
    if (!request) {
        return { setRequested: () => undefined };
    }
    /** The lock currently held, or null when the screen is free to sleep. */
    let held: ScreenWakeLockSentinel | null = null;
    /** True while a request is in flight, so a burst of changes asks once. */
    let asking = false;
    /** What the game last asked for. */
    let requested = false;
    /**
     * Set once a request has been refused. Browsers refuse this for reasons that do not change
     * within a session - an insecure origin, a policy, a battery saver - and retrying on every
     * visibility change would fill the console of a game that is running perfectly well.
     */
    let refused = false;

    const wanted = (): boolean => requested && host.isVisible();

    const drop = (): void => {
        const sentinel = held;
        held = null;
        // The browser drops the lock on its own when the page is hidden; releasing it here as well
        // is what keeps this from believing it still holds one it does not.
        void sentinel?.release().catch(() => undefined);
    };

    const sync = async (): Promise<void> => {
        if (!wanted()) {
            drop();
            return;
        }
        if (held || asking || refused) {
            return;
        }
        asking = true;
        try {
            const sentinel = await request();
            // The tab can go away, or the story stop moving, while the request is in flight; the
            // lock granted for a moment that has passed is exactly the one this must not keep.
            if (wanted()) {
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
        void sync();
    });

    return {
        setRequested: next => {
            requested = next === true;
            void sync();
        },
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.message || String(error)) : String(error);
}
