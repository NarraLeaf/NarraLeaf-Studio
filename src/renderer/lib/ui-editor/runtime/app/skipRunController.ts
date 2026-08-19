/**
 * Skipping, as Studio drives it: the key held down, and the same run started from a graph.
 *
 * ## Why the host owns this loop
 *
 * The engine ships its own (`KeyEventAnnouncer`): on keydown it checks the `skip` preference once,
 * then broadcasts a skip every `skipInterval` ms until the key comes back up. That shape makes
 * "stop when you reach a line the player has not read" unreachable from outside it - the run is
 * paced by a timer the host cannot see, the preference is never consulted again, and a keydown that
 * arrives through OS auto-repeat is swallowed by the run's own "already pressed" guard. An author
 * trying to build this by hand out of `Is Text Read` and `Set Skip` hits exactly the same wall:
 * flipping the preference mid-hold changes nothing, because nothing reads it mid-hold.
 *
 * So the binding moves to Studio (see `createNlrGameWithGameUi`, which does for `skipAction` what it
 * already did for `nextAction`) and the loop is reimplemented here, with one addition: a guard
 * consulted before **every** step rather than once per press.
 *
 * ## The latch
 *
 * When the guard stops a run, the run stays stopped until the key is physically released. It is not
 * enough to skip the one step: the line the player has just been handed becomes "read" the moment it
 * finishes typing, a few hundred milliseconds later, and a guard that only gates each step would let
 * the still-held key resume the instant it does - skipping past the very text it stopped for. The
 * player releases the key, reads, and presses again.
 *
 * ## The mode
 *
 * A held key is not something a quick menu button or a touch screen has. So the run also has a
 * value behind it - the `skipping` preference - and setting it is exactly holding the key: same
 * gate, same delay, same interval, same guard. Letting go is the part with no keyboard equivalent,
 * so the controller does it: whenever a run it is driving ends for any reason other than a keyup -
 * the guard stopping it, the stage going away, the window losing focus - it reports that skipping
 * has ended and the host writes the value back to false. A button bound to the preference therefore
 * cannot end up lit over a game that stopped skipping several lines ago.
 *
 * **One run, whichever started it.** The key and the mode share the timers rather than each owning
 * a loop, because two loops on one story would skip two lines per interval and each would clear
 * the other's timers at unpredictable moments. Pressing the key while the mode runs joins the run;
 * releasing it leaves the mode running.
 *
 * Comments in English per project convention.
 */

export type SkipRunControllerOptions = {
    /** Whether a keyboard event's `key` is bound to skipping. */
    matchesSkipKey: (key: string) => boolean;
    /**
     * Whether skipping may run at all right now: the `skip` preference, plus whatever the host
     * means by "the story is on screen".
     *
     * Read before every step, not once per press. A run that started on the stage and carried on
     * behind a settings screen the player opened mid-skip is the reason: the story would advance
     * under a menu, and with the mode there is no key whose release would end it.
     */
    canSkip: () => boolean;
    /**
     * Whether the run must stop here. Read before every step, including the first.
     *
     * This is `skipReadText` && "a dialogue line is on screen the player has not read", and it is
     * deliberately *not* "the current text is read": no dialogue on screen at all (a transition, a
     * sound, an image action) is not unread text, and a skip that refused to cross those would
     * strand the player mid-scene with a key that does nothing.
     */
    isBlocked: () => boolean;
    /** Milliseconds the key is held before continuous skipping starts; 0 starts at once. */
    getSkipDelay: () => number;
    /** Milliseconds between steps once continuous skipping has started. */
    getSkipInterval: () => number;
    /** Advance the story one step. */
    skipOnce: () => void;
    /** Suppress the key while the player is typing into a field; defaults to never. */
    isTextEntryTarget?: (target: EventTarget | null) => boolean;
    /**
     * Skipping is no longer running, and the value that says it is has to follow.
     *
     * Called when the mode ends anywhere other than {@link SkipRunController.setSkipping} itself:
     * the guard stopping the run, a refused start (`skip` off, or no story on screen), and
     * {@link SkipRunController.stop}. The host's job is to write `false` back into the preference,
     * which arrives back here as a `setSkipping(false)` this controller then ignores as a no-op.
     */
    onSkippingEnded?: () => void;
};

