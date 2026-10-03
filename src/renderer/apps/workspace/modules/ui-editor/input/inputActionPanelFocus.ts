/**
 * A request to show the author where input actions are made - or where one of them is.
 *
 * The Input Actions panel lives in the UI rail on the left; the place an author discovers they need
 * one, or asks what one is, is the interface's Input section on the right, which cannot reach across
 * the workspace to open it. So the request travels as a signal instead of as a prop threaded through
 * the panel tree, for the same reason a keybinding does: the two ends are in different modules and
 * neither owns the other.
 *
 * Deliberately not a service. It carries at most an action id and survives nothing - except the one
 * render it takes for a rail that was just shown to mount the panel: the sender shows the rail first,
 * so a request that finds nobody listening is held for a moment and handed to the panel when it
 * subscribes, rather than lost.
 *
 * Comments in English per project convention.
 */

/** `actionId` is the action to bring into view, or undefined for the section as a whole. */
type Listener = (actionId: string | undefined) => void;

/** How long an undelivered request waits for the panel to mount. */
const PENDING_TTL_MS = 2000;

const listeners = new Set<Listener>();
let pending: { actionId: string | undefined; at: number } | null = null;

/** Ask the Input Actions panel to open itself and say where it is, or where `actionId` is. */
export function requestInputActionPanelFocus(actionId?: string): void {
    if (listeners.size === 0) {
        pending = { actionId, at: Date.now() };
        return;
    }
    pending = null;
    for (const listener of Array.from(listeners)) {
        listener(actionId);
    }
}

/** Listen for that request; one made just before this subscription is delivered to it. Returns the unsubscribe. */
export function onInputActionPanelFocus(listener: Listener): () => void {
    listeners.add(listener);
    const held = pending;
    pending = null;
    if (held && Date.now() - held.at <= PENDING_TTL_MS) {
        listener(held.actionId);
    }
    return () => {
        listeners.delete(listener);
    };
}

/** The left rail panel the Input Actions section lives in. */
export const UI_SURFACES_PANEL_ID = "narraleaf-studio:ui-surfaces";
