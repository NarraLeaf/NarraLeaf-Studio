/**
 * A build variant named on a command line, found in the project's own list.
 *
 * `--build-variant` and `--test-variant` ask the same question - which of this project's variants
 * did the line mean - so they answer it with one function and refuse with the same sentences. A
 * build agent that runs a build and a test of the same variant writes the same word twice.
 *
 * # Names, not ids
 *
 * A variant's id is a generated uuid that no author has ever seen and no surface of Studio shows, so
 * a line that had to carry one would be a line nobody could write without opening the project's
 * files. A variant is named by the name its author gave it in **Project ▸ App**, matched without
 * regard to case; the release build is `main`, which is its name in every language.
 *
 * The stored id is not a second spelling. A value that happens to be one is refused, and the refusal
 * says what that variant is called - so a line written against the id learns the word to use in the
 * same second, rather than a run quietly depending on something the interface never shows. Nothing
 * shipped ever wrote the id form down (the documented value was always `main`), so there is nothing
 * for this to keep working.
 *
 * Pure over the stored list, so every refusal is decided without a project on disk; the caller reads
 * the document (`appTagsFile.ts`) and decides what an unreadable one means.
 */

import {
    findAppTagByName,
    listAppTags,
    RELEASE_APP_TAG,
    type ProjectAppTag,
} from "@shared/types/appTag";

/** The two flags that name a variant. The refusals name the flag the line used. */
export type CommandLineVariantFlag = "--build-variant" | "--test-variant";

export type CommandLineVariantResult =
    | { ok: true; variant: ProjectAppTag }
    | { ok: false; reason: string };

/**
 * Whether this name is the release build's, which needs no document to answer.
 *
 * The release variant is synthesized rather than stored, and its name is reserved - no author
 * variant can be called `main` - so a line that names it, like a line that names nothing, must not
 * be refused because the variants document is unreadable.
 */
export function namesReleaseVariant(name: string): boolean {
    return findAppTagByName([RELEASE_APP_TAG], name) === RELEASE_APP_TAG;
}

export function findCommandLineVariant(
    stored: readonly ProjectAppTag[],
    name: string,
    flag: CommandLineVariantFlag,
): CommandLineVariantResult {
    const all = listAppTags(stored);
    const found = findAppTagByName(all, name);
    if (found === "ambiguous") {
        // Only a hand-edited document can get here: every surface that names a variant numbers a
        // second one rather than letting two share a name.
        return {
            ok: false,
            reason: `More than one build variant is called "${name.trim()}", so ${flag} cannot tell them apart. Rename one in Project ▸ App.`,
        };
    }
    if (found) {
        return { ok: true, variant: found };
    }
    // Deliberately without the value itself: it is the one string this refusal must not teach.
    const byId = stored.find(tag => tag.id === name.trim());
    if (byId) {
        return {
            ok: false,
            reason: `${flag} names a variant by its name, not by the id it is stored under. That one is called "${byId.name}": write ${flag}=${quoteForLine(byId.name)}.`,
        };
    }
    return {
        ok: false,
        reason: `The project has no build variant "${name.trim()}". It has: ${all.map(tag => tag.name).join(", ")}.`,
    };
}

/**
 * A name as a command line would carry it: bare when it is one word, quoted when it is not.
 *
 * Only for the suggestion in a refusal - a remedy that cannot be pasted back is half a remedy.
 */
export function quoteForLine(name: string): string {
    return /^[\w.-]+$/.test(name) ? name : `"${name}"`;
}
