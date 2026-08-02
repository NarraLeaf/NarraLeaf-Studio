import type { DevModeStoryRowHighlight } from "@shared/types/devMode";

/**
 * Renderer-local fan-out for the Dev Mode play head (WI-2 editor sync). A single bridge subscribes
 * to the IPC channel and publishes here; every open story-scene editor tab subscribes and reveals
 * the row only when it owns that story + scene. Kept out of the IPC layer so multiple tabs can all
 * react without contending over a single `onMessage` handler.
 */
type Listener = (highlight: DevModeStoryRowHighlight) => void;

const listeners = new Set<Listener>();

export function emitStoryRowHighlight(highlight: DevModeStoryRowHighlight): void {
    for (const listener of listeners) {
        try {
            listener(highlight);
        } catch {
            // A misbehaving subscriber must not stop the others from following the play head.
        }
    }
}

export function subscribeStoryRowHighlight(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
