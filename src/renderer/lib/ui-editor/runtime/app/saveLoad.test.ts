import { describe, expect, it } from "vitest";
import type { SavedGame } from "narraleaf-react";
import { translate } from "@/lib/i18n";
import {
  collectUnresolvedSaveReferences,
  compareSaveStory,
  readSaveLastLine,
  isSavedGameShape,
  loadSaveIntoGame,
  readSaveStoryHash,
  type SaveLoadGameSeam,
  type SaveStoryMaps
} from "./saveLoad";

const LIVE_STORY_HASH = "hash-live";

/** Where the player is: the four things a failed load must not move. */
type PlayHead = { sceneId: string; line: number; backlog: string[]; audio: string };

const BLANK: PlayHead = { sceneId: "", line: 0, backlog: [], audio: "" };

type SaveOptions = {
  storyHash?: string;
  actionId?: string;
  layerId?: string;
  /** Explicit null models a save the engine could not stamp a last line onto. */
  lastSentence?: string | null;
};

/** The save's own words, the only author-facing thing it carries about where it stopped. */
const LAST_LINE = "the clubroom smelled of chalk";

/**
 * A save in the shape the engine writes, carrying the play head in `services` so a save and a play
 * head convert into each other exactly. `stage`, `stackModel` and `elementStates` carry the ids the
 * pre-check reads.
 */
function makeSave(head: PlayHead, options: SaveOptions = {}): SavedGame {
  const actionId = options.actionId ?? "action-1";
  const layerId = options.layerId ?? "layer-main";
  return {
    name: "slot",
    meta: {
      created: 1,
      updated: 2,
      id: "save-meta-id",
      lastSentence: options.lastSentence === undefined ? LAST_LINE : options.lastSentence,
      lastSpeaker: null,
      storyHash: options.storyHash ?? LIVE_STORY_HASH,
      version: 2
    },
    game: {
      store: { game: {} },
      elementStates: [{ id: head.sceneId, data: {} }],
      services: { playHead: { line: head.line, backlog: head.backlog, audio: head.audio } },
      stage: {
        scenes: [{ sceneId: head.sceneId, elements: { layers: { [layerId]: [] } } }],
        audio: { sounds: [], groups: [["bgm", 1]] },
        videos: [],
        vfx: []
      },
      stackModel: { items: [{ type: "action", actionType: "character:say", action: actionId }] },
      asyncStackModels: [],
      history: head.backlog.map((text) => ({
        actionId,
        element: { type: "say", text },
        snapshot: null
      }))
    }
  } as unknown as SavedGame;
}

function readPlayHead(savedGame: SavedGame): PlayHead {
  const game = savedGame.game as unknown as Record<string, any>;
  return {
    sceneId: String(game.stage.scenes[0].sceneId),
    line: Number(game.services.playHead.line),
    backlog: [...game.services.playHead.backlog],
    audio: String(game.services.playHead.audio)
  };
}

type HarnessOptions = {
  head: PlayHead;
  knownElements?: string[];
  knownActions?: string[];
  /** Modelled as the engine losing its map table entirely. */
  mapsAvailable?: boolean;
  /** A throw the pre-check does not model, raised after the reset `apply` performs. */
  applyThrows?: string;
  /** A live game that cannot be serialized, so there is nothing to put it back with. */
  snapshotFails?: boolean;
  /** The rollback is refused as well, which is the only way the run is really gone. */
  restoreThrows?: string;
  /** An engine that keeps the name and changes the answer. */
  brokenMaps?: "wrongShape" | "throws";
};

