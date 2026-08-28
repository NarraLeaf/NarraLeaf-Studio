/**
 * A request to show the author where input actions are made.
 *
 * The Input Actions panel lives in the UI rail on the left; the place an author discovers they need
 * one is the interface's Input section on the right, which cannot reach across the workspace to
 * open it. So the request travels as a signal instead of as a prop threaded through the panel tree,
 * for the same reason a keybinding does: the two ends are in different modules and neither owns the
 * other.
 *
 * Deliberately not a service. It carries nothing, survives nothing, and has exactly one sender and
 * one listener - registering it with the workspace container would be more machinery than the fact
 * it transmits.
 *
 * Comments in English per project convention.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Ask the Input Actions panel to open itself and say where it is. */
export function requestInputActionPanelFocus(): void {
    for (const listener of Array.from(listeners)) {
        listener();
    }
}

/** Listen for that request. Returns the unsubscribe. */
export function onInputActionPanelFocus(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The left rail panel the Input Actions section lives in. */
export const UI_SURFACES_PANEL_ID = "narraleaf-studio:ui-surfaces";
