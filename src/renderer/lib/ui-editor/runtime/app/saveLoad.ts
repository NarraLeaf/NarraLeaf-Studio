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
 * The engine's own story hash still never decides whether a load happens. It picks the sentence the
 * player is shown and raises a note to the author, and that is all it has ever done here.
 *
 * What *can* stop a load is the author's own policy, decided from the stamp Studio writes into every
 * record: the save protocol, the story this build ships, and the author's version. That decision is
 * taken from the record header, before the first of the two layers above, and from the very same
 * bytes a save screen's listing decided from - so a slot that was offered is a slot that loads, and
 * one that was hidden is not quietly accepted here. See `@shared/types/saveCompatibility`.
 */
import type { SavedGame } from "narraleaf-react";
import type { TranslationKey } from "@shared/i18n";
import {
    planSaveResume,
    readSaveCompatibilityStamp,
    type SaveCompatibility,
    type SaveCompatibilityConfiguration,
    type SaveCompatibilityStamp,
} from "@shared/types/saveCompatibility";
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
    /** A record shape this build cannot read at all. Not the author's policy - see the type. */
    | "unsupported"
    /** The author's save-compatibility policy does not offer saves from this build. */
    | "policy"
    /** The policy asks for a relaunch and the save says nowhere to relaunch to. */
    | "unanchored"
    /** The relaunch itself would not start. */
    | "relaunch"
    /** The save names scenes, elements or actions the running story does not have. */
    | "unresolved"
    /** The engine refused it for something this module does not model. */
    | "engine";

/**
 * What happened to the game that was running.
 *
 * `restored` is narrower than it sounds, and the wording anywhere it is reported has to stay inside
 * these bounds. Putting the game back is one more `deserialize`, so it carries what a save carries:
 * the store, the element states, the stage, the execution stacks and the backlog. Three things it
 * does not carry, none of which a save has ever held:
 *
 *  - **The page router stack.** Entering the live game clears it, and nothing puts it back, so a
 *    player who was reading a menu page lands on the stage.
 *  - **Sound restores already in flight.** `AudioManager.soundFromData` starts playback without
 *    waiting for it, so clips the refused save named can still be starting while the ones the
 *    snapshot names start too. A clip belonging to neither state can be left playing.
 *  - **Anything a host attached outside the engine**, which is the host's to re-attach.
 *
 * Restoring the rest of that is a separate piece of work and is deliberately not attempted here.
 */
export type RunningGameState =
    /** It was never entered. Nothing about it moved. */
    | "unchanged"
    /** It was entered and put back from the snapshot taken beforehand, within the bounds above. */
    | "restored"
    /**
     * It was entered and could not be put back. The engine's roll lock is released on the way out
     * so the session can still be asked to load again, but what is on stage is neither state.
     */
    | "lost";

/**
 * How much of the save the player actually got back.
 *
 * `save` is a load. The other two are the `Return to where it stopped` policy taking effect: the
 * story is started again at the position the save names, carrying the saved-scope values across but
 * not the stage, the stacks or the backlog. They are told apart because the difference is visible
 * to the player - one puts them on the line they left, the other at the top of the scene.
 */
export type SaveApplied = "save" | "row" | "scene";