function createHarness(options: HarnessOptions) {
  const elements = new Set(options.knownElements ?? [options.head.sceneId, "layer-main"]);
  const actions = new Set(options.knownActions ?? ["action-1"]);
  const notifications: string[] = [];
  const reports: { level: "warning" | "error"; message: string }[] = [];
  /** Which engine operations the load reached. The live game is only entered through these. */
  const calls = { snapshot: 0, apply: 0, restore: 0, releaseLoadLock: 0 };
  let head: PlayHead = { ...options.head, backlog: [...options.head.backlog] };
  let applyThrows = options.applyThrows;

  const maps: SaveStoryMaps = {
    hasAction: (id) => actions.has(id),
    hasElement: (id) => elements.has(id)
  };

  // The engine resets the stage and remounts before it looks anything up, so anything that throws
  // after this point has already spent the run. The fake does the same or the rollback would be
  // testing nothing.
  const put = (savedGame: SavedGame): void => {
    head = { ...BLANK };
    const next = readPlayHead(savedGame);
    if (!elements.has(next.sceneId)) {
      throw new Error(`Scene not found, id: ${next.sceneId}`);
    }
    head = next;
  };

  const game: SaveLoadGameSeam = {
    resolveStoryMaps: () => {
      if (options.brokenMaps === "throws") {
        throw new Error("No story loaded");
      }
      if (options.brokenMaps === "wrongShape") {
        // What the engine's own stubs hand back: the name resolves, the shape does not.
        return [new Map()] as unknown as SaveStoryMaps;
      }
      return options.mapsAvailable === false ? null : maps;
    },
    readStoryHash: () => LIVE_STORY_HASH,
    snapshot: () => {
      calls.snapshot += 1;
      if (options.snapshotFails) {
        throw new Error("The game has not started");
      }
      return makeSave(head);
    },
    apply: (savedGame) => {
      calls.apply += 1;
      put(savedGame);
      if (applyThrows) {
        head = { ...BLANK };
        throw new Error(applyThrows);
      }
    },
    restore: (savedGame) => {
      calls.restore += 1;
      if (options.restoreThrows) {
        head = { ...BLANK };
        throw new Error(options.restoreThrows);
      }
      // The rollback save came from this very story, so it never hits the throw above.
      applyThrows = undefined;
      put(savedGame);
    },
    releaseLoadLock: () => {
      calls.releaseLoadLock += 1;
    }
  };

  return {
    game,
    notifications,
    reports,
    calls,
    notifyPlayer: (message: string) => notifications.push(message),
    report: (level: "warning" | "error", message: string) => reports.push({ level, message }),
    head: () => head,
    /** The run as bytes, for asserting a rollback put every field back. */
    serialize: () => JSON.stringify(makeSave(head))
  };
}

function loadWith(
  harness: ReturnType<typeof createHarness>,
  record: { savedGame: unknown } | null,
  id = "slot-1"
) {
  return loadSaveIntoGame({
    id,
    readRecord: async () => record,
    game: harness.game,
    notifyPlayer: harness.notifyPlayer,
    report: harness.report
  });
}

const PLAYING: PlayHead = {
  sceneId: "scene-a",
  line: 3,
  backlog: ["one", "two"],
  audio: "bgm:town"
};

