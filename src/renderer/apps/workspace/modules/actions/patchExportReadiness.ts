/**
 * Whether the patch dialog's selection can be exported, and what is missing when it cannot.
 *
 * Pure, and separate from the dialog, because it is the one piece of that form worth being sure
 * about. An export takes minutes and compiles the project twice; a selection that was never going to
 * produce a usable file should be caught while the author is still looking at the field, not after
 * the build console has run to the end.
 *
 * ## What it refuses, and what it only warns about
 *
 * It refuses a selection that is **incomplete or contradictory** - a file with nowhere to go, a
 * build folder that holds no game, a DLC pointed at the wrong edition. Those are all states where
 * the export either fails outright or writes something the author did not ask for.
 *
 * It does not refuse a selection that is merely **pointless**. Exporting a patch whose content and
 * whose target are the same variant produces a valid file carrying no changes, and an author
 * checking the delivery path has a reason to want exactly that. The dialog says so where the choice
 * is made; saying it again by disabling the button would take away a thing that works.
 */

/** Why the export cannot start, in the order the dialog reads its own fields. */
export type PatchExportBlocker =
    /** No path to write to. */
    | "output"
    /** The chosen build folder has not been read yet; what it says may change the answer. */
    | "reading"
    /** The chosen build folder holds no build of this game. */
    | "artifact"
    /** A DLC was chosen, and the build it adds to was not. */
    | "dlcBaseline"
    /** The chosen build is a different edition from the one this DLC attaches to. */
    | "dlcVariant";

export interface PatchExportSelection {
    /** Trimmed path of the file to write. */
    outputFile: string;
    /** How the build being updated is arrived at. */
    baselineMode: "variant" | "artifact";
    /** Trimmed build folder, in `artifact` mode. Empty means none was named. */
    baselineAppDir: string;
    /** True while that folder is being read. */
    readingBaseline: boolean;
    /** True when reading it failed. */
    baselineUnreadable: boolean;
    /** The variant the folder says it is, or null where it says nothing or none was read. */
    baselineAppTagId: string | null;
    /** The variant a chosen DLC attaches to, or null when no DLC was chosen. */
    dlcAttachTo: string | null;
}

/**
 * The first thing standing in the way, or null when nothing is.
 *
 * One blocker rather than a list: the footer has room for one sentence, and an author fixes these
 * one at a time anyway. The order is the order the fields appear, so the sentence always points at
 * something above the button rather than behind it.
 */
export function patchExportBlocker(selection: PatchExportSelection): PatchExportBlocker | null {
    if (!selection.outputFile) {
        return "output";
    }
    if (selection.baselineMode !== "artifact") {
        return null;
    }
    if (selection.baselineAppDir) {
        if (selection.readingBaseline) {
            return "reading";
        }
        if (selection.baselineUnreadable) {
            return "artifact";
        }
    }
    if (!selection.dlcAttachTo) {
        return null;
    }
    // A DLC carries what the build it adds to does not, so without that build there is nothing to
    // measure against and the pack would be the whole game again under a DLC's name.
    if (!selection.baselineAppDir) {
        return "dlcBaseline";
    }
    // A build that states a different edition would be measured against the wrong game: the pack
    // would leave out bytes the player's build has, and carry ones it already has.
    if (selection.baselineAppTagId && selection.baselineAppTagId !== selection.dlcAttachTo) {
        return "dlcVariant";
    }
    return null;
}
