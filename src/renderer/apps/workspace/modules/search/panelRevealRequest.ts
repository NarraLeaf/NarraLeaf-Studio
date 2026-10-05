/**
 * "Show me that row" for a side panel - the half of a jump that making the panel visible does not
 * cover.
 *
 * The same shape as the assets panel's set reveal (`assetSetReveal.ts`), for the panels whose rows a
 * jump lands on: a window event, because the jump is dispatched from wherever the author was reading
 * and the panel is not something the caller can reach; and a pending slot, because revealing a hidden
 * panel is what mounts it, so the event alone would arrive before anyone was listening. The panel
 * consumes the slot on mount; a request nobody collects is spent by the next mount.
 *
 * One channel per panel, named by the panel's id.
 */

import { useEffect, useRef } from "react";

export interface PanelRevealChannel<T> {
    readonly eventName: string;
    /** Ask the panel to put a row on screen. Call after making the panel visible. */
    request(detail: T): void;
    /** What the panel was asked for before it mounted, once. */
    consume(): T | null;
}

export function createPanelRevealChannel<T>(panelId: string): PanelRevealChannel<T> {
    const eventName = `${panelId}:reveal`;
    let pending: { detail: T } | null = null;
    return {
        eventName,
        request(detail: T) {
            pending = { detail };
            // The next frame rather than now: the reveal before this is a React state change, so the
            // panel either does not exist yet or is still inside a hidden dock.
            requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
            });
        },
        consume() {
            const taken = pending;
            pending = null;
            return taken ? taken.detail : null;
        },
    };
}

/** Hand a panel the requests made of it: the one waiting when it mounts, and each one after. */
export function usePanelRevealRequests<T>(channel: PanelRevealChannel<T>, onRequest: (detail: T) => void): void {
    const handler = useRef(onRequest);
    handler.current = onRequest;
    useEffect(() => {
        const waiting = channel.consume();
        if (waiting !== null) {
            handler.current(waiting);
        }
        const listener = (event: Event) => {
            // Spend the slot as well: this panel was already mounted, so the copy left for the next
            // mount would reveal a row in a panel the author opens later for something else.
            channel.consume();
            handler.current((event as CustomEvent<T>).detail);
        };
        window.addEventListener(channel.eventName, listener);
        return () => window.removeEventListener(channel.eventName, listener);
    }, [channel]);
}
