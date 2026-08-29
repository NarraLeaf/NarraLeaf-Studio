import {
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    type StoryLibraryEntry,
    type StoryLibraryIndex,
} from "@shared/types/story/document";
import type {DocumentChangeLabel, DocumentMerge3, DocumentMergeDecision} from "../diff";
import {defineDocumentSpec} from "../registry";
import type {DocumentParseContext} from "../types";
import {authoredName} from "./diffHelpers";
import {
    byKey,
    countConflicts,
    decision,
    keyedRowLabel,
    type KeyedMergeRow,
    labelled,
    mergeKeyed,
    stripFields,
} from "./mergeHelpers";
import {isJsonObject, rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/story/index.json` - the story library: which stories this project has, what they are
 * called, and which one the game starts from.
 *
 * **Written because of what its absence did to a merge, not for the comparison.** Until this spec
 * existed the library was a file no format claimed, so two copies of a project that had diverged at
 * all could only settle it by taking one side of the whole file - and it diverged on *every*
 * divergent edit, because {@link StoryLibraryEntry.updatedAt} moves whenever a story is saved.
 * Measured on two machines: two authors each editing one scene's description, in different stories,
 * produced a whole-file conflict whose two sides differed by a timestamp and nothing else. The
 * author was asked to choose a side of a list that holds every story's name, over a field they had
 * not touched, and picking either one would have lost any story the other side had added.
 *
 * The second cost was invisible until the first was found: a conflicted index is an index that
 * cannot be parsed, and the merge surface reads story titles out of it (`storyTitles.ts`). So every
 * story in the resolution panel was drawn as `Story (48bb82a5-...)` while the version rail beside it
 * called the same story `Harbour`. Both halves are the same gap, and this closes both.
 *
 * **Read-side, like `story` was.** `StoryService` owns the editor's reading and writing and keeps
 * doing so - it writes with `JSON.stringify(index, null, 2)` where {@link storyIndexSpec.serialize}
 * writes canonical bytes, so an index settled through the conflict resolver is re-written in
 * insertion order by the next save of it: a one-time whole-file diff, the same one `story.ts`
 * documents. What `parse` here is NOT is the loader: `normalizeStoryLibraryIndex` lives in the
 * renderer, takes a clock, and repairs things (a default naming a story that is gone, a
 * `documentPath` that disagrees with its id). Running it here would make `parse` a function of more
 * than its bytes, which is exactly what `story.ts` had to undo. So this is a shape gate, and repair
 * stays where it is - the loader applies it to whatever a merge writes, on the next open.
 */
export const STORY_INDEX_DOCUMENT_PATH = "editor/story/index.json";

export const storyIndexSpec = defineDocumentSpec<StoryLibraryIndex>({
    kind: "story-index",
    version: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    paths: [STORY_INDEX_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a story library index");
        rejectNewerSchema(record, context, STORY_LIBRARY_INDEX_SCHEMA_VERSION);
        requireStoryEntries(record, context);
        return record as unknown as StoryLibraryIndex;
    },
    // No authored name: there is one library per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "stories", value: Array.isArray(document.stories) ? document.stories.length : 0}],
    }),
    merge3: merge3StoryIndex,
});

/**
 * The shape checks that stand between a hand-edited file and a merge settling nonsense.
 *
 * Only the two that would change what a merge *means*: `stories` has to be a list, and each entry
 * has to carry a string `id`, because the id is the key everything below is addressed by. An entry
 * without one cannot be merged against its counterpart, cannot be pointed at by a decision, and
 * would be silently dropped by the renderer's normalizer on the next load - so a file carrying one
 * is reported rather than half-merged. Everything else about an entry is the loader's business.
 */
function requireStoryEntries(record: Record<string, unknown>, context: DocumentParseContext): void {
    const stories = record.stories;
    if (stories === undefined) {
        return;
    }
    if (!Array.isArray(stories)) {
        context.corrupt(`"stories" must be an array, got ${describe(stories)}`);
        return;
    }
    for (const [at, entry] of stories.entries()) {
        if (!isJsonObject(entry)) {
            context.corrupt(`story ${at} must be an object, got ${describe(entry)}`);
            continue;
        }
        if (typeof entry.id !== "string" || entry.id.length === 0) {
            context.corrupt(`story ${at} has no "id", which is what every other copy matches it by`);
        }
    }
}

const LABEL = {
    added: "documentDiff.storyIndex.added",
    removed: "documentDiff.storyIndex.removed",
    changed: "documentDiff.storyIndex.changed",
    renamed: "documentDiff.storyIndex.renamed",
    entryField: "documentDiff.storyIndex.entryField",
    defaultStory: "documentDiff.storyIndex.defaultStory",
    documentField: "documentDiff.storyIndex.documentField",
} as const;

/**
 * Handled explicitly below, so they never reach the generic document-field merge.
 *
 * `meta` is the library's own two timestamps, taken from mine with no row for the reason the mixer
 * takes its `meta` that way: a pair of clock readings is not something an author decided between.
 */
const DOCUMENT_SKIP = new Set(["stories", "schemaVersion", "meta"]);

/**
 * `id` is the key an entry is matched and addressed by, so it is never a field to choose.
 *
 * ⚠ **And `updatedAt` is the whole reason this spec exists.** It is a *copy* of the story
 * document's `meta.updatedAt`, stamped by `StoryService` whenever that document reaches the disk,
 * and - in the service's own words - nothing in Studio reads the copy. Two sides that both saved
 * the same story therefore hold two different stamps for a story neither of them changed, which as
 * a whole-entry comparison is a conflict over a field no author touched. Left out of the comparison
 * it is not a difference at all, and the entry merges with nothing to decide.
 *
 * The merged entry keeps **mine's** stamp rather than the later of the two, and that is deliberate:
 * the stamp claims "this mirrors a document saved at T", and which side's story document survives
 * the merge is settled separately, per record, in `storyMerge3`. Taking theirs because it is newer
 * would make the claim more likely to be false, not less. The service re-stamps it from the
 * document on the next save either way.
 */
const ENTRY_SKIP = new Set(["id", "updatedAt"]);

/**
 * Three-way merge of the story library - one decision per story, addressed by the story's id.
 *
 * The list is a list on disk and a keyed collection to a merge, exactly as the mixer's tracks are:
 * position is not identity, so nothing here lines two entries up by where they sit, and the
 * decisions are `stories/<id>` which `applyMergeDecisions` addresses by id.
 *
 * **Order is mine's, then the stories only theirs has.** Appended, never interleaved. Two people
 * who each made a story have not disagreed about where in the list anything belongs, and Studio has
 * no reorder gesture for this list at all - its order is the order stories were created, plus
 * whatever position an undone deletion restores one to.
 *
 * **A story both sides changed is merged field by field**, which is what makes two people renaming
 * two different stories, or one renaming while the other moves one into a DLC, a merge with nothing
 * to ask. Whole-entry decisions are kept for the cases where fields cannot be addressed: a story
 * one side added, one side deleted, or one that arrived with no common ancestor to compare against.
 */
export function merge3StoryIndex(
    base: StoryLibraryIndex | undefined,
    mine: StoryLibraryIndex,
    theirs: StoryLibraryIndex,
): DocumentMerge3<StoryLibraryIndex> {
    const decisions: DocumentMergeDecision[] = [];

    // `defaultStoryId` and anything a newer Studio put beside it. `undefined` rather than `{}` when
    // there is no base, for `mergeKeyed`'s own reason: an empty base reads "only one side has this"
    // as a deletion nobody made.
    const fields = mergeKeyed(
        base ? stripFields(base, DOCUMENT_SKIP) : undefined,
        stripFields(mine, DOCUMENT_SKIP),
        stripFields(theirs, DOCUMENT_SKIP),
    );
    for (const row of byKey(fields.rows)) {
        decisions.push(decision([row.key], row, {label: documentFieldLabel(row)}));
    }

    const baseStories = byStoryId(base?.stories);
    const mineStories = byStoryId(mine.stories);
    const theirsStories = byStoryId(theirs.stories);
    const merged = mergeKeyed(base ? baseStories : undefined, mineStories, theirsStories);
    const stories: Record<string, StoryLibraryEntry> = {...merged.merged};

    for (const row of merged.rows) {
        const path = ["stories", row.key];
        const inBase = baseStories[row.key];
        const inMine = mineStories[row.key];
        const inTheirs = theirsStories[row.key];

        // Both sides changed a story that existed before - the only case there is anything inside to
        // merge, and the case a stamp-only difference lands in.
        if (row.outcome === "conflict" && base && inBase && inMine && inTheirs) {
            const entry = mergeEntry(row.key, inBase, inMine, inTheirs);
            stories[row.key] = entry.entry;
            decisions.push(...entry.decisions);
            continue;
        }

        decisions.push(decision(path, row, {
            label: keyedRowLabel(row, LABEL),
            subject: entrySubject(row),
        }));
    }

    const document = {
        ...fields.merged,
        schemaVersion: mine.schemaVersion,
        stories: Object.values(stories),
        ...(mine.meta === undefined ? {} : {meta: mine.meta}),
    } as unknown as StoryLibraryIndex;

    return {document, decisions, conflicts: countConflicts(decisions)};
}

/** One story both sides edited: merge its fields, and put back the two that are not fields. */
function mergeEntry(
    storyId: string,
    base: StoryLibraryEntry,
    mine: StoryLibraryEntry,
    theirs: StoryLibraryEntry,
): {entry: StoryLibraryEntry; decisions: DocumentMergeDecision[]} {
    const fields = mergeKeyed(
        stripFields(base, ENTRY_SKIP),
        stripFields(mine, ENTRY_SKIP),
        stripFields(theirs, ENTRY_SKIP),
    );
    const subject = authoredName(mine.name) ?? authoredName(theirs.name) ?? authoredName(base.name);
    const decisions = byKey(fields.rows).map(row => decision(["stories", storyId, row.key], row, {
        label: entryFieldLabel(row),
        ...(subject ? {subject} : {}),
    }));

    return {
        entry: {...fields.merged, id: storyId, updatedAt: mine.updatedAt} as unknown as StoryLibraryEntry,
        decisions,
    };
}

/** The stories of one side, by id. A list with no ids left is a list `parse` already refused. */
function byStoryId(stories: readonly StoryLibraryEntry[] | undefined): Record<string, StoryLibraryEntry> {
    const out: Record<string, StoryLibraryEntry> = {};
    for (const entry of Array.isArray(stories) ? stories : []) {
        if (entry && typeof entry.id === "string" && entry.id.length > 0) {
            out[entry.id] = entry;
        }
    }
    return out;
}

/** The author's own word for the story a whole-entry row is about, from whichever side has it. */
function entrySubject(row: KeyedMergeRow<StoryLibraryEntry>): string | undefined {
    const present = (row.mine.present ? row.mine.value : undefined) ?? row.theirs.value ?? row.base.value;
    return authoredName((present as StoryLibraryEntry | undefined)?.name);
}

function documentFieldLabel(row: KeyedMergeRow<unknown>): DocumentChangeLabel {
    return row.key === "defaultStoryId"
        ? labelled(LABEL.defaultStory)
        : labelled(LABEL.documentField, {field: row.key});
}

/**
 * A renamed story is worth its own sentence; everything else quotes the field.
 *
 * `dlcId`, `importSource` and `exportMeta` have no authored word between them - "the DLC this ships
 * in" is a phrase, not a name the author typed - so the raw identifier is the honest thing to show,
 * the way the story document's own field rows do it.
 */
function entryFieldLabel(row: KeyedMergeRow<unknown>): DocumentChangeLabel {
    return row.key === "name" ? labelled(LABEL.renamed) : labelled(LABEL.entryField, {field: row.key});
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
