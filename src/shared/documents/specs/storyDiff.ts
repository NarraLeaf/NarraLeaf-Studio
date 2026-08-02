import type {
    StoryBlock,
    StoryChapter,
    StoryDocument,
    StoryScene,
} from "@shared/types/story/document";
import {listSceneBlocksInDocumentOrder, listSceneIdsInDocumentOrder} from "@shared/types/story/order";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {authoredName, byId, change, diffKeyed, fromToParams, previewValue, sameJsonValue} from "./diffHelpers";

/**
 * What changed in a story, in the units the author wrote it in: scenes and rows.
 *
 * Everything here rests on one fact about the format - **scenes and blocks are stored keyed by id** -
 * which makes matching them across two revisions exact and free. That is the difference between this
 * and the structural tier, which walks a document positionally and reports a row inserted at the top
 * of a scene as every row after it changing. Nothing is guessed at and no sequence is aligned by
 * similarity: either the id is on both sides or it is not.
 *
 * Two rules the shape of the output follows from, both from plan 2026-07-31-004 §4.3:
 *
 *  - **Different scenes are different rows.** A scene is the unit an author holds in their head and
 *    the unit a resolution will eventually be taken on, so it is the group; a row inside it is a
 *    leaf. Two levels, no deeper.
 *  - **An ordered array gets ONE row for the whole array.** `rootBlockIds`, `childrenIds`,
 *    `chapters[].sceneIds` - these are sequences the author arranged, and reporting them element by
 *    element produces a wall of index changes that says nothing and, when this list becomes a
 *    resolution, would offer to interleave two orderings into a third the author never wrote.
 *
 * Pure and non-throwing, per the `DocumentSpec.diff` contract, and defensive about every field: the
 * documents reaching it came out of a repository and may be older than the schema this build reads
 * (`storySpec.parse` does not migrate - see the note there), so nothing may assume a field exists.
 */

const LABEL = {
    renamed: "documentDiff.story.renamed",
    documentField: "documentDiff.story.documentField",
    chapterAdded: "documentDiff.story.chapterAdded",
    chapterRemoved: "documentDiff.story.chapterRemoved",
    chapterRenamed: "documentDiff.story.chapterRenamed",
    chapterScenes: "documentDiff.story.chapterScenes",
    chapterOrder: "documentDiff.story.chapterOrder",
    sceneAdded: "documentDiff.story.sceneAdded",
    sceneRemoved: "documentDiff.story.sceneRemoved",
    sceneChanged: "documentDiff.story.sceneChanged",
    sceneRenamed: "documentDiff.story.sceneRenamed",
    sceneField: "documentDiff.story.sceneField",
    blockAdded: "documentDiff.story.blockAdded",
    blockRemoved: "documentDiff.story.blockRemoved",
    blockChanged: "documentDiff.story.blockChanged",
    blockMoved: "documentDiff.story.blockMoved",
    blockKind: "documentDiff.story.blockKind",
    blockDisabled: "documentDiff.story.blockDisabled",
    blockEnabled: "documentDiff.story.blockEnabled",
    blockField: "documentDiff.story.blockField",
    blockOrder: "documentDiff.story.blockOrder",
} as const;

/** Document-level scalars worth a row of their own. `scenes` and `chapters` have their own treatment. */
const DOCUMENT_FIELDS = ["entrySceneId", "unassignedSceneIds"] as const;

/** Scene fields compared one by one. `name` has its own label; `blocks` and `rootBlockIds` their own passes. */
const SCENE_FIELDS = [
    "runtimeName",
    "description",
    "defaultBackgroundAssetId",
    "bgm",
    "sceneSnapshots",
] as const;

