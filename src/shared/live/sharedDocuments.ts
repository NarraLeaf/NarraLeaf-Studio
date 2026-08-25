import { charactersSpec, storyDocumentSpec } from "@shared/documents/specs";
import type { StoryId } from "@shared/types/story";
import type { LiveDocument } from "./ops";

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
 * **Addresses, not kinds.** A project holds many story documents and a session carries exactly one of
 * them, so the entries here are `LiveDocument` values rather than document kinds. Widening this to
 * "every path of every shared kind" would make the second story document writable while the host
 * still refused operations about it - the first failure above, on the most-used document in the
 * project.
 */

/**
 * The documents a session opened on `storyId` carries.
 *
 * The story it was opened on, and the cast. The cast is not parameterised - there is one per project -
 * which is why it needs nothing from the caller and why a session cannot be opened on "some of" it.
 */
export function liveSessionDocuments(storyId: StoryId): readonly LiveDocument[] {
    return [{ doc: "story", storyId }, { doc: "characters" }];
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
    }
}

/**
 * Every path a session opened on `storyId` leaves writable.
 *
 * What `WorkspaceFreezeReason`'s `writable` is built from. Nothing else may build it: a caller that
 * assembled the list itself would be the second representation this file exists to prevent.
 */
export function liveSessionWritablePaths(storyId: StoryId): readonly string[] {
    return liveSessionDocuments(storyId).map(liveDocumentPath);
}

/**
 * Whether a session on `storyId` carries this document.
 *
 * The host's half of the same table. Story documents are compared by id, because carrying one is not
 * carrying the rest; the cast is a single document, so naming it is enough.
 */
export function liveSessionCarries(storyId: StoryId, document: LiveDocument): boolean {
    return document.doc === "characters" || document.storyId === storyId;
}
