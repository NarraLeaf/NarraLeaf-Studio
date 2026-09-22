/**
 * Which build of a project a headless `--test` run's game is, from the names on its line.
 *
 * The command-line counterpart of `runVariant.ts` and `runDlc.ts`, and deliberately not a caller of
 * either. Those two read the machine's "Run as" and "Run with DLC" choices, which are the habits of
 * an author at that machine; a run with nobody at the screen has no habit to inherit, and the same
 * line has to test the same build on a build agent that never made a choice and on a developer's
 * machine that did. So a headless run asks its line (`--test-variant`, `--test-dlc`) and nothing
 * else, and a line that names nothing gets the build a player who bought only the game has: the
 * release variant, with no DLC.
 *
 * # Names, not ids
 *
 * A variant is named by the name its author gave it, exactly as `--build-variant` names one - both go
 * through `commandLineVariant.ts`, which says why the stored id is refused. A DLC's id is different:
 * the author chose it and it names the file they ship, so a DLC is found by its name first and by
 * its id when no name matches.
 *
 * # What is refused
 *
 * A name the project does not have, with the ones it does listed, so the fix is on the screen that
 * reports the mistake. And a DLC that attaches to another variant than the one the run is: a build
 * refuses a DLC sealed for another variant, so no player of this build can install it, and a green
 * run on that pair would be about a game nobody can have.
 *
 * Pure over the two documents, so the rules are tested without a project on disk; the caller reads
 * the documents (`appTagsFile.ts`, `dlcFile.ts`) and decides what an unreadable one means.
 */

import {
    APP_TAG_ID_RELEASE,
    listAppTags,
    RELEASE_APP_TAG,
    type ProjectAppTag,
} from "@shared/types/appTag";
import { dlcAttachesToBuild, type ProjectDlc } from "@shared/types/dlc";
import type { CommandLineTestEdition } from "@shared/types/commandLineRun";
import { findCommandLineVariant, quoteForLine } from "./commandLineVariant";

/** The build a line that names nothing runs: the release variant, with no DLC. */
export function defaultTestEdition(): CommandLineTestEdition {
    return { variant: { id: RELEASE_APP_TAG.id, name: RELEASE_APP_TAG.name }, dlc: [] };
}

export type TestEditionInput = {
    /** `--test-variant`, as typed. Null when the line named none. */
    variantName: string | null;
    /** `--test-dlc`, every name as typed. Empty when the line named none. */
    dlcNames: readonly string[];
    /** The project's own variants - the stored ones; the release variant is added here. */
    variants: readonly ProjectAppTag[];
    /** The project's DLC. */
    dlcs: readonly ProjectDlc[];
};

export type TestEditionResult =
    | { ok: true; edition: CommandLineTestEdition }
    | { ok: false; reason: string };

export function resolveTestEdition(input: TestEditionInput): TestEditionResult {
    const allVariants = listAppTags(input.variants);
    let variant: ProjectAppTag = RELEASE_APP_TAG;
    if (input.variantName !== null) {
        const found = findCommandLineVariant(input.variants, input.variantName, "--test-variant");
        if (!found.ok) {
            return found;
        }
        variant = found.variant;
    }

    const chosen = new Set<string>();
    for (const raw of input.dlcNames) {
        const found = findDlcByName(input.dlcs, raw);
        if (found === "ambiguous") {
            const ids = input.dlcs.filter(dlc => sameName(dlc.name, raw)).map(dlc => dlc.id).join(", ");
            return {
                ok: false,
                reason: `More than one DLC is called "${raw.trim()}". Name it by its id instead: ${ids}.`,
            };
        }
        if (!found) {
            return { ok: false, reason: unknownDlcReason(raw, input.dlcs, variant) };
        }
        if (!dlcAttachesToBuild(found.attachTo, variant.id)) {
            const attachedTo = allVariants.find(tag => dlcAttachesToBuild(found.attachTo, tag.id));
            return {
                ok: false,
                reason: `DLC "${found.name}" attaches to the ${attachedTo ? `"${attachedTo.name}"` : "another"} variant, not to "${variant.name}", so no player of "${variant.name}" can install it.`
                    + (attachedTo ? ` Run it with --test-variant=${quoteForLine(attachedTo.name)}.` : "")
                    + ` ${describeDlcFor(input.dlcs, variant)}`,
            };
        }
        chosen.add(found.id);
    }

    return {
        ok: true,
        edition: {
            variant: { id: variant.id, name: variant.name },
            // The project's order rather than the line's, so two lines naming the same DLC in a
            // different order are one build and log one sentence.
            dlc: input.dlcs.filter(dlc => chosen.has(dlc.id)).map(dlc => ({ id: dlc.id, name: dlc.name })),
        },
    };
}

