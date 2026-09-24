import { useEffect, useMemo, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import type { AssetNameEntry, DocumentNameContext, DocumentNameSource } from "./documentName";
import { NO_DOCUMENT_NAMES } from "./documentName";
import { comparisonSideKey, type ComparisonSide, type ComparisonSides } from "./presenters/comparisonSide";

/**
 * Where the names of things stored under ids come from, and which version of them a comparison
 * believes.
 *
 * Three kinds of thing are stored in a file named after an id, and none of them carries its own name
 * where the path can reach it. A story's title is a field of its entry in `editor/story/index.json` -
 * the list the story panel draws. A motion's is in `editor/story/animations/index.json`. An asset's is
 * a field of its record in `assets/assets.metadata.<type>.json`, one shard per type, while its bytes
 * sit at a shard of its id. So putting any of their own names on a row means reading a **sibling**
 * that is very often not part of the comparison at all: editing one line of a scene changes the story
 * and leaves the index untouched, and replacing a picture's bytes leaves its record alone.
 *
 * ## Which side the sibling is read from
 *
 * **The newer side first, the older side only for what the newer one no longer names.**
 *
 * Two versions of a library can disagree, and they disagree in exactly two ways. A thing was
 * renamed, in which case the newer name is the one the author is looking for - they are reading a
 * comparison in order to decide what to do next, and next is the state the newer side is in. Or a
 * thing was deleted, in which case the newer library does not name it at all and the only name that
 * exists is the older one; dropping to "Story" or "Image asset" there would hide the name of the very
 * thing whose removal is being reviewed. So the newer side wins where both answer, and the older side
 * answers where the newer one is silent.
 *
 * Naming a removed thing after the older library is not a claim about the present: the row it names
 * is already marked as a removal, so the name reads as what the thing was called, which is what it
 * was called.
 *
 * ## What is not done, and why
 *
 * **The workspace's own libraries are not consulted**, though they are in memory and free. They are
 * the working tree's, and not even that while the workspace is frozen showing a past revision - so a
 * comparison between two old versions would be named from a third one, and an author would be shown
 * names that belong to neither side of what they are reading. One small read per library per side is
 * the price of the answer being about the comparison.
 *
 * **Nothing is invented when a read fails.** A missing library, an unreadable one, or a file past the
 * read ceiling all end as an empty map, and `documentName.ts` turns that into a stand-in for what the
 * thing is rather than into a name.
 */

/** The library a story's title is read from. */
export const STORY_INDEX_PATH = "editor/story/index.json";

/** The library a motion's name is read from. */
export const ANIMATION_INDEX_PATH = "editor/story/animations/index.json";

/** One metadata shard per asset type. Every one is read: a content path does not say its type. */
const ASSET_METADATA_SHARDS: readonly { readonly type: string; readonly path: string }[] =
    Object.values(AssetType).map(type => ({ type, path: `assets/assets.metadata.${type}.json` }));

/** Every library, for a caller that has not said which it needs. */
const ALL_SOURCES: ReadonlySet<DocumentNameSource> = new Set<DocumentNameSource>(["stories", "animations", "assets"]);

/**
 * The titles inside a story index, or nothing this can be sure of.
 *
 * Deliberately tolerant. What is read here is the two fields the library entry has always had, and
 * an entry missing either of them is skipped rather than guessed at - a story with no title in the
 * index is a story this pass cannot name, which is a state `documentName.ts` already words honestly.
 */
export function parseStoryTitles(text: string): ReadonlyMap<string, string> {
    return parseLibraryNames(text, "stories");
}

/** The names inside the motion library, on the same terms as {@link parseStoryTitles}. */
export function parseAnimationNames(text: string): ReadonlyMap<string, string> {
    return parseLibraryNames(text, "animations");
}

/**
 * The records inside one asset metadata shard, as names by lower-cased storage id.
 *
 * A record with a blank name is KEPT, with its type: the type is then the difference between "Image
 * asset" and "Asset file", and it is true. A record that is not an object is skipped, which is what
 * the asset panel's own reader does with one (`AssetsMetadataManager.assignValidAssets`).
 */
export function parseAssetNames(text: string, type: string): ReadonlyMap<string, AssetNameEntry> {
    const names = new Map<string, AssetNameEntry>();
    const parsed = parseJson(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return names;
    }
    for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof record !== "object" || record === null || id.length === 0) {
            continue;
        }
        const name = (record as { name?: unknown }).name;
        const key = id.toLowerCase();
        // First wins, for `joinAssetEntries`' reason: two records cannot honestly name one file, and
        // a later one overwriting the earlier would make the name depend on key order.
        if (!names.has(key)) {
            names.set(key, { name: typeof name === "string" ? name : "", type });
        }
    }
    return names;
}

