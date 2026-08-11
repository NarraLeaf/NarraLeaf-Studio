/**
 * Loading a save without spending the run that is already going.
 *
 * `LiveGame.deserialize` is destructive before it is safe: it calls `reset()` and
 * `forceRemount()` first and only then walks the saved element, scene and action ids, throwing on
 * the first one the running story does not have. A load that fails halfway therefore used to leave
 * the player with neither the save nor the game they were playing.
 *
 * Two layers keep that from happening, in this order:
 *
 * 1. **Resolve the save against the running story before touching anything.** Every id the engine
 *    would look up is looked up here first, against the very same maps `deserialize` uses
 *    (`LiveGame.constructMaps`, cached on the live game). A save that names something the story no
 *    longer has is refused with the live game never entered.
 * 2. **Keep a snapshot for anything the first layer does not model.** The live game is serialized
 *    immediately before the swap, and put back from that snapshot if `deserialize` throws anyway.
 *
 * The story hash never decides whether a load happens. A save written from another build of the
 * story that still resolves is a save that loads; the hash only picks the sentence the player is
 * shown, and raises a note to the author when a load came from a different build.
 */
import type { SavedGame } from "narraleaf-react";
import { translate } from "@/lib/i18n";

/** How the story stamped into the save compares with the story now running. */
export type SaveStoryOrigin =
    /** The save was written from this build of the story. */
    | "sameStory"
    /** The save was written from a different build. Not a reason to refuse it. */
    | "otherStory"
    /** One side carries no hash, so the two cannot be compared. */
    | "unknown";

export type SaveLoadRefusalReason =
    /** The store could not produce the record. */
    | "unreadable"
    /** No save is stored under that id. */
    | "missing"
    /** What is stored is not a saved game. */
    | "malformed"
    /** The save names scenes, elements or actions the running story does not have. */
    | "unresolved"
    /** The engine refused it for something this module does not model. */
    | "engine";

/** What happened to the game that was running. */
export type RunningGameState =
    /** It was never entered. */
    | "unchanged"
    /** It was entered and put back from the snapshot taken beforehand. */
    | "restored"
    /** It was entered and could not be put back. */
    | "lost";

export type SaveLoadOutcome =
    | { status: "loaded"; origin: SaveStoryOrigin }
    | {
          status: "refused";
          reason: SaveLoadRefusalReason;
          origin: SaveStoryOrigin;
          /** One line for the author. Not what the player is shown. */
          detail: string;
          /** Ids the save names that the running story does not have. Empty for other reasons. */
          unresolvedIds: string[];
          game: RunningGameState;
      };

/** The running story's id tables, as `deserialize` will see them. */
export type SaveStoryMaps = {
    hasAction: (id: string) => boolean;
    hasElement: (id: string) => boolean;
};

/** The engine operations a load needs, narrowed so this module can be driven without one. */
export type SaveLoadGameSeam = {
    /**
     * The running story's id tables, or null when the engine cannot produce them. Null turns the
     * pre-check off and leaves the snapshot as the only protection, which is a degradation rather
     * than a failure.
     */
    resolveStoryMaps: () => SaveStoryMaps | null;
    /** The hash the running story stamps into a save it writes, or null when there is none. */
    readStoryHash: () => string | null;
    /** The live game as a save, for putting it back. Null when one cannot be taken. */
    snapshot: () => SavedGame | null;
    /** Replace the live game with the saved one. Throws whatever the engine throws. */
    apply: (savedGame: SavedGame) => void;
    /** Put the live game back from a snapshot. Throws whatever the engine throws. */
    restore: (snapshot: SavedGame) => void;
};

export type LoadSaveOptions = {
    /** The slot being loaded, for the author-facing line. */
    id: string;
    /** Reads the stored record. A throw here is a refusal, not a crash. */
    readRecord: () => Promise<{ savedGame: unknown } | null>;
    game: SaveLoadGameSeam;
    /** Shows one line inside the running game. */
    notifyPlayer: (message: string) => void;
    /** Reports to whoever is watching the run. */
    report: (level: "warning" | "error", message: string) => void;
};

/** How many ids a single author-facing line names. */
const REPORTED_ID_LIMIT = 6;

/** The serialized discriminant of a stack entry that must resolve to a live action. */
const STACK_ITEM_ACTION = "action";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Whether the stored value carries everything `deserialize` destructures out of it.
 *
 * Checked up front because a missing key does not fail the load politely: `deserialize` reads
 * `elementStates.forEach` and `stackModel.items` after it has already reset the game.
 */
