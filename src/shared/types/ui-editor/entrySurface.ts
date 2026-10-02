import { MAIN_APP_SURFACE_ID } from "../../constants/ui-editor";
import type { UIAppSurface, UIDocument, UISurface, UISurfaceId } from "./document";

/**
 * The page a game starts on, and the one rule every reader answers that question with.
 *
 * The document names it in {@link UIDocument.entrySurfaceId}. A document that names nothing - every
 * one written before the entry page could be moved, and every one whose author never moved it -
 * starts on the page carrying {@link MAIN_APP_SURFACE_ID}, the id a new document gives its first
 * page. A name that no longer finds a page is read the same way: a pointer that misses must never
 * leave a game with nowhere to open, and the page it falls back to is the one the author saw marked
 * as the entry before the pointer existed. A document with neither starts on its first page.
 *
 * Only a page can be the entry. A Game UI is mounted into a stage slot by the engine and has no
 * existence before a story runs, so a pointer that names one is a pointer that misses.
 *
 * Every launcher reads this - Run, Dev Mode, a test, a build, a patch, the shipped game's own
 * fallback - and so does everything that marks a page as the entry in the interface. A second
 * reading anywhere would be a page labelled as the entry that the game does not open on.
 */
export function resolveEntrySurface(
    document: Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined,
): UIAppSurface | undefined {
    const pages = (document?.surfaces ?? []).filter(isAppSurface);
    const named = typeof document?.entrySurfaceId === "string" && document.entrySurfaceId
        ? pages.find(surface => surface.id === document.entrySurfaceId)
        : undefined;
    return named ?? pages.find(surface => surface.id === MAIN_APP_SURFACE_ID) ?? pages[0];
}

/** {@link resolveEntrySurface}, for a caller that only needs the id. */
export function resolveEntrySurfaceId(
    document: Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined,
): UISurfaceId | undefined {
    return resolveEntrySurface(document)?.id;
}

/**
 * A launch entry with its page stated: the one it names, or the document's entry page when it names
 * none (`GameRuntimeLaunchEntry`). A page it does name is kept as given, whether or not this
 * document has it - that is the caller's statement, and the reader's fallback is the same rule.
 */
export function resolveLaunchEntrySurface<Entry extends { kind: string; surfaceId?: UISurfaceId }>(
    entry: Entry,
    document: Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined,
): Entry {
    if (entry.surfaceId) {
        return entry;
    }
    const surfaceId = resolveEntrySurfaceId(document);
    return surfaceId ? { ...entry, surfaceId } : entry;
}

/** Whether this surface is the one the game starts on. */
export function isEntrySurface(
    document: Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined,
    surfaceId: UISurfaceId,
): boolean {
    return resolveEntrySurfaceId(document) === surfaceId;
}

/**
 * Whether the stored pointer names a page that is not there.
 *
 * Absent is not a miss - it is the document saying nothing, which has a defined answer. A miss is a
 * pointer that was written and has since lost its page: a merge that kept the pointer from one side
 * and the deletion from the other, or a hand edit. The game still opens (see
 * {@link resolveEntrySurface}), so this is for a check to report, never for a reader to act on.
 */
export function entrySurfacePointerMisses(
    document: Pick<UIDocument, "surfaces" | "entrySurfaceId"> | null | undefined,
): boolean {
    const stored = document?.entrySurfaceId;
    if (typeof stored !== "string" || !stored) {
        return false;
    }
    return !(document?.surfaces ?? []).some(surface => surface.id === stored && isAppSurface(surface));
}

function isAppSurface(surface: UISurface): surface is UIAppSurface {
    return surface.kind === "appSurface";
}
