import { useEffect, useMemo, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import type { DocumentNameContext } from "./documentName";
import { NO_DOCUMENT_NAMES } from "./documentName";
import { comparisonSideKey, type ComparisonSide, type ComparisonSides } from "./presenters/comparisonSide";

/**
 * Where a story's title comes from, and which version of it a comparison believes.
 *
 * A story document holds the story; it does not hold the story's place in the project. The title
 * the author typed is a field of the library entry in `editor/story/index.json` - the list the
 * story panel draws - so putting a scene's own name on its row means reading a **sibling** document
 * that is very often not part of the comparison at all: renaming nothing and editing one line
 * changes the story and leaves the index untouched.
 *
 * ## Which side the sibling is read from
 *
 * **The newer side first, the older side only for what the newer one no longer names.**
 *
 * Two versions of the index can disagree, and they disagree in exactly two ways. A story was
 * renamed, in which case the newer title is the one the author is looking for - they are reading a
 * comparison in order to decide what to do next, and next is the state the newer side is in. Or a
 * story was deleted, in which case the newer index does not name it at all and the only title that
 * exists is the older one; dropping to "Story" plus an id there would hide the name of the very
 * thing whose removal is being reviewed. So the newer side wins where both answer, and the older
 * side answers where the newer one is silent.
 *
 * Naming a removed story after the older index is not a claim about the present: the row it names
 * is already marked as a removal, so the title reads as what the thing was called, which is what it
 * was called.
 *
 * ## What is not done, and why
 *
 * **The workspace's own story list is not consulted**, though it is in memory and free. It is the
 * working tree's list, and it is not even that while the workspace is frozen showing a past
 * revision - so a comparison between two old versions would be titled from a third one, and an
 * author would be shown names that belong to neither side of what they are reading. One small read
 * per side is the price of the answer being about the comparison.
 *
 * **Nothing is invented when the read fails.** A missing index, an unreadable one, or a file past
 * the read ceiling all end as an empty map, and `documentName.ts` turns that into "Story" plus the
 * id from the path rather than into a name.
 */

/** The one document a story's title can be read from. */
export const STORY_INDEX_PATH = "editor/story/index.json";

/**
 * The titles inside a story index, or nothing this can be sure of.
 *
 * Deliberately tolerant, and deliberately not a document spec. No spec claims this path, so the
 * comparison itself reads the file as bytes; adding one to get a title would change how every
 * change inside the index is reported, which is a different decision from naming a row. What is
 * read here is the two fields the library entry has always had, and an entry missing either of them
 * is skipped rather than guessed at - a story with no title in the index is a story this pass
 * cannot name, which is a state `documentName.ts` already words honestly.
 */
export function parseStoryTitles(bytes: Uint8Array): ReadonlyMap<string, string> {
    const titles = new Map<string, string>();
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return titles;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return titles;
    }
    const stories = (parsed as { stories?: unknown }).stories;
    if (!Array.isArray(stories)) {
        return titles;
    }
    for (const entry of stories) {
        if (typeof entry !== "object" || entry === null) {
            continue;
        }
        const { id, name } = entry as { id?: unknown; name?: unknown };
        if (typeof id !== "string" || id.length === 0) {
            continue;
        }
        if (typeof name !== "string" || name.trim().length === 0) {
            continue;
        }
        // First wins, for `joinAssetEntries`' reason: two entries cannot honestly name one story,
        // and a later one overwriting the earlier would make the title depend on file order.
        if (!titles.has(id)) {
            titles.set(id, name);
        }
    }
    return titles;
}

/**
 * Fold two sides' story indexes into one lookup, newer first.
 *
 * Separated from the read so the rule above can be tested without a workspace behind it - it is the
 * half of this module that decides something, and the read is the half that is merely IPC.
 */
export function mergeStoryTitles(
    newer: ReadonlyMap<string, string>,
    older: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
    const merged = new Map(older);
    for (const [id, title] of newer) {
        merged.set(id, title);
    }
    return merged;
}

/**
 * The names the rows of a comparison should carry.
 *
 * Reads once per pair of sides. `null` sides - a surface that has no comparison to read against -
 * is not an error and not a loading state: it is a context that names nothing, which every consumer
 * already handles because it is the same context a failed read produces.
 */
export function useDocumentNames(sides: ComparisonSides | null): DocumentNameContext {
    // Optional, and guarded on the service set rather than on the context: this hook is mounted by
    // the version rail as well as by a comparison, and both render in windows - and in tests - that
    // carry only part of the workspace. A context with no services names nothing, which is the same
    // answer a failed read gives and one every consumer already handles.
    const context = useOptionalWorkspace()?.context ?? null;
    const [titles, setTitles] = useState<ReadonlyMap<string, string> | null>(null);

    const service = useMemo(
        () => (context?.services ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    const newerKey = comparisonSideKey(sides?.after ?? null);
    const olderKey = comparisonSideKey(sides?.before ?? null);

    useEffect(() => {
        if (!service || !sides) {
            setTitles(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const [newer, older] = await Promise.all([
                readStoryTitles(service, sides.after),
                readStoryTitles(service, sides.before),
            ]);
            if (!cancelled) {
                setTitles(mergeStoryTitles(newer, older));
            }
        })();
        return () => {
            cancelled = true;
        };
        // The sides themselves are excluded for `useSideDocument`'s reason: they are written as
        // object literals at every call site, and the two keys carry everything about them that
        // changes a read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, newerKey, olderKey]);

    return useMemo(() => (titles ? { storyTitles: titles } : NO_DOCUMENT_NAMES), [titles]);
}

/**
 * The names for one side, read once and not kept up to date.
 *
 * {@link useDocumentNames} is this same answer maintained for a surface that is on screen; this is
 * the answer at a moment, for a caller that is not a component. The sync that has just ended in
 * conflicts is the one so far: it names the documents it is about to report and then never asks
 * again, and mounting a hook for that would put a story-index read behind every rail, status entry
 * and team badge that happens to use the same surface.
 */
export async function readDocumentNames(
    service: VersionControlService,
    side: ComparisonSide | null,
): Promise<DocumentNameContext> {
    const titles = await readStoryTitles(service, side);
    return titles.size === 0 ? NO_DOCUMENT_NAMES : { storyTitles: titles };
}

/**
 * One side's story index, or an empty map.
 *
 * Every failure is the same answer on purpose. The index is absent from a revision that predates
 * the project having one, it is past the read ceiling on nothing anybody has built, and the read
 * itself can fail - and none of those is a story this surface should report, because the row it
 * would be reported on is about a different file entirely. What it costs is the title, and the
 * absence of a title is already said out loud on the row.
 */
async function readStoryTitles(
    service: VersionControlService,
    side: ComparisonSide | null,
): Promise<ReadonlyMap<string, string>> {
    if (!side) {
        return new Map();
    }
    try {
        const bytes = side.at === "revision"
            ? await service.readBlob(side.revision, STORY_INDEX_PATH)
            : await service.readWorkingFile(STORY_INDEX_PATH);
        return bytes === null ? new Map() : parseStoryTitles(bytes);
    } catch {
        return new Map();
    }
}
