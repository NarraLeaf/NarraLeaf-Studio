/**
 * Reading a save written while menus, conditions, scripts and the engine's own scene steps were
 * still numbered by position.
 *
 * A save says where the story was by action id: the action each execution stack is waiting on, the
 * action a branch returns to when it runs out, each backlog line's action, the action a looping
 * transform was started by. The compiler has long named a row's own actions from the row
 * (`studio:<story>:<scene>:<row>:…`), but not everything a save can stop on was one of those. A menu,
 * a condition and a script only become actions when the engine takes them in, the engine builds the
 * steps of entering and leaving a scene itself, and the compiler adds a few of its own around rows -
 * and every one of them the engine numbered `a-<n>`, by its place in a walk of the whole story from
 * the entry scene. They are named from the document now (`nl:action:…`, see `nameRowInternals` in the
 * story compiler), and a save written before that names them by number.
 *
 * Read against today's names, such a number is worse than missing: one line written ahead of the menu,
 * or a different scene to start from, and `a-11` is a different action - a save taken with a menu
 * open resumed by running some other row, or nothing at all. So the numbers are translated before
 * anything looks them up, by the one rule that can be proved:
 *
 * **The walk again, where the walk is the same.** The old numbering is a pure function of the
 * compiled story and its entry scene. Every action the old build numbered is one that today's build
 * names outside the `studio:` scheme - those were the only names the old build gave - and naming an
 * action does not move it in the walk. So walking the running story the way the engine does and
 * counting those actions in order gives back exactly the numbers the save was written under. That is
 * trusted only when it is provably the same story: the save's record names the same document hash as
 * this build, and the engine's own hash of the story, recomputed under the old names, is the one the
 * save carries - which is also what says it was entered at the same scene.
 *
 * Nothing about an action's number survives anything else, so a number that cannot be translated is
 * never guessed at. The save is refused where the number is what it would resume on; a backlog line
 * standing on one is let go of, and so is a backlog line's restore point or a loop's anchor naming
 * one - the engine already drops each of those when the action is simply gone.
 */

import { DevTools, type SavedGame } from "narraleaf-react";

/** The engine's positional action names. */
const POSITIONAL_ACTION_ID = /^a-\d+$/;

/**
 * The scheme every action a build before stable ids for everything named carried. Anything else in
 * today's build - `nl:action:…` from the compiler, a scene's own steps the engine names after the
 * scene, or a number - was numbered by the old one.
 */
const ROW_ACTION_ID_PREFIX = "studio:";

export function isPositionalActionId(id: unknown): id is string {
    return typeof id === "string" && POSITIONAL_ACTION_ID.test(id);
}

/** What the running story says about action numbers a save may hold. */
export type LegacyActionIdTable = {
    /** Old positional id to today's id, for every action the old build numbered. */
    numbering: ReadonlyMap<string, string>;
    /**
     * The engine's hash of the running story as the old build computed it: the same walk, with every
     * action under its old number. Null when it could not be worked out. Computed on first ask.
     */
    storyHash(): string | null;
};

type WalkedAction = { getId(): string };

/** The parts of an engine story the walk reads. Structural, so a compiled story stands in for one. */
export type LegacyActionWalkStory = {
    entryScene: {
        getSceneRoot(): unknown;
        getAllChildren(story: unknown, action: unknown, options: { allowFutureScene: boolean }): WalkedAction[];
    } | null;
    stringify(strict?: boolean): string;
};

/**
 * The numbering the engine gave a constructed story before its actions were named, recomputed.
 *
 * Mirrors `Scene.assignActionId`: the same walk from the entry scene's root, following jumps into
 * other scenes, numbering every action that had no name in order and skipping those that had one.
 */
export function buildLegacyActionIdTable(story: LegacyActionWalkStory): LegacyActionIdTable {
    const numbering = new Map<string, string>();
    const renamed: [action: WalkedAction, legacyId: string][] = [];
    const scene = story.entryScene;
    if (scene) {
        let next = 0;
        for (const action of scene.getAllChildren(story, scene.getSceneRoot(), { allowFutureScene: true })) {
            const id = action.getId();
            if (id.startsWith(ROW_ACTION_ID_PREFIX)) {
                continue;
            }
            const legacyId = `a-${next++}`;
            numbering.set(legacyId, id);
            renamed.push([action, legacyId]);
        }
    }
    let storyHash: string | null | undefined;
    return {
        numbering,
        storyHash: () => {
            if (storyHash === undefined) {
                storyHash = hashUnderNames(story, renamed);
            }
            return storyHash;
        },
    };
}

