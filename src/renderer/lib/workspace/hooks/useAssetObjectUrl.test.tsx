// @vitest-environment jsdom
import React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../services/ui/EventEmitter";
import { Services } from "../services/services";
import { AssetType } from "../services/assets/assetTypes";
import {
    AssetBytesSourceContext,
    type AssetBytesResult,
    type AssetBytesSource,
} from "@/lib/ui-editor/assets/assetBytesSource";
import {
    clearCharacterAvatarAssets,
    registerCharacterAvatarAssets,
} from "@/lib/ui-editor/runtime/characterAvatarAssets";
import { useAssetObjectUrl } from "./useAssetObjectUrl";

/**
 * The versioned-asset seam, pinned from both sides.
 *
 * The half that matters most is the half where nothing happens: this hook resolves every picture in
 * Studio, and the seam added above its live ladder is inert until something mounts a source - which
 * nothing does yet. So the first three cases assert the ladder behaves exactly as it did, and the
 * rest assert what the seam does once a source IS mounted, including that it wins over the avatar
 * table - an arm that would otherwise keep answering with the running compile's URLs inside a
 * render of an older version.
 */

const assetEvents = new EventEmitter<Record<string, unknown>>();

let assets: Record<string, Record<string, { id: string; type: AssetType }>> = {};
let fetchResult: { success: boolean; data?: unknown; error?: string } = { success: false };

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        devMode: {
            resolveAssetUrl: async () => ({ success: false, error: "not reached in this test" }),
        },
    }),
}));

/**
 * One workspace value for the whole file, handed back by identity.
 *
 * Not cosmetic: `context` is in this hook's effect dependency list, so a mock that built a fresh
 * object per render would re-run the effect on every render the effect's own `setState` caused, and
 * the suite would spin until the heap gave out. The real provider holds one context for the life of
 * the workspace.
 */
vi.mock("@/apps/workspace/context", () => {
    const assetsService = {
        getEvents: () => assetEvents,
        getAssets: () => assets,
        fetch: async () => fetchResult,
    };
    const setsService = {
        getSet: () => undefined,
        onSetsChanged: () => () => undefined,
    };
    const workspace = {
        isInitialized: true,
        context: {
            services: {
                get: (service: Services) => {
                    if (service === Services.Assets) {
                        return assetsService;
                    }
                    if (service === Services.AssetSets) {
                        return setsService;
                    }
                    throw new Error(`Service ${service} not found`);
                },
            },
        },
    };
    return { useOptionalWorkspace: () => workspace };
});

let mintedUrls = 0;

beforeEach(() => {
    assetEvents.clear();
    assets = {};
    fetchResult = { success: false };
    mintedUrls = 0;
    clearCharacterAvatarAssets();
    // jsdom implements neither, and this hook is the only owner of both.
    URL.createObjectURL = vi.fn(() => `blob:test/${++mintedUrls}`);
    URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
    clearCharacterAvatarAssets();
});

function imageAsset(id: string) {
    assets = { [AssetType.Image]: { [id]: { id, type: AssetType.Image } } };
}

function source(read: AssetBytesSource["read"], id = "version-1"): AssetBytesSource {
    return { id, read };
}

function withSource(value: AssetBytesSource) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <AssetBytesSourceContext.Provider value={value}>{children}</AssetBytesSourceContext.Provider>;
    };
}

const someBytes = async (): Promise<AssetBytesResult> => ({
    kind: "bytes",
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "image/png",
});

describe("useAssetObjectUrl with no source mounted", () => {
    it("still mints its object URL from the live library", async () => {
        imageAsset("picture");
        fetchResult = { success: true, data: { data: new Uint8Array([1, 2, 3]) } };

        const { result } = renderHook(() => useAssetObjectUrl("picture"));

        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it("still reports a missing record the way it always has", async () => {
        const { result } = renderHook(() => useAssetObjectUrl("gone"));

        await waitFor(() => expect(result.current.error).toBe("Asset not found: gone"));
        expect(result.current.url).toBeNull();
    });

    it("still short-circuits on the mounted compile's avatar table", async () => {
        await registerCharacterAvatarAssets(new Map([["app://avatar/live.png", "picture"]]));
        imageAsset("picture");
        fetchResult = { success: true, data: { data: new Uint8Array([1, 2, 3]) } };

        const { result } = renderHook(() => useAssetObjectUrl("picture"));

        await waitFor(() => expect(result.current.url).toBe("app://avatar/live.png"));
        // The live ladder was never reached, so no blob was minted.
        expect(mintedUrls).toBe(0);
    });

    it("still re-reads when the live library replaces the asset's bytes", async () => {
        imageAsset("picture");
        fetchResult = { success: true, data: { data: new Uint8Array([1, 2, 3]) } };

        const { result } = renderHook(() => useAssetObjectUrl("picture"));
        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));

        await act(async () => {
            assetEvents.emit("updated", { id: "picture" });
        });

        await waitFor(() => expect(result.current.url).toBe("blob:test/2"));
    });
});

describe("useAssetObjectUrl with a source mounted", () => {
    it("resolves through the source instead of the live library", async () => {
        imageAsset("picture");
        fetchResult = { success: true, data: { data: new Uint8Array([9, 9, 9]) } };
        const read = vi.fn(someBytes);

        const { result } = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(read)),
        });

        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));
        expect(read).toHaveBeenCalledWith("picture", AssetType.Image);
    });

    it("answers for avatars too, rather than letting the running compile's table win", async () => {
        await registerCharacterAvatarAssets(new Map([["app://avatar/live.png", "picture"]]));
        const read = vi.fn(someBytes);

        const { result } = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(read)),
        });

        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));
        expect(result.current.url).not.toBe("app://avatar/live.png");
    });

    it("distinguishes an asset absent at that version from a read that broke", async () => {
        const absent = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(async () => ({ kind: "absent" }))),
        });
        await waitFor(() => expect(absent.result.current.error).toBe("Asset not found: picture"));

        const failed = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(async () => ({ kind: "failed", reason: "pack unreadable" }))),
        });
        await waitFor(() => expect(failed.result.current.error).toBe("pack unreadable"));
    });

    it("treats a thrown read as a failure, not as an absence", async () => {
        const { result } = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(async () => {
                throw new Error("revision is gone");
            })),
        });

        await waitFor(() => expect(result.current.error).toBe("revision is gone"));
    });

    it("re-reads when the source names a different version", async () => {
        const read = vi.fn(someBytes);
        const tree = (id: string) => (
            <AssetBytesSourceContext.Provider value={source(read, id)}>
                <Probe />
            </AssetBytesSourceContext.Provider>
        );

        const { rerender } = render(tree("version-1"));
        await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

        // A fresh object with the SAME id is the same version, and must not restart the read.
        rerender(tree("version-1"));
        expect(read).toHaveBeenCalledTimes(1);

        rerender(tree("version-2"));
        await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    });
});

function Probe() {
    useAssetObjectUrl("picture");
    return null;
}
