// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { useAssetInspectorMetadata } from "./useAssetInspectorMetadata";

/**
 * The info card's metadata across the ways its subject is republished.
 *
 * The case this exists for is the first one: a record edit - here an audio marker, written as an
 * extras patch - arrives as a fresh shallow clone of the same record, because that is what `UIService`
 * publishes on `updated`. The card used to lose every row but the hash at that moment. The rest pin
 * what the metadata must still NOT survive: new bytes, another asset, and a read that lands late.
 *
 * Model bundles get their own block: their `data` is the resolved listing rather than bytes, the
 * card's entry and format rows read it, and the entry in it follows the author's override.
 */

function audio(over: Partial<Asset> = {}): Asset {
    return {
        id: "clip",
        type: AssetType.Audio,
        name: "theme.mp3",
        hash: "hash-a",
        tags: [],
        ...over,
    } as Asset;
}

function model(over: Partial<Asset> = {}): Asset {
    return {
        id: "hiyori",
        type: AssetType.Model,
        name: "Hiyori",
        hash: "hash-m",
        tags: [],
        ...over,
    } as Asset;
}

const BUNDLE_FILES = ["Hiyori.model3.json", "Alt.model3.json", "Hiyori.moc3"];

/** What `ModelService.readLocalModel` hands back, with the entry it resolved. */
function bundle(entry: string) {
    return {
        data: { entry, files: BUNDLE_FILES, format: "live2d-cubism4" },
        metadata: { entry, files: BUNDLE_FILES, size: 2048 },
    };
}

type Deferred = { resolve: (value: unknown) => void };

/** A library whose reads the test settles by hand, so the order of arrivals is the test's to choose. */
function library() {
    const pending: Array<{ asset: Asset } & Deferred> = [];
    const fetch = vi.fn((asset: Asset) => new Promise<any>(resolve => {
        pending.push({ asset, resolve });
    }));
    const settle = async (index: number, metadata: Record<string, unknown>) => {
        await act(async () => {
            pending[index].resolve({ success: true, data: { data: new Uint8Array(8), metadata } });
        });
    };
    const settleWith = async (index: number, data: unknown) => {
        await act(async () => {
            pending[index].resolve({ success: true, data });
        });
    };
    const fail = async (index: number) => {
        await act(async () => {
            pending[index].resolve({ success: false, error: "gone" });
        });
    };
    return { service: { fetch } as any, fetch, pending, settle, settleWith, fail };
}

