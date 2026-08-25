import {
    charactersSpec,
    localizationDocumentSpec,
    storyDocumentSpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import type { StoryId } from "@shared/types/story";
import { sameLiveDocument, type LiveDocument } from "./ops";

/**
 * Which documents a live session carries, and where each of them lives on disk.
 *
 * **One table with two consumers, and that is the whole point of the file.** The write boundary asks
 * it which paths a session leaves writable (`WorkspaceFreezeReason` of kind `live-session`); the host
 * asks it whether an operation is about a document this session speaks for. Those two questions have
 * to have one answer: a path the boundary allows but the vocabulary cannot carry is an edit that
 * lands on one machine and nowhere else, with no digest over it and nothing anywhere reporting a
 * problem - the silent divergence the whole design is built to make impossible. A path the vocabulary
 * carries but the boundary refuses is the opposite and merely annoying: the operation travels, every
 * machine applies it, and every machine fails to save it.
 *
 * The shape is borrowed from `shared/vcs/workingSet`, which generates its predicate and its ignore
 * file from one table for the same reason, and says so in the same words: two representations of one
 * policy that MUST agree cannot be written down twice.
 *
 * **The invariant to keep when adding a document:**
 *
 * > A document is writable during a session exactly when the session can carry its changes.
 *
 * So a kind arrives here only once it has all three of the things a verb needs - an applier in its
 * owning service, a case in `LiveHost.plan`, and an inverse in `lib/live/inverse` - and until then
 * the boundary keeps refusing its writes. Which means forgetting to do the work costs a harmless
 * no-op and a visible notice, not a working tree with one machine's edits in it.
 *
 * **Every story document, not just the one the room is named after.** A session is *opened* on one
 * story, and that is still the only one anybody is expected to be editing - but deleting a character
 * rewrites the dialogue rows that spoke it wherever they are, and they are wherever the author put
 * them. A session that carried one story would have to refuse that gesture, and refusing it is worse
 * than it sounds: the alternative to rewriting those rows is leaving them pointing at a character
 * that no longer exists, which the compiler renders as "Unknown".
 *
 * So the set is every story, the cast, and one translation library and one voice library per
 * language - and the entries are `LiveDocument` **addresses** rather than document kinds. That
 * distinction goes on mattering for every parameterised kind: widening this to "every path of every
 * shared kind" would make a document writable while the host still refused operations about it,
 * which is an edit that lands on one machine and nowhere else with no digest over it.
 *
 * ⚠ **The languages are the ones a machine actually read, not the ones the project declares.** A
 * library that could not be loaded is one no operation can be applied to - appliers are synchronous,
 * so there is no later moment at which one could be fetched - and carrying it would be the same
 * silent divergence one step removed. The caller passes what it loaded; see `LiveLocalizationPort`.
 *
 * **`editor/localization/keys.json` is NOT here**, and its absence is the invariant working. The
 * named-key registry is a document of its own with no verbs, so declaring a UI string stays frozen
 * for the length of a session and says so - which is the harmless half of the trade.
 */

/** The languages a session carries libraries for. Two lists, because the two are configured apart. */
export type LiveSessionLocales = {
    /** Languages whose translations this machine holds. */
    translations: readonly string[];
    /** Languages whose voice takes this machine holds. */
    voice: readonly string[];
};

/** No libraries at all - what a caller that has not read any passes. */
export const NO_LIVE_LOCALES: LiveSessionLocales = { translations: [], voice: [] };

/**
 * The documents a session carries: every story in the project, the cast, and each language's two
 * libraries.
 *
 * The cast is not parameterised - there is one per project - which is why it needs nothing from the
 * caller and why a session cannot be opened on "some of" it.
 */
export function liveSessionDocuments(
    storyIds: readonly StoryId[],
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
): readonly LiveDocument[] {
    return [
        ...storyIds.map((storyId): LiveDocument => ({ doc: "story", storyId })),
        { doc: "characters" },
        ...locales.translations.map((locale): LiveDocument => ({ doc: "localization", locale })),
        ...locales.voice.map((locale): LiveDocument => ({ doc: "voice", locale })),
    ];
}

/**
 * Where one shared document lives, as the project-relative path the freeze policy takes.
 *
 * Derived from each document's own spec rather than assembled here, for the reason `writeFreeze`
 * gives for naming its derived libraries by kind: a path spelled a second time is a path that falls
 * behind the one the owning service actually saves to, and this one is compared against the set a
 * live session declares writable. A document that moves house takes this with it.
 */
export function liveDocumentPath(document: LiveDocument): string {
    switch (document.doc) {
        case "story":
            return storyDocumentSpec.pathFor({ storyId: document.storyId });
        case "characters":
            return charactersSpec.pathFor();
        case "localization":
            return localizationDocumentSpec.pathFor({ locale: document.locale });
        case "voice":
            return voiceDocumentSpec.pathFor({ locale: document.locale });
    }
}

/**
 * Every path a session over these documents leaves writable.
 *
 * What `WorkspaceFreezeReason`'s `writable` is built from. Nothing else may build it: a caller that
 * assembled the list itself would be the second representation this file exists to prevent.
 */
export function liveSessionWritablePaths(
    storyIds: readonly StoryId[],
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
): readonly string[] {
    return liveSessionDocuments(storyIds, locales).map(liveDocumentPath);
}

/**
 * Whether a session over these documents carries this one.
 *
 * The host's half of the same table. Every parameterised kind is compared against the set rather
 * than assumed, because a document created *during* a session is in nobody else's copy - the room
 * agreed a revision on the way in, and a document that was not in it is one the others cannot apply
 * an operation to.
 */
export function liveSessionCarries(
    storyIds: readonly StoryId[],
    document: LiveDocument,
    locales: LiveSessionLocales = NO_LIVE_LOCALES,
): boolean {
    return liveSessionDocuments(storyIds, locales).some(carried => sameLiveDocument(carried, document));
}
