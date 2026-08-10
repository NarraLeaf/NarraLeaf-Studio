import { describe, expect, it } from "vitest";
import type { MergedPersistentEntry } from "@shared/variables/mergedPersistentView";
import {
    classifySaveLoadFailure,
    collectSaveLoadLosses,
    decodeSavedGameStore,
    projectPersistentStore,
    summarizeSaveSlot,
    unwrapStorableValue,
    type DecodeSaveInput,
} from "./saveInspectorModel";

/** One `WrappedStorableData`, spelled the way the engine writes it. */
function wrapped(data: unknown): { type: string; data: unknown } {
    return { type: "any", data };
}

const SAVED_NS = "persistent:__nlr_story_saved__";
const VISITED_NS = "persistent:__nlr_story_visited__";
const LOCAL_NS = "local:scene_prologue";

function decodeInput(overrides: Partial<DecodeSaveInput> = {}): DecodeSaveInput {
    return {
        savedGame: {
            game: {
                store: {
                    [SAVED_NS]: { coins: wrapped(12), "k-unknown": wrapped(true) },
                    [VISITED_NS]: { scenes: wrapped(["s1"]), options: wrapped(["o1", "o2"]) },
                    [LOCAL_NS]: { mood: wrapped("happy") },
                    game: {},
                },
            },
        },
        namespaces: { saved: SAVED_NS, visited: VISITED_NS, sceneLocal: { s1: LOCAL_NS } },
        savedNames: new Map([["coins", "Coins"]]),
        sceneVariableNames: new Map([["s1", new Map([["mood", "Mood"]])]]),
        sceneNames: new Map([["s1", "Prologue"]]),
        optionNames: new Map([["o1", "Say hello"]]),
        ...overrides,
    };
}

describe("unwrapStorableValue", () => {
    it("returns the wrapped data", () => {
        expect(unwrapStorableValue(wrapped(false))).toBe(false);
    });

    it("does not unwrap a second time, so authored data shaped like a wrapper survives", () => {
        // A stored value is free to BE `{type, data}`; unwrapping recursively would rewrite it.
        const authored = { type: "sword", data: { damage: 3 } };
        expect(unwrapStorableValue(wrapped(authored))).toEqual(authored);
    });

    it("passes an unwrapped value through", () => {
        expect(unwrapStorableValue(7)).toBe(7);
    });
});

describe("decodeSavedGameStore", () => {
    it("splits the saved namespace by whether a declaration claims the key", () => {
        const decoded = decodeSavedGameStore(decodeInput());
        expect(decoded.saved?.declared).toEqual([{ storageKey: "coins", name: "Coins", value: 12 }]);
        expect(decoded.saved?.unclaimed).toEqual([{ storageKey: "k-unknown", name: null, value: true }]);
    });

    it("maps a local namespace back to its Studio scene", () => {
        const decoded = decodeSavedGameStore(decodeInput());
        expect(decoded.scenes).toEqual([{
            namespace: LOCAL_NS,
            sceneId: "s1",
            sceneName: "Prologue",
            rows: [{ storageKey: "mood", name: "Mood", value: "happy" }],
        }]);
    });

    it("decodes the visited record to names, leaving what it cannot name as an id", () => {
        const decoded = decodeSavedGameStore(decodeInput());
        expect(decoded.visited).toEqual({
            scenes: [{ id: "s1", name: "Prologue" }],
            options: [{ id: "o1", name: "Say hello" }, { id: "o2", name: null }],
        });
    });

    it("keeps a namespace no scope claimed rather than dropping it", () => {
        const decoded = decodeSavedGameStore(decodeInput());
        expect(decoded.other).toEqual([{ namespace: "game", rows: [] }]);
    });

    it("matches namespace names from the bridge rather than an engine prefix", () => {
        // The whole point of taking the names from the running compile: a different prefix must not
        // stop the saved namespace being recognised.
        const decoded = decodeSavedGameStore(decodeInput({
            savedGame: { game: { store: { "future:__nlr_story_saved__": { coins: wrapped(1) } } } },
            namespaces: { saved: "future:__nlr_story_saved__", visited: null, sceneLocal: {} },
        }));
        expect(decoded.saved?.namespace).toBe("future:__nlr_story_saved__");
        expect(decoded.other).toEqual([]);
    });

    it("attributes nothing when no story is running, instead of guessing", () => {
        const decoded = decodeSavedGameStore(decodeInput({
            namespaces: { saved: null, visited: null, sceneLocal: {} },
        }));
        expect(decoded.saved).toBeNull();
        expect(decoded.visited).toBeNull();
        expect(decoded.scenes).toEqual([]);
        expect(decoded.other.map(entry => entry.namespace)).toEqual(["game", LOCAL_NS, SAVED_NS, VISITED_NS]);
    });

    it("survives a record with no store at all", () => {
        const decoded = decodeSavedGameStore(decodeInput({ savedGame: null }));
        expect(decoded).toEqual({ saved: null, scenes: [], visited: null, other: [] });
    });
});

