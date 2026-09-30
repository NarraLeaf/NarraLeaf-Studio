/**
 * What one patch changes about the pack descriptor, and how a game composes several of them.
 *
 * A patch used to carry the whole pack, which made two patches mutually exclusive in everything the
 * pack holds - the story, the pages, the translations, the compiled blueprints. Installing a voice
 * pack and an episode patch together meant one of them silently undid the other, because the last
 * pack read replaced the first one entire.
 *
 * A patch carries this instead: the difference between the build it was made against and the build
 * it was made from, stated as operations addressed at named places inside the pack. A game applies
 * each layer's operations in order, so two patches that touch different scenes both take effect and
 * two that touch the same one are decided by their order - the same rule the asset bytes already
 * follow.
 *
 * Both halves read {@link PACK_MERGE_PLAN}. It decides how deep an address may go, and therefore
 * what counts as "the same place" for two patches: a scene, a page element, a translation entry. A
 * writer and a reader that disagreed about that would produce a patch that installs and changes
 * nothing, so there is one plan and both sides walk it.
 */

/** The only delta version a reader accepts. A file stating anything else is left to the pack it ships beside. */
export const PACK_DELTA_VERSION = 1;

/**
 * One change to the pack, addressed by a path of names from its root.
 *
 * A segment is an object key, or - where the plan says a place is a keyed list - the identity of one
 * member. Never an array index: a member's position is not what a second patch means when it names
 * the same member.
 */
export type PackDeltaOperation =
    | { op: "set"; at: string[]; value: unknown }
    | { op: "drop"; at: string[] }
    /** The order of a keyed list, stated only when it changed. Ids the reader does not hold are ignored. */
    | { op: "order"; at: string[]; ids: string[] };

export type PackDelta = {
    version: number;
    ops: PackDeltaOperation[];
};

/**
 * How far into the pack a delta may address, and how each collection is keyed.
 *
 * `value` is a place taken whole: two patches that both change it are decided by their order.
 * Everything else is a place two patches can share.
 */
export type PackMergeNode =
    | { kind: "value" }
    | { kind: "fields"; fields: Record<string, PackMergeNode> }
    /** `Record<id, T>`, addressed by key. */
    | { kind: "map"; of: PackMergeNode }
    /**
     * An array whose members have their own identity, addressed by it rather than by position.
     * `identity` names the field carrying it - dotted for a nested one - or is null when the member
     * is itself the identity, as in a list of ids.
     */
    | { kind: "list"; identity: string | null; of: PackMergeNode };

const VALUE: PackMergeNode = { kind: "value" };
const fields = (of: Record<string, PackMergeNode>): PackMergeNode => ({ kind: "fields", fields: of });
const map = (of: PackMergeNode = VALUE): PackMergeNode => ({ kind: "map", of });
const list = (identity: string | null, of: PackMergeNode = VALUE): PackMergeNode => ({ kind: "list", identity, of });

/**
 * A story, down to the scene.
 *
 * The scene is where this stops. It is the unit an author writes in, the unit a variant drops, and
 * the unit the save-anchor check reports against - and one level further down, the rows, is where
 * two patches editing the same scene stop being two changes and start being one argument.
 */
const STORY_DOCUMENT = fields({
    chapters: list("id"),
    scenes: map(),
});

const BLUEPRINT_DOCUMENT = fields({
    blueprints: map(),
    ownerRecords: map(),
});

export const PACK_MERGE_PLAN: PackMergeNode = fields({
    assets: fields({
        items: map(),
        modelBundles: list(null),
    }),
    plugins: list("manifest.id"),
    puppetRuntimes: list("name"),
    bundle: fields({
        ui: fields({
            uidoc: fields({
                surfaces: list("id"),
                components: list("id"),
                elements: map(),
                structs: map(),
            }),
            uigraphs: fields({
                graphs: map(),
                blueprintDocument: BLUEPRINT_DOCUMENT,
            }),
            localBlueprints: BLUEPRINT_DOCUMENT,
            persistentVariables: map(),
            savedVariables: map(),
            saveSchema: list("id"),
        }),
        story: STORY_DOCUMENT,
        storyLibrary: fields({
            index: fields({ stories: list("id") }),
            documents: map(STORY_DOCUMENT),
            characters: list("id"),
            animations: map(),
            assetNames: map(),
        }),
        localization: fields({
            locales: list("code"),
            tables: map(map()),
            keys: map(),
            scenes: map(),
        }),
        voice: fields({
            voicedLocales: list("code"),
            tables: map(map()),
        }),
        audio: fields({
            clips: map(),
            tracks: list("id"),
        }),
        brand: list("id"),
        blueprintCompiledScripts: map(),
    }),
});

