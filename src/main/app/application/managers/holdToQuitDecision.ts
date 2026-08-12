/**
 * What a single key event means to a ⌘Q hold in progress (or about to start).
 *
 * Split out from {@link holdToQuit.ts} and deliberately free of imports - the `Electron` namespace
 * is ambient, so nothing here pulls in `electron` at runtime and this file can be unit-tested. The
 * decision is the part worth pinning down: it is a table with a dozen entries, most of them about
 * keystrokes that must *not* disturb a hold, and none of them observable without a real keyboard.
 */
export type HoldDecision =
    /** Take the keystroke and start holding. */
    | "begin"
    /** Take the keystroke and change nothing (an auto-repeat of a hold already running). */
    | "swallow"
    /** End the hold, if one is running. */
    | "cancel"
    /** Not ours; leave it to the page and to the menu. */
    | "ignore";

export interface HoldState {
    /** Whether the preference asks for the hold at all (`app.confirmQuit`, macOS only). */
    armed: boolean;
    holding: boolean;
}

/** The keys held down are part of the gesture, so their own keystrokes must not end it. */
const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control", "CapsLock"]);

type KeyEvent = Pick<Electron.Input, "type" | "key" | "meta" | "control" | "alt" | "shift">;

/**
 * ⌘Q exactly, with no other modifier.
 *
 * ⇧⌘Q is the system's log-out shortcut and ⌥⌘Q logs out without asking; neither belongs to Studio,
 * and swallowing either would break a gesture the author aimed at the operating system.
 */
function isQuitChord(input: KeyEvent): boolean {
    return input.meta
        && !input.control
        && !input.alt
        && !input.shift
        && input.key.toLowerCase() === "q";
}

export function decideHoldAction(input: KeyEvent, state: HoldState): HoldDecision {
    if (input.type === "keyUp") {
        if (!state.holding) {
            return "ignore";
        }
        // Releasing ⌘ is the release that always arrives. Q is here for the cases where it does
        // too - macOS withholds key-up for ordinary keys while Command is down, so on that platform
        // this branch is the exception rather than the rule. See the class comment in holdToQuit.ts.
        return input.key === "Meta" || input.key.toLowerCase() === "q" ? "cancel" : "ignore";
    }

    if (isQuitChord(input)) {
        if (!state.armed) {
            return "ignore";
        }
        return state.holding ? "swallow" : "begin";
    }

    // Anything else pressed mid-hold means the author has moved on to another command, so the quit
    // they half-asked for is not the one they are making now.
    if (state.holding && !MODIFIER_KEYS.has(input.key)) {
        return "cancel";
    }
    return "ignore";
}