export type SaveLoadOutcome =
    | { status: "loaded"; applied: SaveApplied; origin: SaveStoryOrigin; compatibility: SaveCompatibility }
    | {
          status: "refused";
          reason: SaveLoadRefusalReason;
          origin: SaveStoryOrigin;
          compatibility: SaveCompatibility;
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
    /**
     * Called only when {@link restore} itself threw, to leave the session able to be asked again.
     *
     * A load takes the engine's roll lock and gives it back from a render that a throw never
     * reaches. The lock is a flag rather than a count, so one that is never given back stays taken
     * for the life of the session and every later load is dead on arrival. Releasing it does not
     * repair the stage; it stops one failure from silently becoming a permanent one.
     */
    releaseLoadLock?: () => void;
    /**
     * Start the story again where the save was, instead of loading the save.
     *
     * Only ever called for the `Return to where it stopped` policy. It is the host's operation
     * rather than the engine's: putting a player back at a row is a story launch, which needs the
     * compiler, the bundle and the surface stack - none of which this module has or should have.
     * Omitted by a host that cannot start a story, which turns the policy into a refusal rather
     * than into a silent nothing.
     *
     * It reports where the player actually landed, because that is another thing only the host can
     * know - and one it must not be left to infer from a throw. A launch handed a row the story no
     * longer has does NOT fail: the playback walk treats a dangling row as "play the scene from the
     * top" and says nothing, so a caller watching for an exception would report a row-precise
     * return that never happened.
     */
    relaunch?: (target: SaveRelaunchTarget) => Promise<SaveRelaunchLanding>;
};

/**
 * Where a relaunch put the player.
 *
 * The three answers are the whole of `Return to where it stopped`: the row if the story still has
 * it, the top of its scene if only the scene survived, and nothing at all if the scene is gone too.
 */
export type SaveRelaunchLanding =
    /** On the row the save stopped on. */
    | "row"
    /** At the top of the scene the save was in; the row itself is no longer in the story. */
    | "scene"
    /** Nowhere - this build has no such scene. Nothing was started and nothing was touched. */
    | "nowhere";

/** Where a relaunch should put the player, and what to carry there. */
export type SaveRelaunchTarget = {
    /** Blank when the save's position named no story; the host resolves one from the scene. */
    storyId: string;
    sceneId: string;
    /** The row the save stopped on, or null when its position named only a scene. */
    blockId: string | null;
    /** The save being honoured, so the host can carry its saved-scope values across. */
    savedGame: SavedGame;
};

export type LoadSaveOptions = {
    /** The slot being loaded, for the author-facing line. */
    id: string;
    /**
     * Reads the stored record. A throw here is a refusal, not a crash.
     *
     * The header travels with it because the decision that comes first is made from the header
     * alone - and is made from the very same bytes a listing decided from, which is what keeps a
     * slot a save screen offers a slot that loads.
     */
    readRecord: () => Promise<{
        savedGame: unknown;
        metadata?: { compatibility?: SaveCompatibilityStamp };
    } | null>;
    game: SaveLoadGameSeam;
    /** What this build is, for comparing against the save's own stamp. Null disables the comparison. */
    currentStamp: SaveCompatibilityStamp | null;
    /** The author's policy for saves from another build. */
    compatibilityConfig: SaveCompatibilityConfiguration;
    /** Shows one line inside the running game. */
    notifyPlayer: (message: string) => void;
    /** Reports to whoever is watching the run. */
    report: (level: "warning" | "error", message: string) => void;
};

/** How much of the save's last line a report quotes. */
const SAVE_LINE_LIMIT = 60;

/**
 * How long the player's line stays up.
 *
 * Longer than the engine's 3000ms default: this one explains why a button the player pressed did
 * nothing, and the default is tuned for text that repeats what just happened on screen.
 */
export const SAVE_LOAD_NOTICE_DURATION_MS = 6000;

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
 * What a save named that the running story does not have, split by what kind of thing it is.
 *
 * Split rather than pooled because the ids themselves are unreadable. They are the engine's own
 * counters (`e-14`, `a-41`), they are assigned at compile time, and the ones that turn up here are
 * by definition the ones that no longer exist, so nothing left in the project can name them. What
 * an author can act on is the kind: a scene that is gone is a scene they deleted.
 */
export type UnresolvedSaveReferences = {
    /** Scenes the save was posing. The one an author recognises. */
    scenes: string[];
    /** Layers, images, videos and effects the save had on stage. */
    elements: string[];
    /** Story rows the save's execution stacks were sitting on. */
    actions: string[];
    /** All of the above, deduplicated and sorted. Raw ids, for a debug view rather than a sentence. */
    all: string[];
};

