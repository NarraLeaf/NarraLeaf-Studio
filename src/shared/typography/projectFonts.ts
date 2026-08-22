import {
    projectFontStackIds,
    normalizeProjectFontStack,
    resolveProjectFontStackForLocale,
    sameProjectFontStack,
    type ProjectFontEntry,
} from "@shared/types/typography";

/**
 * The project's default font stack as the window currently knows it, and the language it is being
 * read in.
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
 * ## The language is state here, not an argument at the call site
 *
 * A rung of the stack may be restricted to some languages (see `@shared/types/typography`), so
 * "which fonts" has no answer without "in which language". Keeping the language beside the stack
 * rather than passing it down is what lets every text field go on asking the same question it asked
 * before restrictions existed - and it is the only shape that repaints the canvas when the language
 * changes, because a language change is a publish like any other.
 *
 * A host that never publishes a language reads the empty one, which resolves to the **unfiltered**
 * list. That is the pre-existing behaviour, and it is what a project with no localization set up
 * should see.
 *
 * Comments in English per project convention.
 */

let activeEntries: readonly ProjectFontEntry[] = [];
let activeLocale = "";
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
    // Announced even when the active language resolves to the same ids: a restriction that moved
    // changes what `getActiveProjectFonts` answers, and the Design surface is looking at that.
    republish(true);
}

/**
 * Publish the language the stack is being read in.
 *
 * The editor publishes the project's source language, which is what it previews in - the same call
 * `resolveEditorAssetSetMember` makes for pictures, and for the same reason: an author writing in
 * one language should not be shown another language's typeface. Dev Mode and the shipped game
 * publish whatever language the game booted in.
 *
 * Idempotent, and normalised the same way a rung's restriction is, so `ja-JP` and `ja-jp` are one
 * language rather than two repaints.
 */
export function setActiveProjectLocale(locale: string | undefined | null): void {
    const next = typeof locale === "string" ? locale.trim() : "";
    if (next === activeLocale) {
        return;
    }
    activeLocale = next;
    republish(false);
}

/**
 * The live stack, every rung of it, whatever language each is for.
 *
 * The unfiltered list on purpose. Its readers are the ones that must not lose a rung to the language
 * the window happens to be in: the Design surface, which is editing the list; the shipped-content
 * audit, which has to demand every font the build carries; and `typography` lint, which asks its
 * question once per language of the project rather than once for the window.
 */
export function getActiveProjectFonts(): readonly ProjectFontEntry[] {
    return activeEntries;
}

/** The language the stack is currently resolved in. Empty when no host has published one. */
export function getActiveProjectLocale(): string {
    return activeLocale;
}

/**
 * The ids of the rungs that serve the active language, in order.
 *
 * A stable array identity between publishes, which is what lets a `useSyncExternalStore` snapshot
 * return it directly: a fresh `filter()` on every read would be a new array every render and React
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
 * The families a field should ask for, in priority order: what was chosen, then the project's stack
 * as the active language resolves it.
 *
 * **The project stack is a tail, not an alternative.** A widget set in a display face still falls
 * through to the project's fonts for the characters that face has no glyph for, which is the whole
 * reason a font stack is a list. `assetId` null - the state every widget ships in - leaves the
 * project's stack alone at the front, and that is what "the default font is the project's" means.
 *
 * The chosen font is not repeated if the stack already carries it, so an author who picked the same
 * font the project defaults to gets one entry rather than two identical ones. **A chosen font is
 * never filtered out by the language**: the author named that font on that widget, and a restriction
 * on the project's list says which language a *default* is for, not which widgets may use a face.
 */
export function resolveFontStackIds(assetId: string | null | undefined): string[] {
    return withChosenFont(assetId, activeIds);
}

/**
 * The same answer for a language that is not the active one.
 *
 * For the one surface that shows a language other than the window's: Project -> Design, where an
 * author previewing the stack as Japanese has to see the Japanese rungs even though the editor is
 * still in the project's source language.
 */
export function resolveFontStackIdsForLocale(
    assetId: string | null | undefined,
    locale: string | null | undefined,
): string[] {
    return withChosenFont(assetId, projectFontStackIds(resolveProjectFontStackForLocale(activeEntries, locale)));
}

function withChosenFont(assetId: string | null | undefined, stack: readonly string[]): string[] {
    const chosen = typeof assetId === "string" ? assetId.trim() : "";
    if (!chosen) {
        return [...stack];
    }
    return [chosen, ...stack.filter(id => id !== chosen)];
}

/**
 * Recompute what the active language resolves to and tell everyone.
 *
 * `changed` is what the caller already knows: `setActiveProjectFonts` has compared the stacks and
 * only reaches here when one is genuinely different, while a language change may resolve to exactly
 * the same fonts. The guard matters for that second case - a project whose rungs carry no
 * restrictions resolves identically in every language, and switching the preview language there
 * must not repaint a canvas whose every family is about to come out the same.
 */
function republish(changed: boolean): void {
    const nextIds = projectFontStackIds(resolveProjectFontStackForLocale(activeEntries, activeLocale));
    if (!changed && sameIds(activeIds, nextIds)) {
        return;
    }
    activeIds = nextIds;
    activeRevision += 1;
    // Iterated over a copy: a listener may unsubscribe from inside its own callback, and deleting
    // from the live set mid-iteration skips whichever listener came next.
    for (const listener of [...listeners]) {
        listener();
    }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}
