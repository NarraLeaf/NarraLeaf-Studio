/**
 * Who is still waiting for a picture's bytes, for a host that must not look before they arrive.
 *
 * A widget reaches an asset through `useAssetObjectUrl`, and in Studio that is an IPC round trip:
 * the first render draws nothing, and the `<img>` (or the CSS background) only exists once the bytes
 * are back and a second render has committed. Something that photographs a freshly mounted page -
 * the agent's `ui_screenshot` - cannot tell "this page has no picture" from "this page's picture is
 * on its way" by looking at the DOM, and photographing on a fixed delay loses the race whenever the
 * read is slow (a cold file, a big image, a busy main process).
 *
 * So a host that cares mounts a tracker here and every lookup under it says when it starts and when
 * it is over, whatever the outcome. Nothing else mounts one: the canvas, the game and thumbnails read
 * a null context and the hook does exactly what it did before.
 *
 * React-only and free of workspace imports, because the game-runtime bundle compiles this tree.
 */

import { createContext } from "react";

export type AssetLoadTracker = {
    /**
     * A lookup for `label` (the id the widget asked for) has started. Returns the call that ends it;
     * calling that more than once is harmless, so every exit path - success, failure, an unmount
     * that cancels the lookup - may call it without coordinating.
     */
    begin(label: string): () => void;
};

/** Null everywhere but under a host that waits for pictures (see the module note). */
export const AssetLoadTrackerContext = createContext<AssetLoadTracker | null>(null);
