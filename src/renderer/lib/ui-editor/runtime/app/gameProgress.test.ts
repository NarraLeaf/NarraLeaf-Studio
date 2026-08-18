import { describe, expect, it } from "vitest";
import {
  applyGameProgressVariables,
  collectGameProgressVariables,
  mergeVisitedSceneIds,
  toImportOutcome
} from "./gameProgress";
import { buildGameProgressDocument } from "@shared/types/gameProgress";

const SAVED = [{ storageKey: "gold" }, { storageKey: "route" }, { storageKey: "neverWritten" }];
const PERSISTENT = [{ storageKey: "seenIntro" }, { storageKey: "deaths" }];

describe("collecting a playthrough", () => {
  it("exports only the declared variables, keyed by storage key", async () => {
    const store: Record<string, unknown> = {
      gold: 12,
      route: "north",
      // Host persistence also holds the player's language, their read-text record and their
      // preferences. None of that is a playthrough and none of it is declared, so none of it
      // travels.
      "nls.locale": "ja"
    };
    const saved = await collectGameProgressVariables(SAVED, (key) => store[key]);
    expect(saved).toEqual({ gold: 12, route: "north" });

    const persistent = await collectGameProgressVariables(PERSISTENT, async (key) => store[key]);
    expect(persistent).toEqual({});
  });

  it("leaves a never-written variable out rather than exporting undefined", async () => {
    const saved = await collectGameProgressVariables(SAVED, () => undefined);
    expect(Object.keys(saved)).toEqual([]);
  });

  it("keeps going when one variable cannot be read", async () => {
    const saved = await collectGameProgressVariables(SAVED, (key) => {
      if (key === "gold") {
        throw new Error("storable refused");
      }
      return key === "route" ? "north" : undefined;
    });
    expect(saved).toEqual({ route: "north" });
  });
});

describe("applying a document", () => {
  it("carries both saved and persistent values through a round trip", async () => {
    const live: Record<string, unknown> = { gold: 12, route: "north" };
    const app: Record<string, unknown> = { seenIntro: true, deaths: 3 };

    const document = buildGameProgressDocument(
      "com.example.sablehours",
      {
        storyId: "story-1",
        savedVariables: await collectGameProgressVariables(SAVED, (key) => live[key]),
        persistentVariables: await collectGameProgressVariables(PERSISTENT, (key) => app[key]),
        anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
        visitedSceneIds: ["scene-1", "scene-3"]
      },
      "2026-08-12T00:00:00.000Z"
    );

    // The other edition: a fresh store, the same declarations.
    const freshLive: Record<string, unknown> = {};
    const freshApp: Record<string, unknown> = {};
    expect(
      applyGameProgressVariables(SAVED, document.savedVariables, (key, value) => {
        freshLive[key] = value;
      })
    ).toEqual(["gold", "route"]);
    expect(
      applyGameProgressVariables(PERSISTENT, document.persistentVariables, (key, value) => {
        freshApp[key] = value;
      })
    ).toEqual(["seenIntro", "deaths"]);

    expect(freshLive).toEqual({ gold: 12, route: "north" });
    expect(freshApp).toEqual({ seenIntro: true, deaths: 3 });
  });

  it("skips a key this build does not declare", () => {
    const written: Record<string, unknown> = {};
    const applied = applyGameProgressVariables(
      [{ storageKey: "gold" }],
      { gold: 40, cheat: true, "../escape": 1 },
      (key, value) => {
        written[key] = value;
      }
    );
    expect(applied).toEqual(["gold"]);
    expect(written).toEqual({ gold: 40 });
  });

  it("leaves a variable the document says nothing about at its own default", () => {
    const written: Record<string, unknown> = {};
    applyGameProgressVariables(SAVED, { gold: 40 }, (key, value) => {
      written[key] = value;
    });
    expect(written).toEqual({ gold: 40 });
  });
});

describe("the visited record", () => {
  it("unions rather than replaces, because both halves happened", () => {
    expect(mergeVisitedSceneIds(["a", "b"], ["b", "c", "", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("what the node hands out", () => {
  it("reports the anchor's scene id, and blank when there is no anchor", () => {
    const anchored = buildGameProgressDocument(
      "k",
      {
        storyId: "s",
        savedVariables: {},
        persistentVariables: {},
        anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
        visitedSceneIds: []
      },
      "now"
    );
    expect(toImportOutcome(anchored)).toEqual({ outcome: "found", sceneId: "scene-3", error: "" });

    const unanchored = buildGameProgressDocument(
      "k",
      {
        storyId: "",
        savedVariables: {},
        persistentVariables: { seenIntro: true },
        anchor: null,
        visitedSceneIds: []
      },
      "now"
    );
    // Found, with nothing to resume from: persistent values carried, no playthrough in flight.
    expect(toImportOutcome(unanchored)).toEqual({ outcome: "found", sceneId: "", error: "" });
  });
});
