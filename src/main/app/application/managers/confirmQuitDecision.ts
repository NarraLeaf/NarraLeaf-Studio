/**
 * What a single key event means to the ⌘Q-twice gesture.
 *
 * Split out from {@link confirmQuit.ts} and deliberately free of imports - the `Electron` namespace
 * is ambient, so nothing here pulls in `electron` at runtime and this file can be unit-tested. The
 * decision is the part worth pinning down: it is a table with a dozen entries, most of them about
 * keystrokes that must *not* count as either press, and none of them observable without a real
 * keyboard.
 */
export type QuitDecision =
  /** Take the keystroke; this is the first ⌘Q, so start waiting for the second. */
  | "prime"
  /** Take the keystroke; the second ⌘Q has arrived in time. Quit. */
  | "quit"
  /** Take the keystroke and change nothing (an auto-repeat of a press already counted). */
  | "swallow"
  /** Forget the first press, if one is waiting. */
  | "cancel"
  /** Not ours; leave it to the page and to the menu. */
  | "ignore";

export interface QuitState {
  /** Whether the preference asks for the second press at all (`app.confirmQuit`, macOS only). */
  enabled: boolean;
  /** Whether a first ⌘Q is still waiting for its second. */
  pending: boolean;
}

/**
 * Keys that are part of the gesture rather than a departure from it.
 *
 * ⌘ arrives as its own key-down before Q does, and it usually arrives twice: most people let the
 * whole chord up between the two presses. Treating that as "the author started doing something
 * else" would make the second press impossible.
 */
const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control", "CapsLock"]);

type KeyEvent = Pick<
  Electron.Input,
  "type" | "key" | "meta" | "control" | "alt" | "shift" | "isAutoRepeat"
>;

/**
 * ⌘Q exactly, with no other modifier.
 *
 * ⇧⌘Q is the system's log-out shortcut and ⌥⌘Q logs out without asking; neither belongs to Studio,
 * and swallowing either would break a gesture the author aimed at the operating system.
 */
function isQuitChord(input: KeyEvent): boolean {
  return (
    input.meta && !input.control && !input.alt && !input.shift && input.key.toLowerCase() === "q"
  );
}

export function decideQuitAction(input: KeyEvent, state: QuitState): QuitDecision {
  // Nothing about this gesture is measured against a release, which is what makes it work on
  // macOS at all: the system withholds key-up for ordinary keys while Command is held, so a
  // rule that waited for one would be waiting on an event that never comes.
  if (input.type === "keyUp") {
    return "ignore";
  }

  if (isQuitChord(input)) {
    if (!state.enabled) {
      return "ignore";
    }
    // Holding ⌘Q down is one press, however many events the keyboard sends. Counting the
    // repeats would turn a leaned-on key into the two presses this exists to require.
    if (input.isAutoRepeat) {
      return "swallow";
    }
    return state.pending ? "quit" : "prime";
  }

  // Anything else typed between the two presses means the author has gone back to work, and a
  // ⌘Q arriving later is a first press again rather than a second.
  if (state.pending && !MODIFIER_KEYS.has(input.key)) {
    return "cancel";
  }
  return "ignore";
}