describe("useAssetInspectorMetadata", () => {
    it("keeps the metadata when the record is republished around the same bytes", async () => {
        const lib = library();
        const { result, rerender } = renderHook(
            ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
            { initialProps: { asset: audio() } },
        );
        await lib.settle(0, { duration: 12, sampleRate: 44100 });
        const loaded = result.current;
        expect(loaded?.metadata).toEqual({ duration: 12, sampleRate: 44100 });

        // What `UIService` publishes after `patchAssetExtras` writes an in point.
        rerender({ asset: audio({ extras: { audioLoop: { start: 1, end: 4 } } as Asset["extras"] }) });

        expect(result.current).toBe(loaded);
        expect(lib.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["an audio clip", audio()],
        ["an image", audio({ id: "cg", type: AssetType.Image, name: "cg.png" })],
    ])("never hands out the bytes it read for %s", async (_, asset) => {
        const lib = library();
        const { result } = renderHook(() => useAssetInspectorMetadata(asset, lib.service));
        await lib.settle(0, { size: 3 });

        expect(result.current).toEqual({ metadata: { size: 3 } });
    });

    it("drops the metadata at once when the bytes under the same id are replaced", async () => {
        const lib = library();
        const { result, rerender } = renderHook(
            ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
            { initialProps: { asset: audio() } },
        );
        await lib.settle(0, { duration: 12 });

        rerender({ asset: audio({ hash: "hash-b" }) });
        expect(result.current).toBeNull();

        await lib.settle(1, { duration: 30 });
        expect(result.current?.metadata).toEqual({ duration: 30 });
    });

    it("does not show one asset's metadata for the next, however late the first read lands", async () => {
        const lib = library();
        const { result, rerender } = renderHook(
            ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
            { initialProps: { asset: audio() } },
        );

        rerender({ asset: audio({ id: "other", hash: "hash-o" }) });
        await lib.settle(0, { duration: 12 });
        expect(result.current).toBeNull();

        await lib.settle(1, { duration: 99 });
        await waitFor(() => expect(result.current?.metadata).toEqual({ duration: 99 }));
    });

    it("reads again when the same asset is inspected after something else", async () => {
        const lib = library();
        const { result, rerender } = renderHook(
            ({ asset }: { asset: Asset | null }) => useAssetInspectorMetadata(asset, lib.service),
            { initialProps: { asset: audio() as Asset | null } },
        );
        await lib.settle(0, { duration: 12 });

        rerender({ asset: null });
        expect(result.current).toBeNull();

        rerender({ asset: audio() });
        expect(lib.fetch).toHaveBeenCalledTimes(2);
        await lib.settle(1, { duration: 12 });
        expect(result.current?.metadata).toEqual({ duration: 12 });
    });

    describe("model bundles", () => {
        it("keeps the listing, which is where the card reads the entry and format", async () => {
            const lib = library();
            const { result } = renderHook(() => useAssetInspectorMetadata(model(), lib.service));
            await lib.settleWith(0, bundle("Hiyori.model3.json"));

            expect(result.current).toEqual(bundle("Hiyori.model3.json"));
        });

        it("reads again when the author overrides the entry, keeping the card up meanwhile", async () => {
            const lib = library();
            const { result, rerender } = renderHook(
                ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
                { initialProps: { asset: model({ extras: { modelEntry: "Hiyori.model3.json" } }) } },
            );
            await lib.settleWith(0, bundle("Hiyori.model3.json"));
            const before = result.current;

            // What `UIService` publishes after `patchAssetExtras` writes the new override.
            rerender({ asset: model({ extras: { modelEntry: "Alt.model3.json" } }) });

            expect(lib.fetch).toHaveBeenCalledTimes(2);
            expect(lib.pending[1].asset.extras?.modelEntry).toBe("Alt.model3.json");
            // Same files, so the rows - and the select just used - stay until the new entry lands.
            expect(result.current).toBe(before);

            await lib.settleWith(1, bundle("Alt.model3.json"));
            expect(result.current?.data).toMatchObject({ entry: "Alt.model3.json" });
        });

        it("does not read again for a record edit that leaves the override alone", async () => {
            const lib = library();
            const { result, rerender } = renderHook(
                ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
                { initialProps: { asset: model({ extras: { modelEntry: "Hiyori.model3.json" } }) } },
            );
            await lib.settleWith(0, bundle("Hiyori.model3.json"));
            const loaded = result.current;

            rerender({ asset: model({ name: "Hiyori (school)", extras: { modelEntry: "Hiyori.model3.json" } }) });

            expect(lib.fetch).toHaveBeenCalledTimes(1);
            expect(result.current).toBe(loaded);
        });

        it("does not let the read for the previous override land after the current one", async () => {
            const lib = library();
            const { result, rerender } = renderHook(
                ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
                { initialProps: { asset: model() } },
            );

            rerender({ asset: model({ extras: { modelEntry: "Alt.model3.json" } }) });
            await lib.settleWith(1, bundle("Alt.model3.json"));
            await lib.settleWith(0, bundle("Hiyori.model3.json"));

            expect(result.current?.data).toMatchObject({ entry: "Alt.model3.json" });
        });

        it("drops the previous entry when the read for the new override fails", async () => {
            const lib = library();
            const { result, rerender } = renderHook(
                ({ asset }) => useAssetInspectorMetadata(asset, lib.service),
                { initialProps: { asset: model() } },
            );
            await lib.settleWith(0, bundle("Hiyori.model3.json"));

            rerender({ asset: model({ extras: { modelEntry: "Alt.model3.json" } }) });
            await lib.fail(1);

            expect(result.current).toBeNull();
        });
    });
});