describe("loadSaveIntoGame", () => {
  it("advances the run when the save loads", async () => {
    const harness = createHarness({ head: PLAYING });
    const saved = makeSave({
      sceneId: "scene-a",
      line: 9,
      backlog: ["one", "two", "three"],
      audio: "bgm:night"
    });

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toEqual({ status: "loaded", origin: "sameStory" });
    expect(harness.head()).toEqual({
      sceneId: "scene-a",
      line: 9,
      backlog: ["one", "two", "three"],
      audio: "bgm:night"
    });
    expect(harness.notifications).toEqual([]);
    expect(harness.reports).toEqual([]);
  });

  /**
   * The live game is only reachable through `apply`, `snapshot` and `restore`, so "the run did not
   * move" is asserted as "none of them ran". Asserting the play head instead would pass against
   * the old code on the paths that threw before touching anything; this does not, because the old
   * code reached `apply` here and blew up inside it.
   */
  it("never enters the live game when the save's scene is gone", async () => {
    const harness = createHarness({ head: PLAYING });
    const saved = makeSave(
      { sceneId: "scene-deleted", line: 40, backlog: ["elsewhere"], audio: "bgm:cave" },
      { storyHash: "hash-older-build" }
    );

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toMatchObject({
      status: "refused",
      reason: "unresolved",
      origin: "otherStory",
      unresolvedIds: ["scene-deleted"],
      game: "unchanged"
    });
    expect(harness.calls).toEqual({ snapshot: 0, apply: 0, restore: 0, releaseLoadLock: 0 });
    expect(harness.notifications).toEqual([translate("game.saveLoad.refusedOtherStory")]);
    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0].level).toBe("warning");
    // Names the kind and quotes the save's own line. The compiled ids stay off it: nothing left
    // in the project can name `scene-deleted`, so putting it there would spend the sentence on
    // a string the author has never seen.
    expect(harness.reports[0].message).toBe(
      translate("game.saveLoad.notApplied", {
        id: "slot-1",
        detail: translate("game.saveLoad.detail.savedAt", {
          detail: translate("game.saveLoad.detail.unresolvedScene"),
          line: LAST_LINE
        })
      })
    );
    expect(harness.reports[0].message).not.toContain("scene-deleted");
  });

  it("carries every unresolved id on the outcome, for the panel that shows them", async () => {
    const harness = createHarness({ head: PLAYING, knownActions: [] });
    const saved = makeSave({ sceneId: "scene-deleted", line: 1, backlog: [], audio: "" });

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toMatchObject({
      status: "refused",
      unresolvedIds: ["action-1", "scene-deleted"]
    });
  });

  it("says the rows are gone, not the scene, when only actions are missing", async () => {
    const harness = createHarness({ head: PLAYING, knownActions: [] });
    const saved = makeSave(
      { sceneId: "scene-a", line: 4, backlog: [], audio: "" },
      { lastSentence: null }
    );

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toMatchObject({
      status: "refused",
      reason: "unresolved",
      unresolvedIds: ["action-1"]
    });
    // No last line on this save, so the locator is left off rather than quoted empty.
    expect(harness.reports[0].message).toBe(
      translate("game.saveLoad.notApplied", {
        id: "slot-1",
        detail: translate("game.saveLoad.detail.unresolvedAction")
      })
    );
  });

  it("says the stage is short of something when only elements are missing", async () => {
    const harness = createHarness({ head: PLAYING, knownElements: ["scene-a"] });
    const saved = makeSave({ sceneId: "scene-a", line: 4, backlog: [], audio: "" });

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toMatchObject({
      status: "refused",
      reason: "unresolved",
      unresolvedIds: ["layer-main"]
    });
    expect(harness.reports[0].message).toContain(
      translate("game.saveLoad.detail.unresolvedElement")
    );
  });

  it("never enters the live game when no save is stored", async () => {
    const harness = createHarness({ head: PLAYING });

    const outcome = await loadWith(harness, null);

    expect(outcome).toMatchObject({ status: "refused", reason: "missing", game: "unchanged" });
    expect(harness.calls).toEqual({ snapshot: 0, apply: 0, restore: 0, releaseLoadLock: 0 });
    expect(harness.notifications).toEqual([translate("game.saveLoad.refused")]);
  });

  it("never enters the live game when the stored record is not a saved game", async () => {
    const harness = createHarness({ head: PLAYING });

    const outcome = await loadWith(harness, { savedGame: { game: { stage: {} } } });

    expect(outcome).toMatchObject({ status: "refused", reason: "malformed", game: "unchanged" });
    expect(harness.calls).toEqual({ snapshot: 0, apply: 0, restore: 0, releaseLoadLock: 0 });
    expect(harness.notifications).toEqual([translate("game.saveLoad.refused")]);
  });

  it("never enters the live game when the store cannot be read", async () => {
    const harness = createHarness({ head: PLAYING });

    const outcome = await loadSaveIntoGame({
      id: "slot-1",
      readRecord: async () => {
        throw new Error("save file is locked");
      },
      game: harness.game,
      notifyPlayer: harness.notifyPlayer,
      report: harness.report
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "unreadable", game: "unchanged" });
    expect(harness.calls).toEqual({ snapshot: 0, apply: 0, restore: 0, releaseLoadLock: 0 });
    expect(harness.reports[0].message).toContain("save file is locked");
  });

  it("loads a save from another build of the story, and says so to the author", async () => {
    const harness = createHarness({ head: PLAYING });
    const saved = makeSave(
      { sceneId: "scene-a", line: 12, backlog: ["one"], audio: "bgm:night" },
      { storyHash: "hash-older-build" }
    );

    const outcome = await loadWith(harness, { savedGame: saved }, "slot-7");

    expect(outcome).toEqual({ status: "loaded", origin: "otherStory" });
    expect(harness.head().line).toBe(12);
    expect(harness.notifications).toEqual([]);
    expect(harness.reports).toEqual([
      { level: "warning", message: translate("game.saveLoad.otherStory", { id: "slot-7" }) }
    ]);
  });

  it("says nothing when the save came from this build of the story", async () => {
    const harness = createHarness({ head: PLAYING });
    const saved = makeSave({ sceneId: "scene-a", line: 12, backlog: ["one"], audio: "bgm:night" });

    const outcome = await loadWith(harness, { savedGame: saved });

    expect(outcome).toEqual({ status: "loaded", origin: "sameStory" });
    expect(harness.reports).toEqual([]);
  });

  /**
   * The one place byte-identity is worth asserting: `apply` really did blank the play head here,
   * so the comparison is against a run that was taken apart and rebuilt.
   */
  it("puts the run back when the engine throws past the pre-check", async () => {
    const harness = createHarness({ head: PLAYING, applyThrows: "Storable refused the namespace" });
    const before = harness.serialize();
    const saved = makeSave({ sceneId: "scene-a", line: 12, backlog: ["one"], audio: "bgm:night" });

    const outcome = await loadWith(harness, { savedGame: saved }, "slot-3");

    expect(outcome).toMatchObject({ status: "refused", reason: "engine", game: "restored" });
    expect(harness.calls).toMatchObject({ snapshot: 1, apply: 1, restore: 1, releaseLoadLock: 0 });
    expect(harness.serialize()).toBe(before);
    expect(harness.head()).toEqual(PLAYING);
    expect(harness.reports[0].level).toBe("warning");
    // Not "the running game is unchanged": it was reset and rebuilt on the way here.
    expect(harness.reports[0].message).toBe(
      translate("game.saveLoad.putBack", {
        id: "slot-3",
        detail: translate("game.saveLoad.detail.engine", {
          error: "Storable refused the namespace"
        })
      })
    );
  });

  it("reports the run as lost, and gives the load lock back, when the rollback throws too", async () => {
    const harness = createHarness({
      head: PLAYING,
      applyThrows: "Storable refused the namespace",
      restoreThrows: "Element not found, id: img-3"
    });

    const outcome = await loadWith(harness, { savedGame: makeSave(PLAYING) }, "slot-4");

    expect(outcome).toMatchObject({ status: "refused", reason: "engine", game: "lost" });
    expect(harness.calls).toMatchObject({ apply: 1, restore: 1, releaseLoadLock: 1 });
    expect(harness.head()).toEqual(BLANK);
    expect(harness.reports[0].level).toBe("error");
    expect(harness.reports[0].message).toBe(
      translate("game.saveLoad.notRestored", {
        id: "slot-4",
        detail: translate("game.saveLoad.detail.engine", {
          error: "Storable refused the namespace"
        })
      })
    );
  });

  it("reports the run as lost when there was no snapshot to put it back with", async () => {
    const harness = createHarness({
      head: PLAYING,
      applyThrows: "Storable refused the namespace",
      snapshotFails: true
    });

    const outcome = await loadWith(harness, { savedGame: makeSave(PLAYING) });

    expect(outcome).toMatchObject({ status: "refused", reason: "engine", game: "lost" });
    expect(harness.calls).toMatchObject({ restore: 0 });
    expect(harness.reports[0].level).toBe("error");
  });

  // The three ways the pre-check can be unavailable. None of them may reject, and all of them
  // must fall through to the snapshot, which is what still saves the run.
  it.each([
    ["absent", { mapsAvailable: false } as const],
    ["the wrong shape", { brokenMaps: "wrongShape" } as const],
    ["throwing", { brokenMaps: "throws" } as const]
  ])(
    "still attempts the load, and rolls back, when the id tables are %s",
    async (_label, broken) => {
      const harness = createHarness({ head: PLAYING, ...broken });
      const before = harness.serialize();
      const saved = makeSave({ sceneId: "scene-deleted", line: 40, backlog: [], audio: "" });

      const outcome = await loadWith(harness, { savedGame: saved });

      expect(outcome).toMatchObject({ status: "refused", reason: "engine", game: "restored" });
      expect(harness.calls).toMatchObject({ apply: 1, restore: 1 });
      expect(harness.serialize()).toBe(before);
    }
  );
});