describe("summarizeSaveSlot", () => {
    it("prefers a string name from the author metadata", () => {
        const summary = summarizeSaveSlot("slot-1", { metadata: { user: "Chapter 2" }, savedGame: {} });
        expect(summary.label).toBe("Chapter 2");
    });

    it("reads a `name` field out of an object metadata", () => {
        const summary = summarizeSaveSlot("slot-1", { metadata: { user: { name: "Chapter 2" } }, savedGame: {} });
        expect(summary.label).toBe("Chapter 2");
    });

    it("falls back to the slot id rather than guessing at an unknown metadata shape", () => {
        const summary = summarizeSaveSlot("slot-1", { metadata: { user: { chapter: 2 } }, savedGame: {} });
        expect(summary.label).toBe("slot-1");
    });

    it("carries the last spoken line and the stamp", () => {
        const summary = summarizeSaveSlot("slot-1", {
            metadata: { updatedAt: "2026-08-07T12:00:00.000Z" },
            savedGame: { meta: { lastSentence: "Good morning." } },
        });
        expect(summary.lastSentence).toBe("Good morning.");
        expect(summary.updatedAt).toBe("2026-08-07T12:00:00.000Z");
    });

    it("reports no line rather than an empty one", () => {
        const summary = summarizeSaveSlot("slot-1", { metadata: {}, savedGame: { meta: { lastSentence: "" } } });
        expect(summary.lastSentence).toBeNull();
        expect(summary.updatedAt).toBeNull();
    });
});

describe("projectPersistentStore", () => {
    const declared: MergedPersistentEntry[] = [
        { storageKey: "k-name", name: "Player Name", valueType: "string", source: "registry", id: "e1" },
        { storageKey: "k-seen", name: "Seen Intro", valueType: "boolean", defaultValue: false, source: "story", id: "b1" },
    ];

    it("shows a declared variable by name, with the stored value when there is one", () => {
        const view = projectPersistentStore(new Map([["k-name", "Yuko"]]), declared);
        expect(view.declared).toEqual([
            { storageKey: "k-name", name: "Player Name", value: "Yuko", live: true },
            { storageKey: "k-seen", name: "Seen Intro", value: false, live: false },
        ]);
    });

    it("keeps store keys no declaration claims, which is why the raw dump could go", () => {
        const view = projectPersistentStore(
            new Map<string, unknown>([["k-name", "Yuko"], ["nl.locale", "zh"], ["bp-scratch", 1]]),
            declared,
        );
        expect(view.unclaimed).toEqual([
            { storageKey: "bp-scratch", name: null, value: 1 },
            { storageKey: "nl.locale", name: null, value: "zh" },
        ]);
    });

    it("draws a storage key declared on both surfaces once", () => {
        const view = projectPersistentStore(new Map(), [
            declared[0],
            { storageKey: "k-name", name: "Player Name (row)", valueType: "string", source: "story", id: "b9" },
        ]);
        expect(view.declared).toHaveLength(1);
    });
});

describe("classifySaveLoadFailure", () => {
    it("recognises the story having moved on, and names the element", () => {
        const failure = classifySaveLoadFailure(
            new Error("Element not found, id: img-42\nThe story may have changed."),
        );
        expect(failure).toEqual({
            tone: "warning",
            missingElementId: "img-42",
            message: "Element not found, id: img-42\nThe story may have changed.",
        });
    });

    it("keeps danger for a throw whose shape is not that", () => {
        const failure = classifySaveLoadFailure(new Error("No story loaded"));
        expect(failure.tone).toBe("danger");
        expect(failure.missingElementId).toBeNull();
    });

    it("accepts a non-Error throw", () => {
        expect(classifySaveLoadFailure("boom").message).toBe("boom");
    });
});

describe("collectSaveLoadLosses", () => {
    const savedGame = {
        game: {
            store: { [SAVED_NS]: { coins: wrapped(1), gone: wrapped(2) } },
            history: [
                { actionId: "a1" },
                { actionId: "a-deleted" },
                { actionId: null },
            ],
        },
    };

    it("counts backlog entries whose action no longer resolves", () => {
        const losses = collectSaveLoadLosses({
            savedGame,
            knownActionIds: new Set(["a1"]),
            decoded: decodeSavedGameStore(decodeInput({ savedGame })),
        });
        expect(losses.droppedBacklog).toBe(2);
        expect(losses.backlogTotal).toBe(3);
    });

    it("lists the storage keys nothing declares, across saved and scene scopes", () => {
        const losses = collectSaveLoadLosses({
            savedGame,
            knownActionIds: new Set(["a1", "a-deleted"]),
            decoded: decodeSavedGameStore(decodeInput()),
        });
        // `k-unknown` from the saved namespace; `mood` is declared, so it is not listed.
        expect(losses.unclaimedKeys).toEqual(["k-unknown"]);
    });

    it("reports nothing lost for a save with no backlog", () => {
        const losses = collectSaveLoadLosses({
            savedGame: { game: { store: {} } },
            knownActionIds: new Set(),
            decoded: decodeSavedGameStore(decodeInput({ savedGame: { game: { store: {} } } })),
        });
        expect(losses).toEqual({ droppedBacklog: 0, backlogTotal: 0, unclaimedKeys: [] });
    });
});
