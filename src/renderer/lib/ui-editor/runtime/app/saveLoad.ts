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
import type { TranslationKey } from "@shared/i18n";
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
  /**
   * Called only when {@link restore} itself threw, to leave the session able to be asked again.
   *
   * A load takes the engine's roll lock and gives it back from a render that a throw never
   * reaches. The lock is a flag rather than a count, so one that is never given back stays taken
   * for the life of the session and every later load is dead on arrival. Releasing it does not
   * repair the stage; it stops one failure from silently becoming a permanent one.
   */
  releaseLoadLock?: () => void;
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
export function compareSaveStory(
  savedGame: unknown,
  liveStoryHash: string | null
): SaveStoryOrigin {
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

const NO_UNRESOLVED_REFERENCES: UnresolvedSaveReferences = {
  scenes: [],
  elements: [],
  actions: [],
  all: []
};

/**
 * What the save names that the running story does not have.
 *
 * Mirrors every lookup `deserialize` performs that throws on a miss, and only those. Sounds,
 * backlog lines and NVL speakers are left out on purpose: the engine already skips those quietly,
 * and refusing a load over one would be stricter than the engine itself.
 */
export function collectUnresolvedSaveReferences(
  savedGame: SavedGame,
  maps: SaveStoryMaps
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
  const elements = Array.from(missingElements)
    .filter((id) => !missingScenes.has(id))
    .sort();
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
  lost: { level: "error", key: "game.saveLoad.notRestored" }
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

  const refuse = (
    reason: SaveLoadRefusalReason,
    detail: string,
    extra?: { unresolvedIds?: string[]; game?: RunningGameState; origin?: SaveStoryOrigin }
  ): SaveLoadOutcome => {
    const runningGame = extra?.game ?? "unchanged";
    const outcome: SaveLoadOutcome = {
      status: "refused",
      reason,
      origin: extra?.origin ?? "unknown",
      detail,
      unresolvedIds: extra?.unresolvedIds ?? [],
      game: runningGame
    };
    notifyPlayer(refusalMessageForPlayer(outcome.origin));
    // One sentence per state, because the three states are three different things to have
    // happened to the run. Saying "unchanged" after a rollback would be false: the stage was
    // reset and rebuilt on the way there.
    const { level, key } = AUTHOR_REPORT_BY_GAME_STATE[runningGame];
    report(level, translate(key, { id, detail }));
    return outcome;
  };

  let record: { savedGame: unknown } | null;
  try {
    record = await readRecord();
  } catch (error) {
    return refuse(
      "unreadable",
      translate("game.saveLoad.detail.unreadable", { error: errorText(error) })
    );
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
      { unresolvedIds: unresolved.all, origin }
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
      game: restored ? "restored" : "lost"
    });
  }

  if (origin === "otherStory") {
    report("warning", translate("game.saveLoad.otherStory", { id }));
  }
  return { status: "loaded", origin };
}
