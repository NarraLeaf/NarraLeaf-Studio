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
    return { service: { fetch } as any, fetch, pending, settle };
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

    it("never hands out the bytes it read", async () => {
        const lib = library();
        const { result } = renderHook(() => useAssetInspectorMetadata(audio(), lib.service));
        await lib.settle(0, { duration: 3 });

        expect(result.current).toEqual({ metadata: { duration: 3 } });
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
});