describe("compareSaveStory", () => {
  it("reads the hash the engine writes into every save", () => {
    expect(readSaveStoryHash(makeSave(PLAYING))).toBe(LIVE_STORY_HASH);
    expect(readSaveStoryHash({ meta: {} })).toBeNull();
    expect(readSaveStoryHash("not a save")).toBeNull();
  });

  it("is unknown when either side carries no hash", () => {
    expect(compareSaveStory(makeSave(PLAYING), null)).toBe("unknown");
    expect(compareSaveStory({ meta: { storyHash: "" } }, LIVE_STORY_HASH)).toBe("unknown");
  });

  it("separates this build from any other", () => {
    expect(compareSaveStory(makeSave(PLAYING), LIVE_STORY_HASH)).toBe("sameStory");
    expect(compareSaveStory(makeSave(PLAYING, { storyHash: "other" }), LIVE_STORY_HASH)).toBe(
      "otherStory"
    );
  });
});

describe("isSavedGameShape", () => {
  it("accepts what the engine writes", () => {
    expect(isSavedGameShape(makeSave(PLAYING))).toBe(true);
  });

  it("rejects a record missing a key deserialize destructures", () => {
    const saved = makeSave(PLAYING) as unknown as { game: Record<string, unknown> };
    delete saved.game.elementStates;
    expect(isSavedGameShape(saved)).toBe(false);
  });

  it("rejects values that are not records at all", () => {
    expect(isSavedGameShape(null)).toBe(false);
    expect(isSavedGameShape([])).toBe(false);
    expect(isSavedGameShape("{}")).toBe(false);
  });
});

