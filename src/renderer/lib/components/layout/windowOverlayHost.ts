import { useLayoutEffect, useState } from "react";

/**
 * The window's overlay layer — where a dialog raised from anywhere in the app is mounted.
 *
 * A centred dialog is `position: fixed` at `z-50`, which reads like "above everything". It is not:
 * `z-50` is only a rank WITHIN the nearest stacking context, and a dialog is rendered by whichever
 * component happens to open it — deep inside a dock panel, an editor tab, an inspector. An ancestor
 * with a z-index of its own seals the dialog under that ancestor's rank. The project panel's
 * slide-in sub-page is `absolute inset-0 z-10`, so the Live2D / Spine installer raised from it had a
 * ceiling of 10, and the shell chrome that sits above panel content — the dock seams
 * (`.nl-dock-divider`, 15) and the editor split sash (10) — painted straight across the dialog.
 *
 * So a dialog is portalled out of wherever it was raised. Not to `document.body`, which is where the
 * app's menus and popovers go: the window root is `isolate`, so a layer parked outside it also
 * outranks the title bar, and the backdrop then dims the window controls and swallows clicks on
 * minimise / maximise / close. This host is a child of the window root instead — outside every panel,
 * inside the one context where the title bar's `z-[20000]` still wins.
 *
 * `display: contents` so the host is not a box: it adds no layout to the shell's flex or grid, and —
 * the part that matters — creates no stacking context of its own, which is the whole defect it
 * exists to avoid.
 */
const WINDOW_ROOT_ATTRIBUTE = "data-nl-window-root";
const OVERLAY_HOST_ATTRIBUTE = "data-nl-window-overlay-host";

/** Marker props for a window shell's root element. Spread onto the root, nothing else. */
export const windowRootProps = { [WINDOW_ROOT_ATTRIBUTE]: "" } as const;

/**
 * One host per window, and the SAME element for the life of the window.
 *
 * Stable identity is what lets the host be re-homed below without disturbing anything: React treats
 * a portal's container by identity, so moving the node moves its children with it and remounts
 * nothing. A fresh element per dialog would instead tear the dialog down and build it again, losing
 * focus and any field the author had started filling in.
 */
let overlayHost: HTMLElement | null = null;

function ensureOverlayHost(): HTMLElement {
    if (!overlayHost) {
        overlayHost = document.createElement("div");
        overlayHost.setAttribute(OVERLAY_HOST_ATTRIBUTE, "");
        overlayHost.style.display = "contents";
    }
    if (!overlayHost.isConnected) {
        // Connected straight away, during the render that first asks for it: a dialog that mounts
        // already open runs its own mount effects in that same commit, and several of them reach for
        // a node inside the dialog — the paste wizard takes focus there so that Escape closes the
        // dialog instead of reaching the row underneath and committing it. `focus()` on a detached
        // node is silently a no-op, so deferring this by even one render breaks them.
        adopt(overlayHost);
    }
    return overlayHost;
}

/**
 * Put the host under the window root once that exists.
 *
 * The very first caller can run before the shell is in the document — a dialog mounted by the same
 * render pass as the shell around it — and then `document.body` is the only parent available. That
 * is the fallback a window with no marker keeps for good (a test rendering a dialog on its own, say),
 * and it is also where the host waits until the shell has committed.
 */
function adopt(host: HTMLElement): void {
    const root = document.querySelector<HTMLElement>(`[${WINDOW_ROOT_ATTRIBUTE}]`);
    const parent = root ?? document.body;
    if (host.parentElement !== parent) {
        parent.appendChild(host);
    }
}

/** The element a dialog portals into. */
export function useWindowOverlayHost(): HTMLElement {
    const [host] = useState(ensureOverlayHost);
    useLayoutEffect(() => adopt(host), [host]);
    return host;
}

/** Test seam: forget the window's host so each case starts from an empty document. */
export function resetWindowOverlayHostForTests(): void {
    overlayHost?.remove();
    overlayHost = null;
}
