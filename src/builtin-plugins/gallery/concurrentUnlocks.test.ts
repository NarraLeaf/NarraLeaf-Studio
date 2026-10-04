/**
 * Two writers of the unlock record running at once: the runtime's automatic collecting, and an
 * `Unlock Gallery` node in the author's graph.
 *
 * Both read the whole record, change it and write it back, and plugin storage is asynchronous on
 * both ends - a file on desktop, IndexedDB on the web. Reaching a scene whose entry-event graph
 * unlocks a CG starts both at the same moment, and if each reads before the other has written, the
 * second write carries the first one's stale copy and the first unlock is gone. Nothing reports it:
 * the player simply finds the recollection, or the CG, still locked.
 *
 * The store below answers every call a few ticks late, the way a real backend does, which is what
 * lets the two read-modify-write cycles overlap.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { RUNTIME_UNLOCKED_KEY } from "./catalog";
import galleryRuntime from "./runtime";
import { updateUnlockRecord } from "./unlockRecord";

const CATALOG = {
    version: 4,
    groups: [],
    settings: { lockedImageAssetId: null, lockedNameMask: "???" },
    items: [
        {
            id: "art.cg",
            name: "Rooftop",
            kind: "cg",
            variants: [{ id: "art.cg.v.1", name: "Rooftop", imageAssetId: "asset-cg" }],
        },
        {
            id: "art.scene",
            name: "First meeting",
            kind: "scene",
            scene: { storyId: "story.main", sceneId: "scene.a" },
            variants: [{ id: "art.scene.v.1", name: "First meeting", imageAssetId: "asset-scene" }],
        },
    ],
};

type Def = { type: string; execute: (ctx: unknown) => Promise<unknown> | unknown };
type Listener = (payload: unknown) => void;

let persistence: Record<string, unknown>;
let listeners: Map<string, Listener[]>;
let defs: Map<string, Def>;

/** A few macrotasks, so another read or write can land in between. */
function later(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 2));
}

/** The runtime entry set up against one `game`, as the loader hands it to setup and to every node. */
function setUpGame() {
    const game = {
        blueprintNodes: {
            register: (def: Def) => defs.set(def.type, def),
            registerMany: (list: Def[]) => list.forEach(def => defs.set(def.type, def)),
        },
        widgets: { register: () => undefined, registerMany: () => undefined },
        data: { readJson: () => CATALOG },
        config: { get: () => null },
        log: () => undefined,
        store: {
            get: async (key: string) => {
                await later();
                return persistence[key] ?? null;
            },
            set: async (key: string, value: unknown) => {
                await later();
                persistence[key] = value;
            },
            remove: async () => undefined,
            keys: async () => Object.keys(persistence),
        },
        events: {
            on: (event: string, listener: Listener) => {
                listeners.set(event, [...(listeners.get(event) ?? []), listener]);
                return () => undefined;
            },
            available: () => true,
        },
    };
    galleryRuntime.setup({ game } as never);
    return game;
}

function nodeContext(game: unknown, params: Record<string, unknown>) {
    return { params, resolveInput: () => undefined, game };
}

/** Long enough for every queued read and write above to have landed. */
function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 60));
}

function unlocked(): string[] {
    const stored = persistence[RUNTIME_UNLOCKED_KEY];
    return Array.isArray(stored) ? [...stored as string[]].sort() : [];
}

beforeEach(() => {
    persistence = {};
    listeners = new Map();
    defs = new Map();
});

describe("collecting and an Unlock Gallery node at the same moment", () => {
    it("keeps both unlocks when the scene is reached as the node runs", async () => {
        const game = setUpGame();

        for (const listener of listeners.get("sceneEnter") ?? []) {
            listener({ sceneId: "scene.a" });
        }
        const node = defs.get("narraleaf.gallery.add")!.execute(nodeContext(game, { galleryItemId: "art.cg" }));
        await node;
        await settle();

        expect(unlocked()).toEqual(["art.cg.v.1", "art.scene.v.1"]);
    });

    it("keeps both unlocks when the node starts first", async () => {
        const game = setUpGame();

        const node = defs.get("narraleaf.gallery.add")!.execute(nodeContext(game, { galleryItemId: "art.cg" }));
        for (const listener of listeners.get("sceneEnter") ?? []) {
            listener({ sceneId: "scene.a" });
        }
        await node;
        await settle();

        expect(unlocked()).toEqual(["art.cg.v.1", "art.scene.v.1"]);
    });

    it("applies a Lock Whole Gallery after a collect that started before it", async () => {
        // Clearing does not read, but it still has to wait: a collect that read the old record
        // before the clear and wrote after it would hand the player back everything they cleared.
        const game = setUpGame();
        persistence[RUNTIME_UNLOCKED_KEY] = ["art.cg.v.1"];

        for (const listener of listeners.get("sceneEnter") ?? []) {
            listener({ sceneId: "scene.a" });
        }
        await defs.get("narraleaf.gallery.clear")!.execute(nodeContext(game, {}));
        await settle();

        expect(unlocked()).toEqual([]);
    });

    it("lets a read after an unlock see it, even with a collect in between", async () => {
        const game = setUpGame();

        for (const listener of listeners.get("sceneEnter") ?? []) {
            listener({ sceneId: "scene.a" });
        }
        await defs.get("narraleaf.gallery.add")!.execute(nodeContext(game, { galleryItemId: "art.cg" }));
        const read = await defs.get("narraleaf.gallery.getStats")!.execute(nodeContext(game, {})) as {
            outputValues: { unlocked: number };
        };

        expect(read.outputValues.unlocked).toBe(2);
    });
});

describe("the queue itself", () => {
    it("carries on past a write that failed", async () => {
        // One bad write - a full disk, a quota - must not leave every later unlock waiting forever.
        let failNext = true;
        const store = {
            get: async (key: string) => persistence[key] ?? null,
            set: async (key: string, value: unknown) => {
                if (failNext) {
                    failNext = false;
                    throw new Error("disk full");
                }
                persistence[key] = value;
            },
        };
        const items = CATALOG.items as never;

        const failed = updateUnlockRecord(store, items, unlocked => unlocked.add("art.cg.v.1"));
        const next = updateUnlockRecord(store, items, unlocked => unlocked.add("art.scene.v.1"));

        await expect(failed).rejects.toThrow("disk full");
        await expect(next).resolves.toBe(true);
        expect(unlocked()).toEqual(["art.scene.v.1"]);
    });
});