export type SkipRunController = {
    handleKeyDown: (event: KeyboardEvent) => void;
    handleKeyUp: (event: KeyboardEvent) => void;
    /**
     * Turn skipping on or off, as the `skipping` preference moves.
     *
     * Idempotent, because the host drives it from that preference's change event and the
     * controller is itself what writes the preference back when a run ends.
     */
    setSkipping: (active: boolean) => void;
    /** Stop any run in flight; the key must be released and pressed again to start another. */
    stop: () => void;
    /** Whether a run is currently in flight. Exposed for tests. */
    isRunning: () => boolean;
    /** Whether the mode is on. Exposed for tests. */
    isSkipping: () => boolean;
};

/**
 * The lower bound on the step interval.
 *
 * `skipInterval` is authored and clamped to >= 1ms, but a one-millisecond `setInterval` is a busy
 * loop that starves the renderer it is asking to paint each skipped line. The engine has no such
 * floor because its interval came straight from the preference; here the preference stays the
 * author's number and this is what protects the frame.
 */
const MIN_SKIP_INTERVAL_MS = 8;

export function createSkipRunController(options: SkipRunControllerOptions): SkipRunController {
    const {
        matchesSkipKey,
        canSkip,
        isBlocked,
        getSkipDelay,
        getSkipInterval,
        skipOnce,
        isTextEntryTarget,
        onSkippingEnded,
    } = options;

    let held = false;
    let skipping = false;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    let stepTimer: ReturnType<typeof setInterval> | null = null;

    const clearTimers = () => {
        if (delayTimer !== null) {
            clearTimeout(delayTimer);
            delayTimer = null;
        }
        if (stepTimer !== null) {
            clearInterval(stepTimer);
            stepTimer = null;
        }
    };

    const isRunning = (): boolean => stepTimer !== null || delayTimer !== null;

    /**
     * Letting go of the mode, for the half of the run with no key to release.
     *
     * Idempotent: the host answers the report by writing the preference, which arrives back as
     * `setSkipping(false)`, and a second report from there would be a loop.
     */
    const endSkipping = () => {
        if (!skipping) {
            return;
        }
        skipping = false;
        onSkippingEnded?.();
    };

    /** One step, or the end of the run. Returns false when the run was stopped. */
    const step = (): boolean => {
        if (!canSkip() || isBlocked()) {
            clearTimers();
            endSkipping();
            return false;
        }
        skipOnce();
        return true;
    };

    const startContinuous = () => {
        delayTimer = null;
        const interval = Math.max(MIN_SKIP_INTERVAL_MS, getSkipInterval());
        stepTimer = setInterval(() => {
            step();
        }, interval);
    };

    /**
     * Start a run, or join the one already going. False means nothing is skipping, and nothing will
     * be until this is asked again.
     */
    const beginRun = (): boolean => {
        if (isRunning()) {
            return true;
        }
        clearTimers();
        // The first step is immediate, so a tap skips one line however long `skipDelay` is. It is
        // also where `canSkip` is asked, so a refused start and a run that ends the moment it meets
        // a closed gate are one code path.
        if (!step()) {
            return false;
        }
        const delay = getSkipDelay();
        if (delay <= 0) {
            startContinuous();
        } else {
            delayTimer = setTimeout(startContinuous, delay);
        }
        return true;
    };

    return {
        handleKeyDown: event => {
            if (!matchesSkipKey(event.key) || isTextEntryTarget?.(event.target)) {
                return;
            }
            // `held` rather than `event.repeat`: the latch above needs a run that the guard cut
            // short to stay cut short, and an OS auto-repeat keydown is indistinguishable from a
            // fresh press on some platforms. The flag is only cleared by a real keyup.
            if (held) {
                return;
            }
            held = true;
            beginRun();
        },

        handleKeyUp: event => {
            if (!matchesSkipKey(event.key)) {
                return;
            }
            held = false;
            // The mode outlives the key: a player who presses the key during a run started from a
            // graph has joined that run rather than taken it over.
            if (!skipping) {
                clearTimers();
            }
        },

        setSkipping: (active: boolean) => {
            if (active === skipping) {
                return;
            }
            if (!active) {
                skipping = false;
                if (!held) {
                    clearTimers();
                }
                return;
            }
            skipping = true;
            if (!beginRun()) {
                // Refused: `skip` is off, or there is no story on screen, or the guard stopped the
                // very first step. Skipping is not running, so the value saying it is goes back.
                endSkipping();
            }
        },

        stop: () => {
            held = false;
            clearTimers();
            endSkipping();
        },

        isRunning,
        isSkipping: () => skipping,
    };
}