/**
 * Fold two sides' names into one lookup, newer first.
 *
 * Separated from the read so the rule above can be tested without a workspace behind it - it is the
 * half of this module that decides something, and the read is the half that is merely IPC.
 */
export function mergeDocumentNames(newer: DocumentNameContext, older: DocumentNameContext): DocumentNameContext {
    return {
        storyTitles: newerFirst(newer.storyTitles, older.storyTitles),
        animationNames: newerFirst(newer.animationNames, older.animationNames),
        assetNames: newerFirst(newer.assetNames, older.assetNames),
    };
}

/**
 * What a list of paths is named from, kept current.
 *
 * `sources` limits the read to the libraries those paths need - see `documentNameSourcesFor` - and
 * defaults to all of them, for a surface that reads its names before it knows its paths so that the
 * rows arrive already named. `refreshKey` is whatever says the surface has looked again: the names
 * are read once per key, and a surface whose rows can be renamed underneath it (the working tree)
 * passes something that changes whenever it re-reads, so a rename or an import is named on the
 * next look rather than on the next mount.
 *
 * The names read last stay in place while a new read is in flight, so a refresh does not flash
 * every row back to its stand-in for a frame.
 */
export function useDocumentNames(
    sides: ComparisonSides | null,
    options: { readonly sources?: ReadonlySet<DocumentNameSource>; readonly refreshKey?: unknown } = {},
): DocumentNameContext {
    // Optional, and guarded on the service set rather than on the context: this hook is mounted by
    // the version rail as well as by a comparison, and both render in windows - and in tests - that
    // carry only part of the workspace. A context with no services names nothing, which is the same
    // answer a failed read gives and one every consumer already handles.
    const context = useOptionalWorkspace()?.context ?? null;
    const [names, setNames] = useState<DocumentNameContext | null>(null);

    const service = useMemo(
        () => (context?.services ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    const newerKey = comparisonSideKey(sides?.after ?? null);
    const olderKey = comparisonSideKey(sides?.before ?? null);
    const sourcesKey = [...(options.sources ?? ALL_SOURCES)].sort().join(",");
    const { refreshKey } = options;

    useEffect(() => {
        if (!service || !sides) {
            setNames(null);
            return;
        }
        let cancelled = false;
        void readDocumentNames(service, sides, options.sources).then(read => {
            if (!cancelled) {
                setNames(read);
            }
        });
        return () => {
            cancelled = true;
        };
        // The sides and sources themselves are excluded for `useSideDocument`'s reason: they are
        // written as literals at call sites, and the keys carry everything about them that changes
        // a read.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, newerKey, olderKey, sourcesKey, refreshKey]);

    return names ?? NO_DOCUMENT_NAMES;
}

/**
 * The names for a pair of sides, read once and not kept up to date.
 *
 * {@link useDocumentNames} is this same answer maintained for a surface that is on screen; this is
 * the answer at a moment, for a caller that is not a component. The sync that has just ended in
 * conflicts is one: it names the documents it is about to report and then never asks again, and
 * mounting a hook for that would put a library read behind every rail, status entry and team badge
 * that happens to use the same surface.
 */
export async function readDocumentNames(
    service: VersionControlService,
    sides: ComparisonSides,
    sources: ReadonlySet<DocumentNameSource> = ALL_SOURCES,
): Promise<DocumentNameContext> {
    if (sources.size === 0) {
        return NO_DOCUMENT_NAMES;
    }
    const [newer, older] = await Promise.all([
        readSide(service, sides.after, sources),
        readSide(service, sides.before, sources),
    ]);
    return mergeDocumentNames(newer, older);
}

/** Every library one side holds, among the ones asked for. */
async function readSide(
    service: VersionControlService,
    side: ComparisonSide | null,
    sources: ReadonlySet<DocumentNameSource>,
): Promise<DocumentNameContext> {
    if (!side) {
        return NO_DOCUMENT_NAMES;
    }
    const paths = [
        ...(sources.has("stories") ? [STORY_INDEX_PATH] : []),
        ...(sources.has("animations") ? [ANIMATION_INDEX_PATH] : []),
        ...(sources.has("assets") ? ASSET_METADATA_SHARDS.map(shard => shard.path) : []),
    ];
    const texts = await readLibraries(service, side, paths);
    const textOf = (path: string) => texts.get(path) ?? null;

    const storyIndex = textOf(STORY_INDEX_PATH);
    const animationIndex = textOf(ANIMATION_INDEX_PATH);
    const assetNames = new Map<string, AssetNameEntry>();
    for (const shard of ASSET_METADATA_SHARDS) {
        const text = textOf(shard.path);
        if (text === null) {
            continue;
        }
        for (const [id, entry] of parseAssetNames(text, shard.type)) {
            if (!assetNames.has(id)) {
                assetNames.set(id, entry);
            }
        }
    }
    return {
        storyTitles: storyIndex === null ? new Map() : parseStoryTitles(storyIndex),
        animationNames: animationIndex === null ? new Map() : parseAnimationNames(animationIndex),
        assetNames,
    };
}

/**
 * The libraries at one side, as text by path; a path with no answer is simply absent.
 *
 * A revision is read in ONE round trip (`readRevisionDocuments`), for the reason that method exists:
 * each per-path read of a revision is queued behind the project's other repository calls, and on a
 * project with a remote may go to the network. The working tree is read file by file, which is a
 * plain read off disk and queues behind nothing.
 *
 * Every failure is the same answer on purpose. A library is absent from a revision that predates the
 * project having one, a shard is absent for a type the project never imported, and the read itself
 * can fail - and none of those is a story this surface should report, because the row it would be
 * reported on is about a different file entirely. What it costs is a name, and the absence of a name
 * is already said out loud on the row.
 */
async function readLibraries(
    service: VersionControlService,
    side: ComparisonSide,
    paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
    const texts = new Map<string, string>();
    if (paths.length === 0) {
        return texts;
    }
    if (side.at === "revision") {
        try {
            for (const [path, text] of await service.readRevisionDocuments(side.revision, paths)) {
                if (text !== null) {
                    texts.set(path, text);
                }
            }
        } catch {
            // Nothing read; see above.
        }
        return texts;
    }
    const decoder = new TextDecoder();
    await Promise.all(paths.map(async path => {
        try {
            const bytes = await service.readWorkingFile(path);
            if (bytes !== null) {
                texts.set(path, decoder.decode(bytes));
            }
        } catch {
            // Absent or unreadable; see above.
        }
    }));
    return texts;
}

/** `{ <listKey>: [{ id, name }, …] }` as names by id; the story and motion libraries share it. */
function parseLibraryNames(text: string, listKey: "stories" | "animations"): ReadonlyMap<string, string> {
    const names = new Map<string, string>();
    const parsed = parseJson(text);
    if (typeof parsed !== "object" || parsed === null) {
        return names;
    }
    const entries = (parsed as Record<string, unknown>)[listKey];
    if (!Array.isArray(entries)) {
        return names;
    }
    for (const entry of entries) {
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
        // First wins, for `joinAssetEntries`' reason: two entries cannot honestly name one thing, and
        // a later one overwriting the earlier would make the name depend on file order.
        if (!names.has(id)) {
            names.set(id, name);
        }
    }
    return names;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function newerFirst<V>(newer: ReadonlyMap<string, V>, older: ReadonlyMap<string, V>): ReadonlyMap<string, V> {
    const merged = new Map(older);
    for (const [id, value] of newer) {
        merged.set(id, value);
    }
    return merged;
}
