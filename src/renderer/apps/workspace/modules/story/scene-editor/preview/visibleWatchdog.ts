/**
 * A deadline that only runs while the window is on screen.
 *
 * The story preview gives a rebuild a few seconds to pose its stage and calls it failed after that,
 * because a stage that never poses means a compile or mount defect. But posing waits on painted
 * frames, and a window that is minimised - or covered, once Chromium notices - paints none and runs
 * its timers at most once a second. An author who edits a row and switches to a browser has done
 * nothing wrong, yet a plain timeout would expire behind their back and leave the preview saying it
 * failed until the next edit.
 *
 * So the time counts only while the page is visible: going hidden stops the clock, and coming back
 * starts a whole new window, because the work it is waiting for only resumes then. A deadline that
 * comes due while the page is hidden (its timer fired before the visibility change was delivered) is
 * treated the same way.
 *
 * Comments in English per project convention.
 */

/** The part of `document` this reads; a test passes its own. */
export type VisibilitySource = {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
};

/**
 * Call `onExpire` once the page has been visible for `ms` without the returned cancel being called.
 * Returns the cancel; calling it after expiry is harmless.
 */
export function startVisibleWatchdog(
    onExpire: () => void,
    ms: number,
    source: VisibilitySource = document,
): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const isHidden = () => source.visibilityState === "hidden";

    const arm = () => {
        timer = setTimeout(() => {
            timer = null;
            if (done) {
                return;
            }
            if (isHidden()) {
                // Due while nobody could see the stage: wait for the window to come back.
                return;
            }
            stop();
            onExpire();
        }, ms);
    };

    const onVisibilityChange = () => {
        if (done) {
            return;
        }
        if (isHidden()) {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            return;
        }
        if (timer === null) {
            arm();
        }
    };

    const stop = () => {
        done = true;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        source.removeEventListener("visibilitychange", onVisibilityChange);
    };

    source.addEventListener("visibilitychange", onVisibilityChange);
    if (!isHidden()) {
        arm();
    }
    return stop;
}
