import { appTagsSpec, brandSpec, dlcSpec } from "@shared/documents/specs";

/**
 * Which file each of the project's three configuration tables writes, as the project-relative path
 * the freeze policy takes.
 *
 * Through the document specs rather than spelled out here, for `characterDocumentFreezeScope`'s
 * reason: a path written a second time is a path that falls behind the one the owning service
 * actually saves to. If the two ever disagree, the panel offers an edit the write boundary refuses.
 */
export function appTagsDocumentFreezeScope(): string {
    return appTagsSpec.pathFor();
}

export function dlcDocumentFreezeScope(): string {
    return dlcSpec.pathFor();
}

export function brandDocumentFreezeScope(): string {
    return brandSpec.pathFor();
}