/**
 * The engine's hash of the story with the given actions under the given names.
 *
 * An action's id is part of what the engine hashes (`Name#<id>(type)`), so naming the actions moved
 * the hash of an unchanged story, and a save's hash can only be checked against the one the old
 * names produce. The names are put on for the length of one synchronous stringify and taken off in
 * the same call, so nothing running can see them.
 */
function hashUnderNames(story: LegacyActionWalkStory, names: readonly [WalkedAction, string][]): string | null {
    const current = names.map(([action]) => action.getId());
    try {
        names.forEach(([action, name]) => setActionId(action, name));
        return engineStoryHash(story.stringify(false));
    } catch {
        return null;
    } finally {
        names.forEach(([action], index) => setActionId(action, current[index]));
    }
}

function setActionId(action: WalkedAction, id: string): void {
    DevTools.setActionId(action as Parameters<typeof DevTools.setActionId>[0], id);
}

/**
 * The engine's story hash function (`fnv1a64` in its `util/data`), which it does not export.
 *
 * Kept identical to the engine's - including its two halves being seeded the way they are - because
 * the only thing this is for is producing the value the engine wrote into a save. A test holds it to
 * `Story.hash()`, so an engine that changes its hash fails there rather than here.
 */
export function engineStoryHash(input: string): string {
    let hashLo = 0xcbf29ce4 >>> 0;
    let hashHi = 0x84222325 >>> 0;
    for (let i = 0; i < input.length; i++) {
        hashLo ^= input.charCodeAt(i);
        const lo = hashLo >>> 0;
        const hi = hashHi >>> 0;
        const primeLo = 0x1b3 >>> 0;
        const primeHi = 0x1000000 >>> 0;
        const newLo = (lo * primeLo) >>> 0;
        const cross = ((lo * primeHi) + (hi * primeLo)) >>> 0;
        const newHi = (hi * primeHi + (cross >>> 0)) >>> 0;
        hashLo = newLo;
        hashHi = newHi;
    }
    return ("00000000" + hashHi.toString(16)).slice(-8) + ("00000000" + hashLo.toString(16)).slice(-8);
}

/** One table per constructed story: the walk is the same every time it is asked. */
const tablesByStory = new WeakMap<object, LegacyActionIdTable>();

/** The table for a story the engine has constructed - the live game's. Null for anything else. */
export function legacyActionIdTableFor(story: unknown): LegacyActionIdTable | null {
    if (!story || typeof story !== "object" || !("entryScene" in story) || typeof (story as { stringify?: unknown }).stringify !== "function") {
        return null;
    }
    const cached = tablesByStory.get(story);
    if (cached) {
        return cached;
    }
    const table = buildLegacyActionIdTable(story as LegacyActionWalkStory);
    tablesByStory.set(story, table);
    return table;
}

/**
 * How the numbers in a save are to be read.
 *
 * - `current`: the save was written by this very story (its hash is the running story's), so its
 *   numbers - if it has any - are today's.
 * - `legacy`: it was written by this story under the old names (see the file comment), so they are
 *   translated through the table.
 * - `unknown`: neither, and no number in it can be trusted.
 */
export type ActionIdReading = "current" | "legacy" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Today's id for one id a save holds, or `undefined` when it is a number nothing can place. */
type Rename = (id: string) => string | undefined;

/** The ids in one serialized execution stack, renamed - or the numbers that could not be. */
function renameStack(stack: unknown, rename: Rename, unmappable: Set<string>): unknown {
    if (!isRecord(stack)) {
        return stack;
    }
    const renameId = (id: unknown): unknown => {
        if (typeof id !== "string") {
            return id;
        }
        const next = rename(id);
        if (next === undefined) {
            unmappable.add(id);
            return id;
        }
        return next;
    };
    const items = Array.isArray(stack.items)
        ? stack.items.map(item => {
            if (!isRecord(item)) {
                return item;
            }
            const next: Record<string, unknown> = { ...item, action: renameId(item.action) };
            if (Array.isArray(item.stacks)) {
                next.stacks = item.stacks.map(nested => renameStack(nested, rename, unmappable));
            }
            return next;
        })
        : stack.items;
    const loop = isRecord(stack.loop)
        ? {
            ...stack.loop,
            ...(Array.isArray(stack.loop.bodyActionIds) ? { bodyActionIds: stack.loop.bodyActionIds.map(renameId) } : {}),
            ...(typeof stack.loop.conditionActionId === "string" ? { conditionActionId: renameId(stack.loop.conditionActionId) } : {}),
        }
        : stack.loop;
    return { ...stack, items, ...(stack.loop !== undefined ? { loop } : {}) };
}