export function diffStoryDocument(
    base: StoryDocument,
    head: StoryDocument,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];

    if (!sameJsonValue(base.name, head.name)) {
        rows.push(change(["name"], "changed", LABEL.renamed, {
            params: fromToParams(base.name, head.name),
            subject: authoredName(head.name),
        }));
    }
    for (const field of DOCUMENT_FIELDS) {
        const left = (base as unknown as Record<string, unknown>)[field];
        const right = (head as unknown as Record<string, unknown>)[field];
        if (!sameJsonValue(left, right)) {
            rows.push(change([field], "changed", LABEL.documentField, {params: {field}}));
        }
    }

    rows.push(...chapterRows(base, head));
    rows.push(...sceneRows(base, head));

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/**
 * Chapters, which are an ordered array of named things.
 *
 * So they get both treatments: a row per chapter that appeared, went or changed (matched by id), and
 * at most one row saying the chapters themselves were reordered.
 */
function chapterRows(base: StoryDocument, head: StoryDocument): DocumentChange[] {
    const rows: DocumentChange[] = [];
    const baseChapters = byId<StoryChapter>(base.chapters);
    const headChapters = byId<StoryChapter>(head.chapters);
    // A chapter's scene list is compared only over the scenes that exist on BOTH sides. Writing a
    // new scene adds it to a chapter, and reporting that as "the chapter's scenes changed" beside
    // "a scene was added" describes one act twice - and the second row is the less informative one.
    // What survives the filter is what the author really did to the chapter: reordering it, or
    // moving a scene into or out of it.
    const shared = sharedSceneIds(base, head);

    for (const entry of diffKeyed(baseChapters, headChapters)) {
        const path = ["chapters", entry.key];
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as StoryChapter;
            rows.push(change(path, entry.kind, entry.head ? LABEL.chapterAdded : LABEL.chapterRemoved, {
                subject: authoredName(present?.name),
            }));
            continue;
        }
        const name = authoredName(entry.head.name);
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            rows.push(change([...path, "name"], "changed", LABEL.chapterRenamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject: name,
            }));
        }
        // One row for the whole list, whatever moved inside it. A chapter's scene list is an
        // ordering the author arranged; per-index rows would be noise here and an invitation to
        // interleave two orderings when this same list becomes a resolution.
        const wasScenes = (entry.base.sceneIds ?? []).filter(sceneId => shared.has(sceneId));
        const nowScenes = (entry.head.sceneIds ?? []).filter(sceneId => shared.has(sceneId));
        if (!sameJsonValue(wasScenes, nowScenes)) {
            rows.push(change([...path, "sceneIds"], "changed", LABEL.chapterScenes, {
                params: {
                    from: (entry.base.sceneIds ?? []).length,
                    to: (entry.head.sceneIds ?? []).length,
                },
                subject: name,
            }));
        }
        if (!sameJsonValue(entry.base.meta, entry.head.meta)) {
            rows.push(change([...path, "meta"], "changed", LABEL.documentField, {
                params: {field: "meta"},
                subject: name,
            }));
        }
    }

    if (orderChanged(base.chapters, head.chapters)) {
        rows.push(change(["chapters"], "moved", LABEL.chapterOrder));
    }
    return rows;
}

/** The scene ids both documents hold - the only ones a chapter's ordering can be compared over. */
function sharedSceneIds(base: StoryDocument, head: StoryDocument): Set<string> {
    const baseScenes = (base.scenes ?? {}) as Record<string, unknown>;
    const headScenes = (head.scenes ?? {}) as Record<string, unknown>;
    return new Set(Object.keys(headScenes).filter(id => Object.prototype.hasOwnProperty.call(baseScenes, id)));
}

