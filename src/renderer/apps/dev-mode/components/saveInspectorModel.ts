/**
 * Pure projections for the Dev Mode Saves panel: turning a save record into named sections, and
 * splitting a store into the keys a declaration claims and the keys nothing does.
 *
 * React- and engine-free, for the reason `storyRuntimeDebugModel` is: the decoding is the part that
 * can be wrong in a way nobody notices. A save file addresses everything by STORAGE KEY, which is a
 * uuid, so a panel that renders it verbatim looks like it is working no matter how badly it has
 * mis-attributed a namespace. The only way to know it has not is to test it against the shapes the
 * engine actually writes.
 *
 * The shapes below were verified against real save files, not inferred from the types:
 *
 *   savedGame.game.store = {
 *     "persistent:__nlr_story_saved__":   { "<storageKey>": {"type":"any","data":false} },
 *     "persistent:__nlr_story_visited__": { "scenes": {...}, "options": {...} },
 *     "local:<scene runtime name>":       { ... },
 *     "game": {}
 *   }
 *
 * Every namespace key holds a `WrappedStorableData` (`{type, data, dates?, undefineds?}`), which is
 * why nothing here reads a stored value directly. Namespace NAMES are never reconstructed from a
 * prefix - they arrive from the running compile, because the prefix is the engine's business and a
 * panel that hard-codes `persistent:` is one engine rename away from silently showing nothing.
 */

import type { MergedPersistentEntry } from "@shared/variables/mergedPersistentView";

/** One key of a namespace (or of the host persistence store), ready to draw. */
export type SaveValueRow = {
    storageKey: string;
    /** Author-facing name, or null when no declaration claims this key. */
    name: string | null;
    value: unknown;
};

/** One `local:` namespace found in a save, mapped back to the Studio scene that owns it. */
export type SaveSceneSection = {
    namespace: string;
    /** Studio scene id, or null when the running story has no scene with this namespace. */
    sceneId: string | null;
    sceneName: string | null;
    rows: SaveValueRow[];
};

/** One id in the visited record, with the name the story still has for it. */
export type SaveVisitedRef = { id: string; name: string | null };

export type SaveVisitedSection = { scenes: SaveVisitedRef[]; options: SaveVisitedRef[] };

export type DecodedSave = {
    /** The saved-variable namespace, split by whether a declaration claims the key. */
    saved: { namespace: string; declared: SaveValueRow[]; unclaimed: SaveValueRow[] } | null;
    scenes: SaveSceneSection[];
    visited: SaveVisitedSection | null;
    /**
     * Namespaces no scope claimed - the engine's own `game`, or one left by a story this save was
     * not written from. Kept rather than dropped: a namespace nobody expected is exactly the thing
     * worth seeing, and it costs one line.
     */
    other: { namespace: string; rows: SaveValueRow[] }[];
};