type StateLike = {
    stackModel?: unknown;
    asyncStackModels?: unknown;
    elementStates?: unknown;
};

/**
 * One serialized game state - the save's own, or a backlog line's restore point - under today's
 * action names, and the numbers in it that could not be placed.
 *
 * Only the stacks decide whether it can be placed: they are what a load resumes on. A looping
 * transform's anchor that cannot be placed loses the loop and keeps the pose, which is what the engine
 * does with an anchor it cannot find.
 */
function renameState(state: StateLike, rename: Rename): { state: StateLike; unmappable: string[] } {
    const unmappable = new Set<string>();
    const stackModel = renameStack(state.stackModel, rename, unmappable);
    const asyncStackModels = Array.isArray(state.asyncStackModels)
        ? state.asyncStackModels.map(stack => renameStack(stack, rename, unmappable))
        : state.asyncStackModels;
    const elementStates = Array.isArray(state.elementStates)
        ? state.elementStates.map(entry => {
            if (!isRecord(entry) || !isRecord(entry.data) || !isRecord(entry.data.loop)) {
                return entry;
            }
            const anchor = entry.data.loop.actionId;
            if (typeof anchor !== "string" || !isPositionalActionId(anchor)) {
                return entry;
            }
            const next = rename(anchor);
            return {
                ...entry,
                data: { ...entry.data, loop: next === undefined ? null : { ...entry.data.loop, actionId: next } },
            };
        })
        : state.elementStates;
    return {
        state: {
            ...state,
            ...(state.stackModel !== undefined ? { stackModel } : {}),
            ...(state.asyncStackModels !== undefined ? { asyncStackModels } : {}),
            ...(state.elementStates !== undefined ? { elementStates } : {}),
        },
        unmappable: [...unmappable].sort(),
    };
}

export type LegacyActionTranslation = {
    savedGame: SavedGame;
    /** Numbers the save resumes on that could not be placed. Empty when it loads. */
    unmappable: string[];
};

/**
 * The save with every action number it holds replaced by today's name, or the numbers that could not
 * be. Returned untouched when it holds none, which is every save written since every action was named,
 * and when its numbers are this story's own.
 */
export function translateLegacyActionIds(
    savedGame: SavedGame,
    table: LegacyActionIdTable,
    reading: ActionIdReading,
): LegacyActionTranslation {
    const game = savedGame.game as unknown as Record<string, unknown>;
    if (reading === "current") {
        return { savedGame, unmappable: [] };
    }
    let positional = 0;
    const rename: Rename = id => {
        if (!isPositionalActionId(id)) {
            return id;
        }
        positional++;
        return reading === "legacy" ? table.numbering.get(id) : undefined;
    };
    const main = renameState(game as StateLike, rename);
    if (main.unmappable.length > 0) {
        return { savedGame, unmappable: main.unmappable };
    }
    const history = Array.isArray(game.history)
        ? game.history.flatMap(entry => {
            if (!isRecord(entry)) {
                return [entry];
            }
            const actionId = entry.actionId;
            let next: Record<string, unknown> = entry;
            if (typeof actionId === "string" && isPositionalActionId(actionId)) {
                const renamed = rename(actionId);
                // A line on an action nothing can name is dropped, as the engine drops one whose
                // action is gone: bound to whatever holds that number today, stepping back to it
                // would land somewhere the player never was.
                if (renamed === undefined) {
                    return [];
                }
                next = { ...next, actionId: renamed };
            }
            if (isRecord(entry.snapshot)) {
                const snapshot = renameState(entry.snapshot as StateLike, rename);
                next = { ...next, snapshot: snapshot.unmappable.length > 0 ? null : snapshot.state };
            }
            return [next];
        })
        : game.history;
    if (positional === 0) {
        return { savedGame, unmappable: [] };
    }
    return {
        savedGame: { ...savedGame, game: { ...(main.state as object), history } } as unknown as SavedGame,
        unmappable: [],
    };
}
