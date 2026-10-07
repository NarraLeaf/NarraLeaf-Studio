/**
 * The blueprints story rows own, and what a copy of those rows does with them.
 *
 * A story row can own a blueprint in three places: a `/blueprint` row runs one, a branch can be
 * decided by one, and a line of text can show the value one returns. Studio makes each of those for
 * the row it is created from (`ensureStoryActionBlueprint`), so the graph belongs to that row the way
 * its text does - and a copy of the row that kept the id would share the graph with the original,
 * so editing the copy's graph would change the original's. So every copy gives the new row a
 * blueprint of its own, and the one exception is the move: rows cut and pasted are the same rows in
 * another place, and they keep the blueprint nobody else now names.
 *
 * Expression calls (`{ kind: "invoke" }`) are NOT owned. They name a blueprint as a function the
 * whole story can call by its name, which is shared on purpose; a copied line calls the same one.
 *
 * Comments in English per project convention.
 */

import type { Blueprint } from "@shared/types/blueprint/document";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { blueprintIdsNamedByScene } from "@/lib/story/sceneBlueprintRefs";

/** The owning shapes: `{ action: "blueprint", blueprintId }` and `{ kind: "blueprint", blueprintId }`. */
function ownedBlueprintIdOf(value: Record<string, unknown>): string | null {
    const id = value.blueprintId;
    if (typeof id !== "string" || !id) {
        return null;
    }
    return value.action === "blueprint" || value.kind === "blueprint" ? id : null;
}

/**
 * Visit every owned blueprint reference in a payload, in document order, letting `rename` answer the
 * id that occurrence should carry (the same id leaves it as it is).
 *
 * Per occurrence rather than per id: two rows that already share one blueprint - written before
 * copies were given their own - must come out of a copy as two blueprints, not as a new pair that
 * shares a new one.
 */
function visitOwnedBlueprintRefs(value: unknown, rename: (id: string) => string): void {
    if (Array.isArray(value)) {
        value.forEach(item => visitOwnedBlueprintRefs(item, rename));
        return;
    }
    if (!value || typeof value !== "object") {
        return;
    }
    const record = value as Record<string, unknown>;
    const owned = ownedBlueprintIdOf(record);
    if (owned) {
        record.blueprintId = rename(owned);
    }
    for (const [key, child] of Object.entries(record)) {
        if (key !== "blueprintId") {
            visitOwnedBlueprintRefs(child, rename);
        }
    }
}

/** Every blueprint id the given rows own, each once, in the order the rows name them. */
export function listOwnedBlueprintIds(blocks: Iterable<StoryBlock>): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        // Read off a copy: the visitor writes back what `rename` answers, and this one answers the
        // same id, but a reader should not be one write away from changing the document.
        visitOwnedBlueprintRefs(JSON.parse(JSON.stringify(block.payload)), id => {
            if (!seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
            return id;
        });
    }
    return ids;
}

/** Every blueprint id any row of the given stories names, in any of its shapes. */
export function blueprintIdsNamedByStories(documents: Iterable<StoryDocument>): Set<string> {
    const named = new Set<string>();
    for (const document of documents) {
        for (const scene of Object.values(document.scenes)) {
            for (const id of blueprintIdsNamedByScene(scene)) {
                named.add(id);
            }
        }
    }
    return named;
}

/**
 * What the copied rows' blueprints are made from.
 *
 * - `"copy"`: a copy inside this project that the original rows are still there for - a duplicate.
 *   Every owned blueprint is copied.
 * - `"paste"`: rows pasted into the project they were copied from. A blueprint no row of this project
 *   names any more is kept by the first pasted row that names it - which is what makes a cut and a
 *   paste a move, with one owner and nothing copied - and every other one is copied.
 * - `"foreign"`: rows from another project. This project's blueprints are not the ones the rows
 *   meant, even under the same id, so each is made from the copy the clipboard carried.
 */
export type StoryBlueprintPasteMode = "copy" | "paste" | "foreign";

/** What giving pasted rows their blueprints needs from the project. */
export interface StoryBlueprintPastePort {
    /** This project's blueprint under `id`, if it has one. */
    blueprint(id: string): Blueprint | undefined;
    /** Whether a row anywhere in this project names `id` right now. Asked only in `"paste"` mode. */
    namedByRows(id: string): boolean;
    /** Add a copy of `source` under a new id; the id, or null when it could not be added. */
    copy(source: Blueprint): string | null;
}

/**
 * Give the copied rows blueprints of their own, rewriting their payloads in place.
 *
 * `blocks` are the COPIES, already on fresh row ids, before they are inserted. `carried` is the
 * clipboard's copy of the blueprints the source rows owned, keyed by their ids there. A reference
 * nothing can be made for - a blueprint neither here nor carried - is left as it is, and the project
 * check reports it the way it reports any row whose blueprint is missing.
 *
 * Answers how many blueprints were copied, for a caller that wants to say so.
 */
export function giveCopiedRowsTheirBlueprints(
    blocks: Iterable<StoryBlock>,
    port: StoryBlueprintPastePort,
    mode: StoryBlueprintPasteMode,
    carried?: Readonly<Record<string, Blueprint>>,
): number {
    const kept = new Set<string>();
    let copied = 0;
    const rename = (id: string): string => {
        const local = mode === "foreign" ? undefined : port.blueprint(id);
        if (local && mode === "paste" && !kept.has(id) && !port.namedByRows(id)) {
            kept.add(id);
            return id;
        }
        const source = local ?? carried?.[id];
        if (!source) {
            return id;
        }
        const next = port.copy(source);
        if (!next) {
            return id;
        }
        copied += 1;
        return next;
    };
    for (const block of blocks) {
        visitOwnedBlueprintRefs(block.payload, rename);
    }
    return copied;
}

/**
 * The blueprints to carry on the clipboard for rows that own them: this project's copy of each,
 * keyed by its id.
 *
 * Carried whole because the rows mean nothing in another project without them - there the ids name
 * nothing, or name somebody else's graph - and an owned blueprint is a small document. Only story
 * blueprints are carried; nothing else can be owned by a row.
 */
export function collectCarriedBlueprints(
    blocks: Iterable<StoryBlock>,
    lookup: (id: string) => Blueprint | undefined,
): Record<string, Blueprint> | undefined {
    const carried: Record<string, Blueprint> = {};
    let any = false;
    for (const id of listOwnedBlueprintIds(blocks)) {
        const blueprint = lookup(id);
        if (blueprint?.owner?.kind === "storyAction") {
            carried[id] = blueprint;
            any = true;
        }
    }
    return any ? carried : undefined;
}

/**
 * The carried blueprints off a pasted payload, rebuilt entry by entry rather than trusted.
 *
 * Written by another process - another window, another Studio version - so only entries that are
 * plainly a story blueprint keyed by its own id come through. Whatever survives is still validated
 * against the document before it is added (`LocalBlueprintService.copyStoryActionBlueprint`).
 */
export function readCarriedBlueprints(value: unknown): Record<string, Blueprint> | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const out: Record<string, Blueprint> = {};
    let any = false;
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const blueprint = entry as Partial<Blueprint>;
        if (blueprint.id !== id || blueprint.owner?.kind !== "storyAction" || !blueprint.graphs || typeof blueprint.graphs !== "object") {
            continue;
        }
        out[id] = blueprint as Blueprint;
        any = true;
    }
    return any ? out : undefined;
}