const NO_UNRESOLVED_REFERENCES: UnresolvedSaveReferences = { scenes: [], elements: [], actions: [], all: [] };

/**
 * What the save names that the running story does not have.
 *
 * Mirrors every lookup `deserialize` performs that throws on a miss, and only those. Sounds,
 * backlog lines and NVL speakers are left out on purpose: the engine already skips those quietly,
 * and refusing a load over one would be stricter than the engine itself.
 */
export function collectUnresolvedSaveReferences(
    savedGame: SavedGame,
    maps: SaveStoryMaps,
): UnresolvedSaveReferences {
    const missingScenes = new Set<string>();
    const missingElements = new Set<string>();
    const missingActions = new Set<string>();
    const requireScene = (id: unknown): void => {
        if (typeof id === "string" && !maps.hasElement(id)) {
            missingScenes.add(id);
        }
    };
    const requireElement = (id: unknown): void => {
        if (typeof id === "string" && !maps.hasElement(id)) {
            missingElements.add(id);
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
        requireScene(scene.sceneId);
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
            missingActions.add(actionId);
        }
    }

    const scenes = Array.from(missingScenes).sort();
    // A scene also has an entry in `elementStates`, which is walked as a plain element. Counted in
    // both buckets it would read as two separate things gone, so the more specific bucket wins.
    const elements = Array.from(missingElements).filter(id => !missingScenes.has(id)).sort();
    const actions = Array.from(missingActions).sort();
    return { scenes, elements, actions, all: [...scenes, ...elements, ...actions].sort() };
}

/**
 * How a refusal describes what the story is missing.
 *
 * One sentence naming the kind, in the order an author would recognise it: a deleted scene explains
 * everything else that went with it, so it is said first and the layers and images that vanished
 * alongside it are not restated. The ids stay off this line and travel on the outcome instead - see
 * {@link UnresolvedSaveReferences} for why none of them can be named.
 */
function unresolvedDetailKey(unresolved: UnresolvedSaveReferences): TranslationKey {
    if (unresolved.scenes.length > 0) {
        return "game.saveLoad.detail.unresolvedScene";
    }
    if (unresolved.elements.length > 0) {
        return "game.saveLoad.detail.unresolvedElement";
    }
    return "game.saveLoad.detail.unresolvedAction";
}

/**
 * The line the save was sitting on, as an author reads it.
 *
 * `meta.lastSentence` is written on every serialize and is the save's own words, which is the one
 * author-facing thing a save carries about where it was. It survives the scene being deleted, which
 * is exactly when it is needed.
 */
export function readSaveLastLine(savedGame: unknown): string | null {
    if (!isRecord(savedGame) || !isRecord(savedGame.meta)) {
        return null;
    }
    const sentence = savedGame.meta.lastSentence;
    if (typeof sentence !== "string") {
        return null;
    }
    const trimmed = sentence.trim().replace(/\s+/g, " ");
    if (!trimmed) {
        return null;
    }
    return trimmed.length > SAVE_LINE_LIMIT ? `${trimmed.slice(0, SAVE_LINE_LIMIT)}…` : trimmed;
}

/**
 * Where a save stopped, in the terms a story launch takes.
 *
 * `storyId` is blank when only a scene could be recovered; the host fills it in from the library.
 */
export type SavePosition = {
    storyId: string;
    sceneId: string;
    blockId: string | null;
};

/**
 * The Studio ids buried in one compiled anchor.
 *
 * Both anchor shapes carry them in fixed leading positions - `studio:<story>:<scene>:<block>:…` for
 * an action and `nl:scene:<scene>` for a scene element - which is the same reading `saveAnchors.ts`
 * does on the build side. Nothing else can be read out of an anchor: the trailing fields are the
 * compiler's own counters.
 */
