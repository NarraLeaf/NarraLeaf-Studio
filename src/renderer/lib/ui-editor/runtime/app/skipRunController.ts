/**
 * Holding the skip key, as Studio drives it.
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
 * Comments in English per project convention.
 */

export type SkipRunControllerOptions = {
  /** Whether a keyboard event's `key` is bound to skipping. */
  matchesSkipKey: (key: string) => boolean;
  /**
   * Whether skipping may run at all right now: the `skip` preference, plus whatever the host
   * means by "the story is on screen". Read per press, like the engine's own gate.
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
};

export type SkipRunController = {
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  /** Stop any run in flight; the key must be released and pressed again to start another. */
  stop: () => void;
  /** Whether a run is currently in flight. Exposed for tests. */
  isRunning: () => boolean;
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
    isTextEntryTarget
  } = options;

  let held = false;
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

  /** One step, or the end of the run. Returns false when the run was stopped. */
  const step = (): boolean => {
    if (isBlocked()) {
      clearTimers();
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

  return {
    handleKeyDown: (event) => {
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
      if (!canSkip()) {
        return;
      }
      clearTimers();
      // The first step is immediate, so a tap skips one line however long `skipDelay` is.
      if (!step()) {
        return;
      }
      const delay = getSkipDelay();
      if (delay <= 0) {
        startContinuous();
      } else {
        delayTimer = setTimeout(startContinuous, delay);
      }
    },

    handleKeyUp: (event) => {
      if (!matchesSkipKey(event.key)) {
        return;
      }
      held = false;
      clearTimers();
    },

    stop: () => {
      held = false;
      clearTimers();
    },

    isRunning: () => stepTimer !== null || delayTimer !== null
  };
}
