/**
 * "Show me that asset set" — the half of a jump to a set that making the panel visible does not cover.
 *
 * A window event rather than a call, for the reason `searchFocusRequest` gives about the caret: the
 * two sides never meet. The jump is dispatched from wherever the author was reading — a story row, a
 * lint finding — and the tree that has to open its folders lives inside a panel the shell does not
 * render and which may not be mounted yet when the request is made.
 *
 * The pending slot is what covers that second case. Revealing a hidden panel mounts it, and a mount
 * is a render later than the dispatch, so an event alone would arrive before anyone was listening.
 * The panel consumes the slot on mount instead; a request nobody collects is spent by the next mount.
 *
 * Addressed to one panel id. There are two assets panels — the sidebar's and the bottom tray's — and
 * a broadcast would open folders in whichever one happened to be mounted, which is not necessarily
 * the one the jump just made visible.
 */
export const ASSET_SET_REVEAL_EVENT = "narraleaf-studio:asset-set-reveal";

export type AssetSetRevealRequest = {
    panelId: string;
    setId: string;
};

let pending: AssetSetRevealRequest | null = null;

/**
 * Ask an assets panel to put a set on screen. Call after making that panel visible.
 *
 * Dispatched on the next frame rather than now: the reveal that precedes it is a React state change,
 * so at this moment the panel either does not exist or is still inside a hidden dock, and neither
 * can open a folder.
 */
export function requestAssetSetReveal(panelId: string, setId: string): void {
    pending = { panelId, setId };
    requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent<AssetSetRevealRequest>(ASSET_SET_REVEAL_EVENT, {
            detail: { panelId, setId },
        }));
    });
}

/** The set this panel was asked to show, once, for it to check when it mounts. */
export function consumeAssetSetReveal(panelId: string): string | null {
    if (!pending || pending.panelId !== panelId) {
        return null;
    }
    const { setId } = pending;
    pending = null;
    return setId;
}
