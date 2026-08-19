/**
 * The runtime entry's collecting half: which signal fills which column.
 *
 * Worth its own file because none of it is reachable from the node tests - a node runs when the
 * author's graph asks it to, while this runs on its own as the player plays, and the failure it
 * guards against (a column that silently never fills, or one that fills from the wrong signal) is
 * invisible in the editor: the editor backs no plugin storage, so a gallery previews as fully
 * locked either way.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { RUNTIME_UNLOCKED_KEY } from "./catalog";
import galleryRuntime from "./runtime";

const CATALOG = {
    version: 4,
    groups: [],
    settings: { lockedImageAssetId: null, lockedNameMask: "???" },
    items: [
        {
            id: "art.cg",
            name: "Ending",
            kind: "cg",
            variants: [{ id: "art.cg.v.1", name: "Ending", imageAssetId: "asset-cg" }],
        },
        {
            id: "art.scene",
            name: "First meeting",
            kind: "scene",
            scene: { storyId: "story.main", sceneId: "scene.a" },
            variants: [
                { id: "art.scene.v.1", name: "Part one", imageAssetId: "asset-s1" },
                { id: "art.scene.v.2", name: "Part two", imageAssetId: "asset-s2" },
            ],
        },
        {
            id: "art.album",
            name: "Soundtrack",
            kind: "music",
            variants: [
                { id: "art.album.v.1", name: "Opening", audioAssetId: "asset-op" },
                { id: "art.album.v.2", name: "Ending", audioAssetId: "asset-ed" },
            ],
        },
        {
            id: "art.voice",
            name: "Alice",
            kind: "voice",
            variants: [
                { id: "art.voice.v.1", name: "Greeting", voiceUnitId: "text-1" },
                { id: "art.voice.v.2", name: "Farewell", voiceUnitId: "text-2" },
                { id: "art.voice.v.3", name: "Loose take", audioAssetId: "asset-loose" },
            ],
        },
    ],
};

type Listener = (payload: never) => void;

let persistence: Record<string, unknown>;
let writes: number;
let listeners: Map<string, Listener[]>;
let warnings: string[];

function fakeApp(options: { store?: boolean; events?: boolean; catalog?: unknown } = {}) {
    const store = options.store === false ? undefined : {
        get: async (key: string) => persistence[key] ?? null,
        set: async (key: string, value: unknown) => {
            writes += 1;
            persistence[key] = value;
        },
        remove: async () => undefined,
        keys: async () => Object.keys(persistence),
    };
    const events = options.events === false ? undefined : {
        on: (event: string, listener: Listener) => {
            const bucket = listeners.get(event) ?? [];
            bucket.push(listener);
            listeners.set(event, bucket);
            return () => undefined;
        },
        available: () => true,
    };
    return {
        game: {
            blueprintNodes: { register: () => undefined, registerMany: () => undefined },
            widgets: { register: () => undefined, registerMany: () => undefined },
            data: { readJson: () => ("catalog" in options ? options.catalog : CATALOG) },
            config: { get: () => null },
            log: (level: string, message: string) => {
                if (level === "warning") {
                    warnings.push(message);
                }
            },
            store,
            events,
        },
    } as never;
}

/** Fire one bridged event and let the collector's fire-and-forget write settle. */
async function emit(event: string, payload: unknown): Promise<void> {
    for (const listener of listeners.get(event) ?? []) {
        (listener as (value: unknown) => void)(payload);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
}

function collected(): string[] {
    const stored = persistence[RUNTIME_UNLOCKED_KEY];
    return Array.isArray(stored) ? [...stored as string[]].sort() : [];
}

beforeEach(() => {
    persistence = {};
    writes = 0;
    listeners = new Map();
    warnings = [];
});

describe("automatic collecting", () => {
    it("collects a recollection when the player reaches its scene", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("sceneEnter", { sceneId: "scene.a" });

        // A recollection has nothing finer than the scene, so the whole entry comes at once.
        expect(collected()).toEqual(["art.scene.v.1", "art.scene.v.2"]);
    });

    it("ignores a scene no entry replays", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("sceneEnter", { sceneId: "scene.unknown" });

        expect(collected()).toEqual([]);
        expect(writes).toBe(0);
    });

    it("collects only the track that played, not the whole album", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("audioPlayed", { assetId: "asset-op" });

        expect(collected()).toEqual(["art.album.v.1"]);
    });

    it("collects a voice line backed by a loose clip", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("audioPlayed", { assetId: "asset-loose" });

        expect(collected()).toEqual(["art.voice.v.3"]);
    });

    it("collects the voice line the player was just spoken", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("dialogueEnd", { textId: "text-2" });

        expect(collected()).toEqual(["art.voice.v.2"]);
    });

    it("writes nothing for a line the compile could not name", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("dialogueEnd", { textId: null });

        expect(writes).toBe(0);
    });

    it("leaves CG entries to the story", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("sceneEnter", { sceneId: "scene.a" });
        await emit("audioPlayed", { assetId: "asset-cg" });
        await emit("dialogueEnd", { textId: "text-1" });

        expect(collected()).not.toContain("art.cg.v.1");
    });

    it("writes once however often a signal repeats", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("audioPlayed", { assetId: "asset-op" });
        expect(writes).toBe(1);

        // Every one of these signals follows execution, so a remount, a rollback or a replay fires
        // it again. Collecting is a set insert, and an unchanged set must not reach the disk.
        await emit("audioPlayed", { assetId: "asset-op" });
        await emit("audioPlayed", { assetId: "asset-op" });

        expect(writes).toBe(1);
        expect(collected()).toEqual(["art.album.v.1"]);
    });

    it("accumulates across the three signals", async () => {
        galleryRuntime.setup(fakeApp());
        await emit("sceneEnter", { sceneId: "scene.a" });
        await emit("audioPlayed", { assetId: "asset-ed" });
        await emit("dialogueEnd", { textId: "text-1" });

        expect(collected()).toEqual([
            "art.album.v.2",
            "art.scene.v.1",
            "art.scene.v.2",
            "art.voice.v.1",
        ]);
    });
});

describe("degradation", () => {
    it("subscribes to nothing when the environment backs no plugin storage", () => {
        galleryRuntime.setup(fakeApp({ store: false }));

        expect(listeners.size).toBe(0);
    });

    it("subscribes to nothing when the environment bridges no events", () => {
        galleryRuntime.setup(fakeApp({ events: false }));

        expect(listeners.size).toBe(0);
    });

    it("reports a game shipped without a catalog instead of collecting into nothing", async () => {
        galleryRuntime.setup(fakeApp({ catalog: null }));
        await emit("sceneEnter", { sceneId: "scene.a" });

        expect(warnings).toHaveLength(1);
        expect(writes).toBe(0);
    });
});