/** One row per scene, in the order the author reads them. */
function sceneRows(base: StoryDocument, head: StoryDocument): DocumentChange[] {
    const baseScenes = (base.scenes ?? {}) as Record<string, StoryScene>;
    const headScenes = (head.scenes ?? {}) as Record<string, StoryScene>;

    // Authoring order, from the head document and then from the base one, so a scene that was
    // deleted still lands near where it used to be rather than at the end. Scenes neither document
    // orders fall through to the keyed order, which is sorted and therefore stable.
    const rank = new Map<string, number>();
    for (const sceneId of orderedSceneIds(head)) {
        if (!rank.has(sceneId)) rank.set(sceneId, rank.size);
    }
    for (const sceneId of orderedSceneIds(base)) {
        if (!rank.has(sceneId)) rank.set(sceneId, rank.size);
    }

    const rows: {row: DocumentChange; rank: number}[] = [];
    for (const entry of diffKeyed(baseScenes, headScenes)) {
        const path = ["scenes", entry.key];
        const at = rank.get(entry.key) ?? Number.MAX_SAFE_INTEGER;
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as StoryScene;
            rows.push({
                rank: at,
                row: change(path, entry.kind, entry.head ? LABEL.sceneAdded : LABEL.sceneRemoved, {
                    subject: authoredName(present?.name),
                    // One row for a whole new scene, with the size of it in the label rather than a
                    // leaf per row it contains: the change the author made is "I wrote a scene".
                    params: {blocks: Object.keys(present?.blocks ?? {}).length},
                }),
            });
            continue;
        }
        rows.push({
            rank: at,
            row: change(path, "changed", LABEL.sceneChanged, {
                subject: authoredName(entry.head.name),
                children: sceneLeaves(path, entry.base, entry.head),
            }),
        });
    }

    // Sorted before anything is truncated, which is the discipline `buildDocumentDiff` documents:
    // truncating an unordered list keeps whichever rows happened to be built first.
    rows.sort((a, b) => a.rank - b.rank);
    return rows.map(entry => entry.row);
}

function orderedSceneIds(document: StoryDocument): string[] {
    // `listSceneIdsInDocumentOrder` indexes `document.scenes`, and these documents were not migrated
    // and may predate any field it reads. A story with no scenes has no order to state.
    if (!document.scenes || typeof document.scenes !== "object") {
        return [];
    }
    try {
        return listSceneIdsInDocumentOrder(document);
    } catch {
        return [];
    }
}

function sceneLeaves(path: readonly string[], base: StoryScene, head: StoryScene): DocumentChange[] {
    const leaves: DocumentChange[] = [];

    if (!sameJsonValue(base.name, head.name)) {
        leaves.push(change([...path, "name"], "changed", LABEL.sceneRenamed, {
            params: fromToParams(base.name, head.name),
            subject: authoredName(head.name),
        }));
    }
    for (const field of SCENE_FIELDS) {
        const left = (base as unknown as Record<string, unknown>)[field];
        const right = (head as unknown as Record<string, unknown>)[field];
        if (!sameJsonValue(left, right)) {
            leaves.push(change([...path, field], presence(left, right), LABEL.sceneField, {
                params: {field, ...fromToParams(left, right)},
            }));
        }
    }
    if (!sameJsonValue(base.rootBlockIds, head.rootBlockIds)) {
        leaves.push(change([...path, "rootBlockIds"], "moved", LABEL.blockOrder));
    }

    leaves.push(...blockLeaves(path, base, head));
    return leaves;
}

/**
 * The rows of one scene, matched by block id and listed in the order the scene is read.
 *
 * A block that changed produces one leaf per field of it that differs, which in practice is one:
 * `payload` holds everything a row says, and it is compared whole. Descending into a payload would
 * mean a diff that knows what every action's parameters mean - twenty-odd shapes, each of which
 * would have to stay in step with the story schema - to say "the text changed" instead of "the row
 * changed", which the row's own text already says beside it.
 */