export type DecodeSaveInput = {
    /** `record.savedGame`, exactly as the store returned it. */
    savedGame: unknown;
    /** Namespace names of the RUNNING compile (`storyRuntime.getVariableNamespaces`). */
    namespaces: {
        saved: string | null;
        visited: string | null;
        /** Studio scene id → the `local:` namespace name that scene compiled to. */
        sceneLocal: Readonly<Record<string, string>>;
    };
    /** storageKey → author-facing name, for the saved scope (the merged registry + story view). */
    savedNames: ReadonlyMap<string, string>;
    /** Studio scene id → (storageKey → name) for that scene's Local variables. */
    sceneVariableNames: ReadonlyMap<string, ReadonlyMap<string, string>>;
    /** Studio scene id → display name. */
    sceneNames: ReadonlyMap<string, string>;
    /** Studio block id of a choice option → the text the author wrote on it. */
    optionNames: ReadonlyMap<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value inside one `WrappedStorableData`.
 *
 * Applied exactly once, at the top level of a namespace, and never recursively: a stored value is
 * free to BE an object with `type` and `data` fields, and unwrapping those too would quietly rewrite
 * the author's own data on the way to the screen. `dates` / `undefineds` are not walked - this is a
 * readout, and an ISO string in the position a `Date` came from is still the right answer to "what
 * is in the file".
 */
export function unwrapStorableValue(value: unknown): unknown {
    if (isRecord(value) && typeof value.type === "string" && "data" in value) {
        return value.data;
    }
    return value;
}

function namespaceRows(
    namespace: unknown,
    names: ReadonlyMap<string, string> | undefined,
): SaveValueRow[] {
    if (!isRecord(namespace)) {
        return [];
    }
    return Object.keys(namespace)
        .sort()
        .map(storageKey => ({
            storageKey,
            name: names?.get(storageKey) ?? null,
            value: unwrapStorableValue(namespace[storageKey]),
        }));
}

/** The string ids in one visited collection; anything else in there is not an id and is dropped. */
function visitedIds(namespace: Record<string, unknown> | null, key: string): string[] {
    const raw = unwrapStorableValue(namespace?.[key]);
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/** Split a save's `game.store` into the sections an author can read. */
export function decodeSavedGameStore(input: DecodeSaveInput): DecodedSave {
    const game = isRecord(input.savedGame) ? input.savedGame.game : undefined;
    const store = isRecord(game) && isRecord(game.store) ? game.store : {};

    // Inverted here rather than by the caller: the mapping the save needs runs namespace → scene,
    // and the bridge only publishes scene → namespace.
    const sceneIdByNamespace = new Map<string, string>();
    for (const [sceneId, namespace] of Object.entries(input.namespaces.sceneLocal)) {
        sceneIdByNamespace.set(namespace, sceneId);
    }

    let saved: DecodedSave["saved"] = null;
    let visited: SaveVisitedSection | null = null;
    const scenes: SaveSceneSection[] = [];
    const other: DecodedSave["other"] = [];

    for (const namespace of Object.keys(store).sort()) {
        const content = store[namespace];
        if (input.namespaces.saved && namespace === input.namespaces.saved) {
            const rows = namespaceRows(content, input.savedNames);
            saved = {
                namespace,
                declared: rows.filter(row => row.name !== null),
                unclaimed: rows.filter(row => row.name === null),
            };
            continue;
        }
        if (input.namespaces.visited && namespace === input.namespaces.visited) {
            const record = isRecord(content) ? content : null;
            visited = {
                scenes: visitedIds(record, "scenes").map(id => ({
                    id,
                    name: input.sceneNames.get(id) ?? null,
                })),
                options: visitedIds(record, "options").map(id => ({
                    id,
                    name: input.optionNames.get(id) ?? null,
                })),
            };
            continue;
        }
        const sceneId = sceneIdByNamespace.get(namespace) ?? null;
        if (sceneId !== null) {
            scenes.push({
                namespace,
                sceneId,
                sceneName: input.sceneNames.get(sceneId) ?? null,
                rows: namespaceRows(content, input.sceneVariableNames.get(sceneId)),
            });
            continue;
        }
        other.push({ namespace, rows: namespaceRows(content, undefined) });
    }

    return { saved, scenes, visited, other };
}

/** The one line a slot shows before it is opened. */
export type SaveSlotSummary = {
    id: string;
    /** The slot's own name when the author's metadata carries one, otherwise the slot id. */
    label: string;
    lastSentence: string | null;
    /** ISO timestamp as the store wrote it, or null on a record it could not stamp. */
    updatedAt: string | null;
};

/**
 * A slot's heading, from whatever the record actually holds.
 *
 * `metadata.user` is author-supplied and therefore `unknown` - a Save Game node writes whatever the
 * blueprint handed it. A bare string is a name; an object with a string `name` is the shape every
 * save screen in the templates writes. Anything else is data this panel has no business guessing at,
 * and the slot id is the honest answer.
 */
export function summarizeSaveSlot(
    id: string,
    record: { metadata?: { user?: unknown; updatedAt?: string } | null; savedGame?: unknown } | null,
): SaveSlotSummary {
    const user = record?.metadata?.user;
    let label = id;
    if (typeof user === "string" && user.trim()) {
        label = user.trim();
    } else if (isRecord(user) && typeof user.name === "string" && user.name.trim()) {
        label = user.name.trim();
    }
    const game = isRecord(record?.savedGame) ? record?.savedGame : undefined;
    const meta = isRecord(game?.meta) ? game?.meta : undefined;
    const lastSentence = typeof meta?.lastSentence === "string" && meta.lastSentence ? meta.lastSentence : null;
    return {
        id,
        label,
        lastSentence,
        updatedAt: record?.metadata?.updatedAt ?? null,
    };
}

export type PersistentStoreRow = {
    storageKey: string;
    name: string;
    value: unknown;
    /** True when the store actually holds this key; false means the declared default is shown. */
    live: boolean;
};

export type PersistentStoreView = {
    declared: PersistentStoreRow[];
    /** Keys in the store that no declared variable claims. */
    unclaimed: SaveValueRow[];
};

/**
 * The project-wide persistent store, by name, plus everything in it that has no name.
 *
 * The second half is the reason this panel can own the store outright. Persistent values are not
 * only written by declared variables - a blueprint may `Set Persistent` any key it likes, and the
 * locale the game shell stores is one of those. A view that showed declarations alone would be a
 * strictly smaller readout than the raw dump it replaced, and losing a key from view is worse than
 * showing a uuid.
 */
export function projectPersistentStore(
    snapshot: ReadonlyMap<string, unknown>,
    declared: readonly MergedPersistentEntry[],
): PersistentStoreView {
    const claimed = new Set<string>();
    const rows: PersistentStoreRow[] = [];
    for (const entry of declared) {
        // A duplicate storage key across the two declaration surfaces is one variable at runtime;
        // drawing it twice would read as two that disagree.
        if (claimed.has(entry.storageKey)) {
            continue;
        }
        claimed.add(entry.storageKey);
        const live = snapshot.has(entry.storageKey);
        rows.push({
            storageKey: entry.storageKey,
            name: entry.name,
            value: live ? snapshot.get(entry.storageKey) : entry.defaultValue,
            live,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const unclaimed: SaveValueRow[] = [...snapshot.keys()]
        .filter(key => !claimed.has(key))
        .sort()
        .map(storageKey => ({ storageKey, name: null, value: snapshot.get(storageKey) }));
    return { declared: rows, unclaimed };
}

/**
 * Why a load failed, and how loudly to say it.
 *
 * `warning` for a save whose story has moved on - an element it poses no longer exists. That is the
 * expected end of an old save, not an incident, and the one actionable fact is which element id it
 * named. `danger` is kept for a throw whose shape is not that, because then something really did go
 * wrong and the message is all anyone has.
 */
export type SaveLoadFailure = {
    tone: "warning" | "danger";
    /** The element the save refers to that the recompiled story no longer has, when that is the cause. */
    missingElementId: string | null;
    message: string;
};

/**
 * The engine's own wording, matched rather than re-thrown. `LiveGame.deserialize` throws
 * `"Element not found, id: <id>\n…"` while replaying `elementStates`, and printing that with its
 * second line and its stack tells an author less than naming the id does.
 *
 * The load path resolves those ids before it enters the live game, so this now reads a throw that
 * got past that check rather than the ordinary end of an old save.
 */
const MISSING_ELEMENT_PATTERN = /Element not found, id:\s*(\S+)/;

export function classifySaveLoadFailure(error: unknown): SaveLoadFailure {
    const message = error instanceof Error ? error.message : String(error);
    const match = MISSING_ELEMENT_PATTERN.exec(message);
    if (match) {
        return { tone: "warning", missingElementId: match[1], message };
    }
    return { tone: "danger", missingElementId: null, message };
}

/** What a load cost even though it worked. */
export type SaveLoadLosses = {
    /** Backlog entries the engine drops because their action id no longer resolves. */
    droppedBacklog: number;
    backlogTotal: number;
    /** Storage keys the save carries that no declaration claims. */
    unclaimedKeys: string[];
};

/**
 * The losses a successful load takes quietly.
 *
 * Both are silent by design in the engine and in the store: a backlog entry whose action id is gone
 * is dropped without a word (the line simply is not in the history any more), and a store key nobody
 * declares is loaded and then invisible. Neither is a failure - but an author who deleted a row and
 * then wondered where their backlog went deserves to be told which one it was.
 *
 * `knownActionIds` is the running compile's static action ids; a compiled Studio action resolves its
 * engine id from that static id, so the two are the same string.
 */
export function collectSaveLoadLosses(input: {
    savedGame: unknown;
    knownActionIds: ReadonlySet<string>;
    decoded: DecodedSave;
}): SaveLoadLosses {
    const game = isRecord(input.savedGame) ? input.savedGame.game : undefined;
    const history = isRecord(game) && Array.isArray(game.history) ? game.history : [];
    let droppedBacklog = 0;
    for (const entry of history) {
        const actionId = isRecord(entry) ? entry.actionId : null;
        if (typeof actionId !== "string" || !input.knownActionIds.has(actionId)) {
            droppedBacklog += 1;
        }
    }
    const unclaimedKeys = [
        ...(input.decoded.saved?.unclaimed ?? []),
        ...input.decoded.scenes.flatMap(scene => scene.rows),
    ]
        .filter(row => row.name === null)
        .map(row => row.storageKey);
    return { droppedBacklog, backlogTotal: history.length, unclaimedKeys };
}