function parseActionAnchor(anchor: unknown): SavePosition | null {
    if (typeof anchor !== "string") {
        return null;
    }
    const parts = anchor.split(":");
    if (parts[0] !== "studio" || parts.length < 4 || !parts[1] || !parts[2]) {
        return null;
    }
    return { storyId: parts[1], sceneId: parts[2], blockId: parts[3] || null };
}

function parseSceneAnchor(anchor: unknown): SavePosition | null {
    if (typeof anchor !== "string") {
        return null;
    }
    const parts = anchor.split(":");
    // Exactly three: `nl:scene:<id>` is the scene, `nl:scene:<id>:layer:background` is a part of it.
    if (parts[0] !== "nl" || parts[1] !== "scene" || parts.length !== 3 || !parts[2]) {
        return null;
    }
    return { storyId: "", sceneId: parts[2], blockId: null };
}

/** The first action anchor a serialized stack names, walking nested stacks. Top-first. */
function findStackActionAnchor(stack: unknown): string | null {
    if (!isRecord(stack) || !Array.isArray(stack.items)) {
        return null;
    }
    for (const item of stack.items) {
        if (!isRecord(item)) {
            continue;
        }
        if (typeof item.action === "string" && item.action) {
            return item.action;
        }
        if (Array.isArray(item.stacks)) {
            for (const nested of item.stacks) {
                const found = findStackActionAnchor(nested);
                if (found) {
                    return found;
                }
            }
        }
    }
    return null;
}

/**
 * Where the save was, from the three things that know it, best first.
 *
 * The backlog is asked first because its last entry is the line the player last saw, which is the
 * one place a person would say they were - and it survives on saves the execution stack cannot be
 * read out of. The stack is next, and the posed scene last: it names only a scene, which is enough
 * to put somebody back at the top of a chapter and not enough to put them on a row.
 */
export function readSavePosition(savedGame: unknown): SavePosition | null {
    if (!isRecord(savedGame) || !isRecord(savedGame.game)) {
        return null;
    }
    const game = savedGame.game as Record<string, unknown>;
    const history = game.history;
    if (Array.isArray(history)) {
        for (let index = history.length - 1; index >= 0; index--) {
            const entry = history[index];
            const position = isRecord(entry) ? parseActionAnchor(entry.actionId) : null;
            if (position) {
                return position;
            }
        }
    }
    const fromStack = parseActionAnchor(findStackActionAnchor(game.stackModel));
    if (fromStack) {
        return fromStack;
    }
    const stage = game.stage;
    const scenes = isRecord(stage) && Array.isArray(stage.scenes) ? stage.scenes : [];
    // Last rather than first: scenes are posed in the order they were entered, so the one on top is
    // the one the player is looking at.
    for (let index = scenes.length - 1; index >= 0; index--) {
        const scene = scenes[index];
        const position = isRecord(scene) ? parseSceneAnchor(scene.sceneId) : null;
        if (position) {
            return position;
        }
    }
    return null;
}

/**
 * How loudly each ending is reported, decided once here.
 *
 * `restored` shares the warning level with `unchanged` rather than taking the error one: the load
 * did not happen and the run came back, which is the ordinary end of an old save either way. They
 * are told apart by their wording, not by their severity. `lost` is the only one where something is
 * actually broken afterwards.
 */
