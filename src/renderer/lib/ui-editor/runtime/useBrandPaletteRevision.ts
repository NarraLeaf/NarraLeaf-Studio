import { useSyncExternalStore } from "react";
import { getActiveBrandPaletteRevision, subscribeActiveBrandPalette } from "@shared/brand/brandRegistry";

/**
 * Re-render when the project palette changes.
 *
 * A colour holding `nlbrand:…` is resolved against the module-level palette *while painting*, so
 * nothing in a component's props or state says the palette moved. Editing the primary colour writes
 * `editor/brand.json`, not the document, and without this the canvas keeps the colour it last drew
 * until something unrelated forces a re-render - which is how the gap was found: switching tabs away
 * and back "fixed" it, so resolution was correct all along and only the repaint was missing.
 *
 * Lives in the shared ui-editor tree because both sides need it and neither may reach the other:
 * the runtime bundle cannot import `@/apps/**` (`build-runtime.js` fails the build), and the editor
 * bridge is a service, not a component. The number itself is rarely read - subscribing is the point
 * - but returning it lets a memoised child take it as a prop.
 *
 * Inert in a packaged game: the palette is published once from the pack and never changes again.
 */
export function useBrandPaletteRevision(): number {
    return useSyncExternalStore(
        subscribeActiveBrandPalette,
        getActiveBrandPaletteRevision,
        getActiveBrandPaletteRevision,
    );
}
