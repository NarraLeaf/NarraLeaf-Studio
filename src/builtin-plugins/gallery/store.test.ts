/**
 * The editing store's import paths: what an imported clip is stored with.
 *
 * The length is the part worth a test of its own. Nothing about an audio asset records it, so a
 * track that is not measured on the way in is stored without one for good - its row in the editor
 * reads a dash and Get Gallery hands an EXTRA screen `durationSec: 0`, and neither looks broken
 * until somebody checks a track list against the files.
 */

import { describe, expect, it, vi } from "vitest";
import type { Asset, PluginApp } from "narraleaf-studio/plugin";
import { readMediaDuration, type MediaMetadataElement } from "./audioDuration";
import { createGalleryStore } from "./store";

function fakeApp() {
    const written: unknown[] = [];
    const app = {
        services: {
            storage: {
                readJson: async () => null,
                writeJson: async (_namespace: string, value: unknown) => {
                    written.push(value);
                },
            },
            workspace: { frozen: false },
            blueprintNodes: { notifyDynamicSelectOptionsChanged: () => undefined },
            i18n: {
                createTranslator: () => ({
                    locale: "en",
                    t: (key: string, params?: Record<string, string | number>) => `${key}:${params?.n ?? ""}`,
                }),
            },
        },
    } as unknown as PluginApp;
    return { app, written };
}

function audio(id: string, name: string): Asset {
    return { id, name, type: "audio" } as unknown as Asset;
}

describe("importing tracks", () => {
    it("stores each track with the length measured from its file", async () => {
        const { app } = fakeApp();
        const lengths: Record<string, number> = { "asset-op": 154.5, "asset-ed": 61 };
        const store = createGalleryStore(app, async asset => lengths[asset.id] ?? null);
        await store.load();

        const id = await store.importTracks([audio("asset-op", "opening.ogg"), audio("asset-ed", "ending.ogg")]);
        const album = store.getItems().find(item => item.id === id)!;

        expect(album.variants.map(variant => variant.durationSec)).toEqual([154.5, 61]);
    });

    it("adds a length to a track added to an existing album", async () => {
        const { app, written } = fakeApp();
        const store = createGalleryStore(app, async () => 33.25);
        await store.load();
        const id = await store.importTracks([audio("asset-op", "opening.ogg")]);

        await store.addAudioVariants(id, [audio("asset-bonus", "bonus.ogg")]);

        const album = store.getItems().find(item => item.id === id)!;
        expect(album.variants[1]).toMatchObject({ audioAssetId: "asset-bonus", durationSec: 33.25 });
        // What reached the project file, not only the copy in memory.
        const saved = written.at(-1) as { items: { variants: { durationSec?: number }[] }[] };
        expect(saved.items[0]!.variants[1]!.durationSec).toBe(33.25);
    });

    it("stores a track whose length cannot be read without one", async () => {
        const { app } = fakeApp();
        const store = createGalleryStore(app, async () => null);
        await store.load();

        const id = await store.importTracks([audio("asset-op", "opening.ogg")]);

        expect("durationSec" in store.getItems().find(item => item.id === id)!.variants[0]!).toBe(false);
    });
});

describe("readMediaDuration", () => {
    function element(behaviour: (el: MediaMetadataElement & { duration: number }) => void) {
        const el = {
            preload: "",
            duration: Number.NaN,
            onloadedmetadata: null,
            onerror: null,
            set src(value: string) {
                this._src = value;
                if (value) {
                    queueMicrotask(() => behaviour(el));
                }
            },
            get src() {
                return this._src;
            },
            _src: "",
        } as MediaMetadataElement & { duration: number; _src: string };
        return el;
    }

    it("reads the length from the header once metadata has loaded", async () => {
        const el = element(target => {
            target.duration = 92.4;
            target.onloadedmetadata?.();
        });

        await expect(readMediaDuration("blob:x", () => el)).resolves.toBe(92.4);
        expect(el.src).toBe("");
    });

    it("counts a stream with no length in its header as unknown", async () => {
        const el = element(target => {
            target.duration = Number.POSITIVE_INFINITY;
            target.onloadedmetadata?.();
        });

        await expect(readMediaDuration("blob:x", () => el)).resolves.toBeNull();
    });

    it("gives up on a file the shell cannot read", async () => {
        const failing = element(target => target.onerror?.());
        await expect(readMediaDuration("blob:x", () => failing)).resolves.toBeNull();

        vi.useFakeTimers();
        try {
            const silent = element(() => undefined);
            const pending = readMediaDuration("blob:x", () => silent, 5000);
            await vi.advanceTimersByTimeAsync(5000);
            await expect(pending).resolves.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});