const AUTHOR_REPORT_BY_GAME_STATE = {
    unchanged: { level: "warning", key: "game.saveLoad.notApplied" },
    restored: { level: "warning", key: "game.saveLoad.putBack" },
    lost: { level: "error", key: "game.saveLoad.notRestored" },
} as const satisfies Record<RunningGameState, { level: "warning" | "error"; key: TranslationKey }>;

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

    // Filled in as soon as the record is in hand; a refusal raised before that reports the state it
    // could not compare, which is exactly "unknown".
    let compatibility: SaveCompatibility = "unknown";

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
            compatibility,
            detail,
            unresolvedIds: extra?.unresolvedIds ?? [],
            game: runningGame,
        };
        notifyPlayer(refusalMessageForPlayer(outcome.origin));
        // One sentence per state, because the three states are three different things to have
        // happened to the run. Saying "unchanged" after a rollback would be false: the stage was
        // reset and rebuilt on the way there.
        const { level, key } = AUTHOR_REPORT_BY_GAME_STATE[runningGame];
        report(level, translate(key, { id, detail }));
        return outcome;
    };

    let record: Awaited<ReturnType<typeof readRecord>>;
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

    // The author's policy, before anything is touched and from the same header the listing read.
    const resume = planSaveResume(
        readSaveCompatibilityStamp(record.metadata?.compatibility),
        options.currentStamp,
        options.compatibilityConfig,
    );
    compatibility = resume.compatibility;
    if (resume.plan.action === "discard") {
        return refuse(
            resume.plan.reason === "protocol" ? "unsupported" : "policy",
            translate(resume.plan.reason === "protocol"
                ? "game.saveLoad.detail.unsupported"
                : "game.saveLoad.detail.policy"),
            { origin },
        );
    }
    if (resume.plan.action === "relaunch") {
        const position = readSavePosition(savedGame);
        if (!position || !game.relaunch) {
            return refuse("unanchored", translate("game.saveLoad.detail.unanchored"), { origin });
        }
        // The row is always asked for. Whether it is still there is the host's to answer, and it
        // answers by saying where it landed rather than by throwing - see `relaunch`.
        let landing: SaveRelaunchLanding;
        try {
            landing = await game.relaunch({
                storyId: position.storyId,
                sceneId: position.sceneId,
                blockId: position.blockId,
                savedGame,
            });
        } catch (error) {
            // A relaunch that threw got far enough to recompile and remount, so whatever is on
            // stage is neither the save nor what was running. Said plainly rather than reported as
            // an untouched game. "Nowhere to go" is not this: it comes back as a landing.
            return refuse("relaunch", translate("game.saveLoad.detail.relaunch", { error: errorText(error) }), {
                origin,
                game: "lost",
            });
        }
        if (landing === "nowhere") {
            return refuse("unanchored", translate("game.saveLoad.detail.sceneGone"), { origin });
        }
        report("warning", translate(
            landing === "row" ? "game.saveLoad.relaunchedRow" : "game.saveLoad.relaunchedScene",
            { id },
        ));
        return { status: "loaded", applied: landing, origin, compatibility };
    }

    // The whole pre-check, resolution included, sits inside one guard. It is an optimisation over
    // the snapshot, not a step of the load: a table that answers oddly must cost the pre-check and
    // nothing else, or the safety net becomes the thing that drops the load.
    let unresolved: UnresolvedSaveReferences = NO_UNRESOLVED_REFERENCES;
    try {
        const maps = game.resolveStoryMaps();
        if (maps) {
            unresolved = collectUnresolvedSaveReferences(savedGame, maps);
        }
    } catch {
        unresolved = NO_UNRESOLVED_REFERENCES;
    }
    if (unresolved.all.length > 0) {
        const line = readSaveLastLine(savedGame);
        const what = translate(unresolvedDetailKey(unresolved));
        return refuse(
            "unresolved",
            // The quoted line is a locator, not part of the finding, so it is wrapped around the
            // finding rather than glued after it: a locale that puts it first can.
            line ? translate("game.saveLoad.detail.savedAt", { detail: what, line }) : what,
            { unresolvedIds: unresolved.all, origin },
        );
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
                // Both the save and the snapshot were refused. Give the roll lock back before
                // giving up: without it this one failure silently kills every later load in the
                // session, which surfaces much later as a second, unrelated-looking fault.
                try {
                    game.releaseLoadLock?.();
                } catch {
                    /* nothing further is available */
                }
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
    return { status: "loaded", applied: "save", origin, compatibility };
}