export function isSavedGameShape(value: unknown): value is SavedGame {
    if (!isRecord(value)) {
        return false;
    }
    const game = value.game;
    if (!isRecord(game)) {
        return false;
    }
    if (!isRecord(game.store) || !isRecord(game.services)) {
        return false;
    }
    if (!Array.isArray(game.elementStates) || !Array.isArray(game.asyncStackModels)) {
        return false;
    }
    const stage = game.stage;
    if (!isRecord(stage) || !Array.isArray(stage.scenes) || !Array.isArray(stage.videos)) {
        return false;
    }
    if (!isRecord(stage.audio) || !Array.isArray(stage.audio.sounds)) {
        return false;
    }
    const stackModel = game.stackModel;
    return isRecord(stackModel) && Array.isArray(stackModel.items);
}

/** The story hash the save carries, or null when it carries none. */
export function readSaveStoryHash(savedGame: unknown): string | null {
    if (!isRecord(savedGame) || !isRecord(savedGame.meta)) {
        return null;
    }
    const hash = savedGame.meta.storyHash;
    return typeof hash === "string" && hash.length > 0 ? hash : null;
}

/**
 * The save's story against the running one.
 *
 * The single use for the hash the engine has written into every save since saves existed. It words
 * a report; it never gates a load.
 */
export function compareSaveStory(savedGame: unknown, liveStoryHash: string | null): SaveStoryOrigin {
    const saved = readSaveStoryHash(savedGame);
    if (!saved || !liveStoryHash) {
        return "unknown";
    }
    return saved === liveStoryHash ? "sameStory" : "otherStory";
}

/** Every action id a serialized execution stack needs the running story to still have. */
function collectStackActionIds(stack: unknown, found: Set<string>): void {
    if (!isRecord(stack)) {
        return;
    }
    const items = stack.items;
    if (Array.isArray(items)) {
        for (const item of items) {
            if (!isRecord(item)) {
                continue;
            }
            // Only a plain stack entry has to resolve. A link entry's own action is looked up
            // leniently by the engine and left null when it is gone, so requiring it here would
            // refuse a save the engine accepts.
            if (item.type === STACK_ITEM_ACTION && typeof item.action === "string") {
                found.add(item.action);
            }
            if (Array.isArray(item.stacks)) {
                for (const nested of item.stacks) {
                    collectStackActionIds(nested, found);
                }
            }
        }
    }
    const loop = stack.loop;
    if (isRecord(loop) && Array.isArray(loop.bodyActionIds)) {
        for (const actionId of loop.bodyActionIds) {
            if (typeof actionId === "string") {
                found.add(actionId);
            }
        }
    }
}

/**
 * Ids the save names that the running story does not have, deduplicated and sorted.
 *
 * Mirrors every lookup `deserialize` performs that throws on a miss, and only those. Sounds,
 * backlog lines and NVL speakers are left out on purpose: the engine already skips those quietly,
 * and refusing a load over one would be stricter than the engine itself.
 */
export function collectUnresolvedSaveReferences(savedGame: SavedGame, maps: SaveStoryMaps): string[] {
    const missing = new Set<string>();
    const requireElement = (id: unknown): void => {
        if (typeof id === "string" && !maps.hasElement(id)) {
            missing.add(id);
        }
    };

    const game = savedGame.game as unknown as Record<string, unknown>;

    for (const entry of game.elementStates as unknown[]) {
        if (isRecord(entry)) {
            requireElement(entry.id);
        }
    }

    const stage = game.stage as unknown as Record<string, unknown>;
    for (const scene of stage.scenes as unknown[]) {
        if (!isRecord(scene)) {
            continue;
        }
        requireElement(scene.sceneId);
        const elements = scene.elements;
        const layers = isRecord(elements) ? elements.layers : undefined;
        if (!isRecord(layers)) {
            continue;
        }
        for (const [layerId, displayables] of Object.entries(layers)) {
            requireElement(layerId);
            if (Array.isArray(displayables)) {
                for (const displayableId of displayables) {
                    requireElement(displayableId);
                }
            }
        }
    }
    for (const entry of stage.videos as unknown[]) {
        if (Array.isArray(entry)) {
            requireElement(entry[0]);
        }
    }
    if (Array.isArray(stage.vfx)) {
        for (const entry of stage.vfx) {
            if (Array.isArray(entry)) {
                requireElement(entry[0]);
            }
        }
    }

    const actionIds = new Set<string>();
    collectStackActionIds(game.stackModel, actionIds);
    for (const stack of game.asyncStackModels as unknown[]) {
        collectStackActionIds(stack, actionIds);
    }
    for (const actionId of actionIds) {
        if (!maps.hasAction(actionId)) {
            missing.add(actionId);
        }
    }

    return Array.from(missing).sort();
}

