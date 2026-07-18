import type * as React from "react";

/**
 * Module-level bridge between the title-bar search box and the command palette.
 *
 * The box owns the DOM input (you literally type in the title bar, VSCode command center style);
 * the palette owns every bit of session logic (mode, ranking, selection, commit). This file wires
 * the two across component trees: the palette registers a {@link PaletteBridge} on mount, and
 * publishes its session ({open, query}) for the box to render as a controlled input. Deliberately
 * not a service — one window-local wiring, dead once the layout unmounts.
 */

export interface PaletteBridge {
    /** Open with an initial query (`">"` = command mode, `""` = search mode). */
    open: (initialQuery: string) => void;
    /** Controlled-input change from the title-bar box. */
    setQuery: (query: string) => void;
    /** Keyboard forwarded from the box (arrows/Enter/Escape drive the list). */
    handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Dismiss the session (box blur, backdrop click). */
    close: () => void;
}

let bridge: PaletteBridge | null = null;

/** Called by the mounted CommandPalette; returns an unregister disposer. */
export function registerCommandPaletteBridge(next: PaletteBridge): () => void {
    bridge = next;
    return () => {
        if (bridge === next) {
            bridge = null;
        }
    };
}

export function openCommandPalette(initialQuery: string): void {
    bridge?.open(initialQuery);
}

export function setCommandPaletteQuery(query: string): void {
    bridge?.setQuery(query);
}

export function forwardCommandPaletteKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    bridge?.handleKeyDown(event);
}

export function closeCommandPalette(): void {
    bridge?.close();
}

// --- Session state, published palette → box -------------------------------

export interface PaletteSessionState {
    open: boolean;
    query: string;
}

type SessionListener = (state: PaletteSessionState) => void;

const sessionListeners = new Set<SessionListener>();
let session: PaletteSessionState = { open: false, query: "" };

/** Called by the palette whenever open/query change. */
export function publishCommandPaletteSession(next: PaletteSessionState): void {
    if (session.open === next.open && session.query === next.query) {
        return;
    }
    session = next;
    for (const listener of sessionListeners) {
        listener(session);
    }
}

/** Subscribe to session changes; immediately invoked with the current state. */
export function subscribeCommandPaletteSession(listener: SessionListener): () => void {
    sessionListeners.add(listener);
    listener(session);
    return () => {
        sessionListeners.delete(listener);
    };
}
