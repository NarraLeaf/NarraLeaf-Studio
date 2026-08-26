import { dictionarySpec } from "@shared/documents/specs";

/**
 * Which file the dictionary panel writes, as the project-relative path the freeze policy takes.
 *
 * `characterDocumentFreezeScope`'s counterpart one document along, and the reason for asking the
 * document spec rather than spelling the path is the one `writeFreeze` gives: a path written a
 * second time is a path that falls behind the one `DictionaryService` actually saves to, and this
 * one is compared against the set a live session declares writable. If the two ever disagree, the
 * panel offers an edit the write boundary refuses.
 *
 * **Nothing on this panel is switched off by a session.** Adding a term is the smallest gesture in
 * Studio and the one an author reaches for most often while writing - the spellchecker underlines a
 * name, and the answer is one click - so a session that greyed it out would be a session authors
 * left rather than kept open.
 */
export function dictionaryFreezeScope(): string {
    return dictionarySpec.pathFor();
}
