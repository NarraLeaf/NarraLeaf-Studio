import {
    sameProjectFontStack,
    normalizeProjectFontStack,
    projectFontStackIds,
    type ProjectFontEntry,
} from "@shared/types/typography";

/**
 * The project's default font stack as the window currently knows it.
 *
 * Module-level state for the same reason `@shared/brand/brandRegistry` keeps the palette that way:
 * the readers are the font fields and text renderers themselves, a hundred call sites deep in widget
 * modules, and a stack threaded through all of them would be a prop on every one.
 *
 * Three hosts push, and none of them knows about the others - the editor from `BrandService`, Dev
 * Mode from the bundle it was handed, the shipped game from the pack it booted with. A host that has
 * pushed nothing reads the empty stack, which is the right answer for all three: no default font is
 * what a project that has never opened the Design surface has, and it renders exactly like a build
 * made before this existed.
 *
 * Comments in English per project convention.
 */

let activeEntries: readonly ProjectFontEntry[] = [];
let activeIds: readonly string[] = [];
let activeRevision = 0;
const listeners = new Set<() => void>();

/**
 * Publish a stack.
 *
 * **A push whose content matches the current one changes nothing** - no revision, no notification.
 * The hosts push from a document-changed subscription that fires for every edit anywhere in the
 * project, and a bumped revision re-resolves the font of every text widget on the canvas.
 */
export function setActiveProjectFonts(entries: readonly ProjectFontEntry[] | undefined | null): void {
    const next = normalizeProjectFontStack(entries ?? []);
    if (sameProjectFontStack(activeEntries, next)) {
        return;
    }
    activeEntries = next;
    activeIds = projectFontStackIds(next);
    activeRevision += 1;
    // Iterated over a copy: a listener may unsubscribe from inside its own callback, and deleting
    // from the live set mid-iteration skips whichever listener came next.
    for (const listener of [...listeners]) {
        listener();
    }
}

/** The live stack. Never null - a host that has published nothing reads an empty one. */
export function getActiveProjectFonts(): readonly ProjectFontEntry[] {
    return activeEntries;
}

/**
 * The live stack's ids, in order.
 *
 * A stable array identity between publishes, which is what lets a `useSyncExternalStore` snapshot
 * return it directly: a fresh `map()` on every read would be a new array every render and React
 * would never stop re-rendering.
 */
export function getActiveProjectFontIds(): readonly string[] {
    return activeIds;
}

// Module-level declarations so the references stay stable across renders, which is what
// `useSyncExternalStore` needs in order not to re-subscribe on every one.
export function subscribeActiveProjectFonts(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveProjectFontsRevision(): number {
    return activeRevision;
}

/**
 * The families a field should ask for, in priority order: what was chosen, then the project's stack.
 *
 * **The project stack is a tail, not an alternative.** A widget set in a display face still falls
 * through to the project's fonts for the characters that face has no glyph for, which is the whole
 * reason a font stack is a list. `assetId` null - the state every widget ships in - leaves the
 * project's stack alone at the front, and that is what "the default font is the project's" means.
 *
 * The chosen font is not repeated if the stack already carries it, so an author who picked the same
 * font the project defaults to gets one entry rather than two identical ones.
 */
export function resolveFontStackIds(assetId: string | null | undefined): string[] {
    const chosen = typeof assetId === "string" ? assetId.trim() : "";
    if (!chosen) {
        return [...activeIds];
    }
    return [chosen, ...activeIds.filter(id => id !== chosen)];
}