function blockLeaves(path: readonly string[], base: StoryScene, head: StoryScene): DocumentChange[] {
    const rank = new Map<string, number>();
    for (const block of listSceneBlocksInDocumentOrder(head)) {
        if (!rank.has(block.id)) rank.set(block.id, rank.size);
    }
    for (const block of listSceneBlocksInDocumentOrder(base)) {
        if (!rank.has(block.id)) rank.set(block.id, rank.size);
    }

    const leaves: {leaf: DocumentChange; rank: number; order: number}[] = [];
    let built = 0;
    const push = (leaf: DocumentChange, blockId: string): void => {
        leaves.push({leaf, rank: rank.get(blockId) ?? Number.MAX_SAFE_INTEGER, order: built});
        built += 1;
    };

    for (const entry of diffKeyed(base.blocks ?? {}, head.blocks ?? {})) {
        const blockPath = [...path, "blocks", entry.key];
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as StoryBlock;
            push(change(blockPath, entry.kind, entry.head ? LABEL.blockAdded : LABEL.blockRemoved, {
                subject: blockSubject(present),
            }), entry.key);
            continue;
        }

        const subject = blockSubject(entry.head) ?? blockSubject(entry.base);
        if (entry.base.kind !== entry.head.kind) {
            push(change([...blockPath, "kind"], "changed", LABEL.blockKind, {
                params: {from: String(entry.base.kind), to: String(entry.head.kind)},
                subject,
            }), entry.key);
        }
        if (!sameJsonValue(entry.base.payload, entry.head.payload)) {
            push(change([...blockPath, "payload"], "changed", LABEL.blockChanged, {subject}), entry.key);
        }
        if (!sameJsonValue(entry.base.parentId, entry.head.parentId)) {
            push(change([...blockPath, "parentId"], "moved", LABEL.blockMoved, {subject}), entry.key);
        }
        // The children of a container are an ordered array: one leaf for the array, never one per
        // child that shifted.
        if (!sameJsonValue(entry.base.childrenIds, entry.head.childrenIds)) {
            push(change([...blockPath, "childrenIds"], "moved", LABEL.blockOrder, {subject}), entry.key);
        }
        if (!sameJsonValue(entry.base.disabled, entry.head.disabled)) {
            push(change(
                [...blockPath, "disabled"],
                "changed",
                entry.head.disabled ? LABEL.blockDisabled : LABEL.blockEnabled,
                {subject},
            ), entry.key);
        }
        if (!sameJsonValue(entry.base.diagnosticsMeta, entry.head.diagnosticsMeta)) {
            push(change([...blockPath, "diagnosticsMeta"], "changed", LABEL.blockField, {
                params: {field: "diagnosticsMeta"},
                subject,
            }), entry.key);
        }
    }

    // Script order, with the build order as the tie-break so several leaves about one block stay in
    // the order they were produced rather than being shuffled by a comparator that calls them equal.
    leaves.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));
    return leaves.map(entry => entry.leaf);
}

/**
 * The author's own words for a row, or nothing.
 *
 * `subject` is defined as text the author wrote, so this reads only fields that hold exactly that: a
 * line's plain-text projection, an unresolved command's raw source, a code row's source, a
 * declaration's or a label's name. Everything else - an action name, a block kind, an id - is
 * Studio's vocabulary, and putting it here would print it beside the translated label as if the
 * author had typed it.
 */
function blockSubject(block: StoryBlock | undefined): string | undefined {
    const payload = block?.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== "object") {
        return undefined;
    }
    const text = payload.text as {value?: unknown} | undefined;
    return authoredName(previewValue(text?.value))
        ?? authoredName(previewValue(payload.source))
        ?? authoredName(payload.name);
}

/** Whether two id-carrying arrays hold the same ids in a different order. */
function orderChanged(base: readonly {id?: unknown}[] | undefined, head: readonly {id?: unknown}[] | undefined): boolean {
    const left = Object.keys(byId(base));
    const right = Object.keys(byId(head));
    if (left.length !== right.length) {
        return false;
    }
    const inBase = new Set(left);
    return right.every(id => inBase.has(id)) && (base ?? []).some((element, index) => element?.id !== head?.[index]?.id);
}

function presence(base: unknown, head: unknown): "added" | "removed" | "changed" {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}
