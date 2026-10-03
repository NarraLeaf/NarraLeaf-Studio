/**
 * A request to show the author one component in the Component Library.
 *
 * The library lives in the UI rail on the left; the place an author asks "which component is this"
 * is the inspector on the right, looking at an instance. The two are in different modules and
 * neither owns the other, so the request travels as a signal - the shape `inputActionPanelFocus`
 * already uses for the Input Actions section one panel down.
 *
 * **A request outlives a library that is not there yet.** The rail may be closed, or showing another
 * panel, when the inspector asks; the sender shows the rail first, and the library only mounts on
 * the render after that. So a request with nobody listening is held, and the library takes it when
 * it subscribes - but only for a moment, so a library opened by hand a minute later does not jump
 * to something the author has long stopped asking about.
 *
 * Comments in English per project convention.
 */

type Listener = (componentId: string) => void;

/** How long an undelivered request waits for the library to mount. */
const PENDING_TTL_MS = 2000;

const listeners = new Set<Listener>();
let pending: { componentId: string; at: number } | null = null;

/** Ask the Component Library to open, bring `componentId` into view and mark it. */
export function requestComponentLibraryReveal(componentId: string): void {
    if (listeners.size === 0) {
        pending = { componentId, at: Date.now() };
        return;
    }
    pending = null;
    for (const listener of Array.from(listeners)) {
        listener(componentId);
    }
}

/**
 * Listen for those requests. A request made just before this subscription is delivered to it.
 * Returns the unsubscribe.
 */
export function onComponentLibraryReveal(listener: Listener): () => void {
    listeners.add(listener);
    const held = pending;
    pending = null;
    if (held && Date.now() - held.at <= PENDING_TTL_MS) {
        listener(held.componentId);
    }
    return () => {
        listeners.delete(listener);
    };
}