/** Whether this is the build a line that named nothing runs. */
export function isDefaultTestEdition(edition: CommandLineTestEdition): boolean {
    return edition.variant.id === APP_TAG_ID_RELEASE && edition.dlc.length === 0;
}

/**
 * The two lines a headless run's game log carries about which build it is, beside the one about how
 * its content is held.
 *
 * Always both, including for the default: the log is the only record a job keeps of what was
 * tested, and "nothing about the variant" reads the same as "the line was never read".
 */
export function testEditionLogLines(edition: CommandLineTestEdition): [string, string] {
    const variant = edition.variant.id === APP_TAG_ID_RELEASE
        ? `variant: ${edition.variant.name}, the release build`
        : `variant: "${edition.variant.name}" (--test-variant)`;
    const dlc = edition.dlc.length === 0
        ? "DLC: none"
        : `DLC: ${edition.dlc.map(part => `"${part.name}"`).join(", ")} (--test-dlc)`;
    return [variant, dlc];
}

/** How the run's first line describes a build that is not the default, or "" for the default. */
export function describeTestEdition(edition: CommandLineTestEdition): string {
    if (isDefaultTestEdition(edition)) {
        return "";
    }
    const dlc = edition.dlc.length === 0
        ? ""
        : ` with DLC ${edition.dlc.map(part => `"${part.name}"`).join(", ")}`;
    return edition.variant.id === APP_TAG_ID_RELEASE
        ? dlc.trimStart()
        : `as variant "${edition.variant.name}"${dlc}`;
}

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A DLC by the name its author gave it, or by its id when no name matches.
 *
 * The name first because it is what the project's own panels lead with. The id second because it
 * is author-chosen and names the shipped file, so it is a word the author knows too - and the only
 * way to reach one DLC of two a hand edit gave the same name.
 */
function findDlcByName(dlcs: readonly ProjectDlc[], raw: string): ProjectDlc | "ambiguous" | null {
    const byName = dlcs.filter(dlc => sameName(dlc.name, raw));
    if (byName.length > 1) {
        return "ambiguous";
    }
    if (byName.length === 1) {
        return byName[0];
    }
    const id = raw.trim().toLowerCase();
    return dlcs.find(dlc => dlc.id === id) ?? null;
}

function unknownDlcReason(raw: string, dlcs: readonly ProjectDlc[], variant: ProjectAppTag): string {
    const named = `The project has no DLC "${raw.trim()}".`;
    if (dlcs.length === 0) {
        return `${named} It has none, so --test-dlc has nothing to install.`;
    }
    return `${named} ${describeDlcFor(dlcs, variant)}`;
}

/** The DLC a run of this variant may name, as a sentence. */
function describeDlcFor(dlcs: readonly ProjectDlc[], variant: ProjectAppTag): string {
    const valid = dlcs.filter(dlc => dlcAttachesToBuild(dlc.attachTo, variant.id));
    if (valid.length === 0) {
        return `No DLC attaches to "${variant.name}".`;
    }
    // Each with its id beside it: the id is author-chosen, names the shipped file, and is what
    // tells two similar names apart - and it is accepted on the line as well as the name.
    return `DLC for "${variant.name}": ${valid.map(dlc => `${dlc.name} (${dlc.id})`).join(", ")}.`;
}
