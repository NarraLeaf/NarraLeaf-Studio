import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import type { ProjectAppTagDocument } from "@shared/types/appTag";
import type { ProjectBrandDocument } from "@shared/types/brand";
import type { ProjectDlcDocument } from "@shared/types/dlc";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";

/**
 * The fingerprints of the three configuration tables a live session carries: the build variants, the
 * DLC list, and the project's palette.
 *
 * The same instrument as `sceneDigest`, `cast` and `libraries`, for the same purpose - **disagreement,
 * not change detection**. Every machine in a session applies the same operations in the same order
 * and should therefore hold the same table; one that computes a different digest is wrong, or the
 * host is, and neither can tell which.
 *
 * ## Why the unit here is the whole document
 *
 * Everywhere except the locale libraries the digest covers the unit the operation names, because a
 * document is far too expensive to encode on every edit - this repository has measured one
 * `JSON.stringify` of a 15.4 MB story document at 133 ms of the renderer's own thread. Neither reason
 * for that applies to these three, and one reason against does:
 *
 *  - **They are the smallest documents in the project.** A palette is a couple of dozen entries of a
 *    name and a colour; a variant list and a DLC list are a handful of records each. The encode costs
 *    less than the bookkeeping a per-record digest would need, and it is paid only on the effects that
 *    are about one of them - a story edit fingerprints a scene and never touches this.
 *  - **They are edited a few times in a session, not on every keystroke.** Nothing here is prose. An
 *    author opens the Design page, moves the brand colour, and leaves.
 *  - **A whole-document digest catches a rearrangement, and a per-record one does not.** Every
 *    operation but one names a single row, so a per-row digest would say nothing at all about
 *    `move-brand-color` - and the palette's order is what the panel draws.
 *
 * ## Why absence is a value
 *
 * `null` means this window does not hold that table at all, and it hashes to something rather than to
 * nothing - the reason `characterRecordDigest` and `translationsDigest` do the same. All three
 * services seed their document as the workspace starts, so arriving here without one means this
 * machine has failed at something; ruling `unproven` there would excuse exactly the case where two
 * copies have already parted company.
 *
 * ## What is left out, and why it has to be
 *
 * Only what an author edits is hashed. Each of these files also carries a schema version, and the DLC
 * document carries a `meta.updatedAt` that `DlcService.save` stamps from whichever clock wrote it
 * last. Both are properties of the file rather than of anything anybody changed, and a machine that
 * migrated on load - or simply saved a moment later - would otherwise be ejected from the room for
 * holding the same variants.
 */

/** The fingerprint of the build variants, or of not holding them. */
export function appTagsDigest(document: ProjectAppTagDocument | null): string {
    if (document === null) {
        return hash({ absent: true });
    }
    return hash({
        tags: document.tags,
        // The project's own half, named key by key rather than spread, so a field added to the
        // document reaches this by somebody deciding it should rather than by default. A key that
        // arrived silently would be one two machines could disagree about with nothing reporting it;
        // a key that is missing here is caught by `configDocumentsDigested.test.ts`.
        pluginConfig: document.pluginConfig ?? null,
        assetAxes: document.assetAxes ?? null,
        reachableScenes: document.reachableScenes ?? null,
        endingSurfaceId: document.endingSurfaceId ?? null,
    });
}

/** The fingerprint of the DLC list, or of not holding it. */
export function dlcDigest(document: ProjectDlcDocument | null): string {
    return hash(document === null ? { absent: true } : { dlcs: document.dlcs });
}

/** The fingerprint of the palette and the font stack, or of not holding them. */
export function brandDigest(document: ProjectBrandDocument | null): string {
    if (document === null) {
        return hash({ absent: true });
    }
    return hash({ colors: document.colors, fonts: document.fonts });
}

/**
 * `list` with `entry` in front of `beforeId`, or at the end when nothing names it.
 *
 * Where the creation that undoes a deletion puts the record back. Shared by the three tables'
 * appliers rather than written three times, because it is one rule and the three lists are the same
 * shape: records with an id, in an order the author arranged.
 *
 * ⚠ **Tolerant of a `beforeId` that has gone**, which is why it is a neighbour rather than an index:
 * a position is only ever stated by an undo, and by then the neighbour may have been deleted too. The
 * end is the honest answer for that - the record is back and nothing else moved - where an index
 * would put it somewhere nobody chose.
 */
export function insertLiveRecordBefore<T extends { id: string }>(
    list: readonly T[],
    entry: T,
    beforeId?: string,
): T[] {
    const index = beforeId === undefined ? -1 : list.findIndex(item => item.id === beforeId);
    if (index < 0) {
        return [...list, entry];
    }
    const next = [...list];
    next.splice(index, 0, entry);
    return next;
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