/** The ids a single author-facing line names, at most {@link REPORTED_ID_LIMIT} of them. */
function formatIdList(ids: string[]): string {
    return ids.slice(0, REPORTED_ID_LIMIT).join(", ");
}

/** The one line the player is shown. Chosen by the story hash and by nothing else. */
function refusalMessageForPlayer(origin: SaveStoryOrigin): string {
    return origin === "otherStory"
        ? translate("game.saveLoad.refusedOtherStory")
        : translate("game.saveLoad.refused");
}

/**
 * Load a save into the running game, or leave that game exactly as it was.
 *
 * Resolves either way. A refusal is a normal outcome of loading an old save, not an exception: the
 * player has been told, the author has been told, and the caller reads {@link SaveLoadOutcome} if
 * it wants to know.
 */
export async function loadSaveIntoGame(options: LoadSaveOptions): Promise<SaveLoadOutcome> {
    const { id, readRecord, game } = options;

    // Telling somebody is the last step of a refusal, so a channel that is itself unavailable must
    // not turn the refusal back into a throw.
    const notifyPlayer = (message: string): void => {
        try {
            options.notifyPlayer(message);
        } catch {
            /* the outcome still stands */
        }
    };
    const report = (level: "warning" | "error", message: string): void => {
        try {
            options.report(level, message);
        } catch {
            /* the outcome still stands */
        }
    };

    const refuse = (
        reason: SaveLoadRefusalReason,
        detail: string,
        extra?: { unresolvedIds?: string[]; game?: RunningGameState; origin?: SaveStoryOrigin },
    ): SaveLoadOutcome => {
        const runningGame = extra?.game ?? "unchanged";
        const outcome: SaveLoadOutcome = {
            status: "refused",
            reason,
            origin: extra?.origin ?? "unknown",
            detail,
            unresolvedIds: extra?.unresolvedIds ?? [],
            game: runningGame,
        };
        notifyPlayer(refusalMessageForPlayer(outcome.origin));
        report(
            runningGame === "lost" ? "error" : "warning",
            runningGame === "lost"
                ? translate("game.saveLoad.notRestored", { id, detail })
                : translate("game.saveLoad.notApplied", { id, detail }),
        );
        return outcome;
    };

    let record: { savedGame: unknown } | null;
    try {
        record = await readRecord();
    } catch (error) {
        return refuse("unreadable", translate("game.saveLoad.detail.unreadable", { error: errorText(error) }));
    }

    if (!record || record.savedGame === null || record.savedGame === undefined) {
        return refuse("missing", translate("game.saveLoad.detail.missing"));
    }
    if (!isSavedGameShape(record.savedGame)) {
        return refuse("malformed", translate("game.saveLoad.detail.malformed"));
    }

    const savedGame = record.savedGame;
    // Both of these read the running story, and both are allowed to be unavailable. An engine that
    // refuses to answer costs a report its precision, or costs the pre-check, and neither is worth
    // failing a load the player asked for.
    let liveStoryHash: string | null;
    try {
        liveStoryHash = game.readStoryHash();
    } catch {
        liveStoryHash = null;
    }
    const origin = compareSaveStory(savedGame, liveStoryHash);

    let maps: SaveStoryMaps | null;
    try {
        maps = game.resolveStoryMaps();
    } catch {
        maps = null;
    }
    if (maps) {
        const unresolvedIds = collectUnresolvedSaveReferences(savedGame, maps);
        if (unresolvedIds.length > 0) {
            return refuse(
                "unresolved",
                translate("game.saveLoad.detail.unresolved", { ids: formatIdList(unresolvedIds) }),
                { unresolvedIds, origin },
            );
        }
    }

    // Taken last, so it holds the run right up to the swap. A game that cannot be serialized still
    // gets the load attempted: the pre-check has already cleared it, and refusing here would turn a
    // missing safety net into a missing feature.
    let rollback: SavedGame | null;
    try {
        rollback = game.snapshot();
    } catch {
        rollback = null;
    }

    try {
        game.apply(savedGame);
    } catch (error) {
        let restored = false;
        if (rollback) {
            try {
                game.restore(rollback);
                restored = true;
            } catch {
                // Both the save and the snapshot were refused. The outcome says so rather than
                // reporting a load that did not happen as one that did.
            }
        }
        return refuse("engine", translate("game.saveLoad.detail.engine", { error: errorText(error) }), {
            origin,
            game: restored ? "restored" : "lost",
        });
    }

    if (origin === "otherStory") {
        report("warning", translate("game.saveLoad.otherStory", { id }));
    }
    return { status: "loaded", origin };
}