describe("collectUnresolvedSaveReferences", () => {
  const maps: SaveStoryMaps = {
    hasElement: (id) => id === "scene-a" || id === "layer-main" || id === "img-1",
    hasAction: (id) => id === "action-1"
  };

  it("finds nothing when the running story has everything", () => {
    expect(collectUnresolvedSaveReferences(makeSave(PLAYING), maps)).toEqual({
      scenes: [],
      elements: [],
      actions: [],
      all: []
    });
  });

  it("finds a displayable a layer poses that the story dropped", () => {
    const saved = makeSave(PLAYING) as unknown as { game: Record<string, any> };
    saved.game.stage.scenes[0].elements.layers["layer-main"] = ["img-1", "img-gone"];
    expect(collectUnresolvedSaveReferences(saved as unknown as SavedGame, maps)).toMatchObject({
      scenes: [],
      elements: ["img-gone"],
      all: ["img-gone"]
    });
  });

  it("finds videos and effects the story dropped", () => {
    const saved = makeSave(PLAYING) as unknown as { game: Record<string, any> };
    saved.game.stage.videos = [["video-gone", {}]];
    saved.game.stage.vfx = [["vfx-gone", {}]];
    expect(collectUnresolvedSaveReferences(saved as unknown as SavedGame, maps)).toMatchObject({
      elements: ["vfx-gone", "video-gone"],
      all: ["vfx-gone", "video-gone"]
    });
  });

  it("descends into nested and async stacks, and into loop bodies", () => {
    const saved = makeSave(PLAYING) as unknown as { game: Record<string, any> };
    saved.game.stackModel.items.push({
      type: "link",
      actionType: "control:all",
      action: "action-1",
      stackWaitType: "all",
      stacks: [
        { items: [{ type: "action", actionType: "character:say", action: "action-nested-gone" }] }
      ]
    });
    saved.game.asyncStackModels = [
      {
        items: [],
        loop: { type: "count", counter: 0, bodyActionIds: ["action-loop-gone"], broken: false }
      }
    ];
    expect(collectUnresolvedSaveReferences(saved as unknown as SavedGame, maps)).toMatchObject({
      actions: ["action-loop-gone", "action-nested-gone"],
      all: ["action-loop-gone", "action-nested-gone"]
    });
  });

  it("does not require a link entry's own action, because the engine does not", () => {
    const saved = makeSave(PLAYING) as unknown as { game: Record<string, any> };
    saved.game.stackModel.items.push({
      type: "link",
      actionType: "control:all",
      action: "action-link-gone",
      stackWaitType: "all",
      stacks: []
    });
    expect(collectUnresolvedSaveReferences(saved as unknown as SavedGame, maps).all).toEqual([]);
  });

  it("separates a missing scene from the elements that went with it", () => {
    const saved = makeSave({
      sceneId: "scene-gone",
      line: 1,
      backlog: [],
      audio: ""
    }) as unknown as {
      game: Record<string, any>;
    };
    saved.game.stage.scenes[0].elements.layers["layer-gone"] = ["img-1"];
    // The scene is not restated among the elements even though `elementStates` carries it too.
    expect(collectUnresolvedSaveReferences(saved as unknown as SavedGame, maps)).toEqual({
      scenes: ["scene-gone"],
      elements: ["layer-gone"],
      actions: [],
      all: ["layer-gone", "scene-gone"]
    });
  });
});

describe("readSaveLastLine", () => {
  it("reads the words the save stopped on", () => {
    expect(readSaveLastLine(makeSave(PLAYING))).toBe(LAST_LINE);
  });

  it("is null when the save carries none", () => {
    expect(readSaveLastLine(makeSave(PLAYING, { lastSentence: null }))).toBeNull();
    expect(readSaveLastLine(makeSave(PLAYING, { lastSentence: "   " }))).toBeNull();
    expect(readSaveLastLine({})).toBeNull();
  });

  it("collapses whitespace and caps the quote", () => {
    expect(readSaveLastLine(makeSave(PLAYING, { lastSentence: "a\n  b" }))).toBe("a b");
    const quoted = readSaveLastLine(makeSave(PLAYING, { lastSentence: "x".repeat(200) }));
    expect(quoted).toHaveLength(61);
    expect(quoted?.endsWith("…")).toBe(true);
  });
});
