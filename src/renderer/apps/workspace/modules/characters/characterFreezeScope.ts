import { charactersSpec } from "@shared/documents/specs";

/** Which file the cast's editors write, as the project-relative path the freeze policy takes. */
export function characterDocumentFreezeScope(): string {
    // Through the document spec rather than spelled out here, for the reason `writeFreeze` gives for
    // naming its derived libraries by kind: a path written a second time is a path that falls behind
    // the one `CharacterService` actually saves to. If the two ever disagree, the panel offers an
    // edit the write boundary refuses.
    return charactersSpec.pathFor();
}