/** The path whose contents decide {@link computeStoryContentHash}, so a composed pack can restate it. */
export const PACK_STORY_DOCUMENTS_PATH = ["bundle", "storyLibrary", "documents"] as const;

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical JSON, so two values that differ only in the order their keys were written compare equal.
 *
 * The compiler rewrites the pack on every build and nothing guarantees the key order it lands in, so
 * without this a patch would carry every page and every story back to a player who already has them.
 */
function canonical(value: unknown): string {
    if (value === undefined) {
        return "~undefined";
    }
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(",")}]`;
    }
    const entries = Object.entries(value as PlainObject)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** The identity of one list member, or null when it has none and the list must be taken whole. */
function memberIdentity(item: unknown, identity: string | null): string | null {
    if (identity === null) {
        return typeof item === "string" ? item : null;
    }
    let cursor: unknown = item;
    for (const segment of identity.split(".")) {
        if (!isPlainObject(cursor)) {
            return null;
        }
        cursor = cursor[segment];
    }
    return typeof cursor === "string" && cursor ? cursor : null;
}

/**
 * Index a list by member identity, or null when it cannot be - an unidentified member, or two
 * members claiming one identity, and the list is a value like any other.
 */
function indexList(items: unknown[], identity: string | null): Map<string, unknown> | null {
    const indexed = new Map<string, unknown>();
    for (const item of items) {
        const key = memberIdentity(item, identity);
        if (key === null || indexed.has(key)) {
            return null;
        }
        indexed.set(key, item);
    }
    return indexed;
}

/**
 * What has to change to turn `base` into `next`.
 *
 * An empty operation list means the two packs say the same thing, which is what a patch that only
 * replaces an image produces.
 */
export function diffPack(base: unknown, next: unknown): PackDelta {
    const ops: PackDeltaOperation[] = [];
    walk(base, next, PACK_MERGE_PLAN, [], ops);
    return { version: PACK_DELTA_VERSION, ops };
}

/** Two id sequences, compared without joining them into a string an id could contain. */
function sameOrder(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

function walk(base: unknown, next: unknown, node: PackMergeNode, at: string[], ops: PackDeltaOperation[]): void {
    if (canonical(base) === canonical(next)) {
        return;
    }
    if (next === undefined) {
        ops.push({ op: "drop", at });
        return;
    }
    switch (node.kind) {
        case "fields": {
            if (!isPlainObject(base) || !isPlainObject(next)) {
                break;
            }
            for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
                walk(base[key], next[key], node.fields[key] ?? VALUE, [...at, key], ops);
            }
            return;
        }
        case "map": {
            if (!isPlainObject(base) || !isPlainObject(next)) {
                break;
            }
            for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
                walk(base[key], next[key], node.of, [...at, key], ops);
            }
            return;
        }
        case "list": {
            if (!Array.isArray(base) || !Array.isArray(next)) {
                break;
            }
            const before = indexList(base, node.identity);
            const after = indexList(next, node.identity);
            if (!before || !after) {
                break;
            }
            for (const [key, item] of before) {
                if (!after.has(key)) {
                    ops.push({ op: "drop", at: [...at, key] });
                }
                else {
                    walk(item, after.get(key), node.of, [...at, key], ops);
                }
            }
            for (const [key, item] of after) {
                if (!before.has(key)) {
                    ops.push({ op: "set", at: [...at, key], value: item });
                }
            }
            // Position is stated only when it moved. Without an order operation a reader keeps the
            // members it has and appends the new ones, so a patch that only adds a chapter says
            // nothing about position and leaves the rest where the build underneath put them.
            const predicted = [...before.keys()].filter(key => after.has(key))
                .concat([...after.keys()].filter(key => !before.has(key)));
            const stated = [...after.keys()];
            if (!sameOrder(predicted, stated)) {
                ops.push({ op: "order", at, ids: stated });
            }
            return;
        }
        case "value":
            break;
    }
    ops.push({ op: "set", at, value: next });
}

/** Where an operation could not land, so a game can say which one it skipped rather than fail. */
export type PackDeltaApplyReport = {
    applied: number;
    /** Paths that named nothing this pack has. Never fatal - the build underneath simply keeps its answer. */
    skipped: string[];
    /** Whether anything under {@link PACK_STORY_DOCUMENTS_PATH} moved. */
    touchedStory: boolean;
};

/**
 * Apply one patch's operations to a pack, in place.
 *
 * Nothing here throws. A path that names something this build does not have is skipped and reported:
 * the usual cause is a patch made against a different build, and a player's game must keep starting.
 */
export function applyPackDelta(pack: unknown, delta: PackDelta): PackDeltaApplyReport {
    const report: PackDeltaApplyReport = { applied: 0, skipped: [], touchedStory: false };
    if (!isPlainObject(pack) || delta.version !== PACK_DELTA_VERSION || !Array.isArray(delta.ops)) {
        return report;
    }
    for (const operation of delta.ops) {
        if (!operation || !Array.isArray(operation.at)) {
            continue;
        }
        if (applyOperation(pack, operation)) {
            report.applied++;
            if (PACK_STORY_DOCUMENTS_PATH.every((segment, index) => operation.at[index] === segment)) {
                report.touchedStory = true;
            }
        } else {
            report.skipped.push(operation.at.join("."));
        }
    }
    return report;
}

function applyOperation(pack: PlainObject, operation: PackDeltaOperation): boolean {
    const target = operation.op === "order" ? operation.at : operation.at.slice(0, -1);
    const leaf = operation.op === "order" ? null : operation.at[operation.at.length - 1];
    if (operation.op !== "order" && leaf === undefined) {
        // The whole pack, which only a patch made with no build to compare against produces.
        if (operation.op === "set" && isPlainObject(operation.value)) {
            for (const key of Object.keys(pack)) {
                delete pack[key];
            }
            Object.assign(pack, operation.value);
            return true;
        }
        return false;
    }

    let container: unknown = pack;
    let node: PackMergeNode = PACK_MERGE_PLAN;
    for (const segment of target) {
        const next = descend(container, node, segment);
        if (!next) {
            return false;
        }
        container = next.value;
        node = next.node;
    }

    if (operation.op === "order") {
        return reorder(container, node, operation.ids);
    }
    if (node.kind === "list") {
        return writeListMember(container, node, leaf as string, operation);
    }
    if (!isPlainObject(container)) {
        return false;
    }
    if (operation.op === "drop") {
        if (!(leaf! in container)) {
            return false;
        }
        delete container[leaf!];
        return true;
    }
    container[leaf!] = operation.value;
    return true;
}

/** One step along a path, resolving a keyed-list segment to the member it names. */
function descend(container: unknown, node: PackMergeNode, segment: string): { value: unknown; node: PackMergeNode } | null {
    if (node.kind === "list") {
        if (!Array.isArray(container)) {
            return null;
        }
        const item = container.find(member => memberIdentity(member, node.identity) === segment);
        return item === undefined ? null : { value: item, node: node.of };
    }
    if (!isPlainObject(container)) {
        return null;
    }
    const value = container[segment];
    if (value === undefined) {
        return null;
    }
    const child = node.kind === "fields" ? node.fields[segment] ?? VALUE : node.kind === "map" ? node.of : VALUE;
    return { value, node: child };
}

function writeListMember(
    container: unknown,
    node: Extract<PackMergeNode, { kind: "list" }>,
    identity: string,
    operation: Exclude<PackDeltaOperation, { op: "order" }>,
): boolean {
    if (!Array.isArray(container)) {
        return false;
    }
    const index = container.findIndex(member => memberIdentity(member, node.identity) === identity);
    if (operation.op === "drop") {
        if (index < 0) {
            return false;
        }
        container.splice(index, 1);
        return true;
    }
    if (memberIdentity(operation.value, node.identity) !== identity) {
        // A member whose identity does not match the address it arrived at would be unreachable by
        // the next patch that names it.
        return false;
    }
    if (index < 0) {
        // New members go last. A patch that means them somewhere else states the order as well.
        container.push(operation.value);
    } else {
        container[index] = operation.value;
    }
    return true;
}

/**
 * Put a keyed list into the order a patch states.
 *
 * Members the patch does not name keep their relative position at the end, so a list a lower layer
 * added to is reordered rather than truncated.
 */
function reorder(container: unknown, node: PackMergeNode, ids: string[]): boolean {
    if (node.kind !== "list" || !Array.isArray(container)) {
        return false;
    }
    const remaining = [...container];
    const ordered: unknown[] = [];
    for (const id of ids) {
        const index = remaining.findIndex(member => memberIdentity(member, node.identity) === id);
        if (index >= 0) {
            ordered.push(...remaining.splice(index, 1));
        }
    }
    ordered.push(...remaining);
    container.splice(0, container.length, ...ordered);
    return true;
}
