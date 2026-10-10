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
import { AssetLoadTrackerContext, type AssetLoadTracker } from "@/lib/ui-editor/runtime/assetLoadTracker";
import { useAssetObjectUrl } from "./useAssetObjectUrl";

/**
 * The versioned-asset seam, pinned from both sides.
 *
 * The half that matters most is the half where nothing happens: this hook resolves every picture in
 * Studio, and the seam above its live ladder is inert unless something mounts a source - which only
 * a version-control comparison does. So the first group asserts the live ladder behaves exactly as
 * it did, its subscription to the library included, and the second asserts what the seam does once
 * a source IS mounted: that it wins over the avatar table - an arm that would otherwise keep
 * answering with the running compile's URLs inside a render of an older version - and that it stops
 * listening to a live library whose movements cannot change what a version holds.
 */

const assetEvents = new EventEmitter<Record<string, unknown>>();

let assets: Record<string, Record<string, { id: string; type: AssetType }>> = {};
let fetchResult: { success: boolean; data?: unknown; error?: string } = { success: false };
/** Which ids name a SET rather than a file. A set is keyed on the library, not on one record. */
let knownSets = new Map<string, { id: string }>();

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
        getSet: (id: string) => knownSets.get(id),
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
    knownSets = new Map();
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

    /**
     * The live library moving is not a historical column's business.
     *
     * `AssetsService` raises `updated` and `deleted` for every import, replacement and delete the
     * author makes anywhere in the project, and a comparison pane holds one of these hooks per
     * picture on the page. Left subscribed, one import would re-run every one of them and re-read
     * history to arrive at the same answer - a version's bytes are fixed, and nothing the author
     * does today can change them.
     */
    it("ignores live library churn, because a version's bytes cannot move", async () => {
        imageAsset("picture");
        const read = vi.fn(someBytes);

        const { result } = renderHook(() => useAssetObjectUrl("picture"), {
            wrapper: withSource(source(read)),
        });
        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));

        await act(async () => {
            assetEvents.emit("updated", { id: "picture" });
            assetEvents.emit("deleted", { id: "picture" });
        });

        // No second read, and the picture on screen is the one the version holds.
        expect(read).toHaveBeenCalledTimes(1);
        expect(result.current.url).toBe("blob:test/1");
    });

    it("does not re-resolve a set id when the live library it would resolve against moves", async () => {
        knownSets.set("backdrops", { id: "backdrops" });
        const read = vi.fn(someBytes);

        const { result } = renderHook(() => useAssetObjectUrl("backdrops"), {
            wrapper: withSource(source(read)),
        });
        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));

        // The second live key: a set has no record of its own, so live it is watched on the whole
        // library's revision - which any asset event bumps, including one about another file.
        await act(async () => {
            assetEvents.emit("updated", { id: "some-other-file" });
        });

        // Which file a set means at that version is the source's to answer, from that version's
        // tags. It was handed the set id untouched, and handed it once.
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith("backdrops", AssetType.Image);
    });
});

function Probe() {
    useAssetObjectUrl("picture");
    return null;
}

/**
 * The load tracker a screenshot host mounts. What it must be told is "a lookup is in flight" for
 * exactly as long as one is - a lookup it never hears end would hold every screenshot to its deadline,
 * and one it never hears start lets the photograph be taken before the picture exists.
 */
describe("useAssetObjectUrl under a load tracker", () => {
    function tracking() {
        const open = new Map<number, string>();
        let next = 0;
        const tracker: AssetLoadTracker = {
            begin: label => {
                const token = next++;
                open.set(token, label);
                return () => open.delete(token);
            },
        };
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <AssetLoadTrackerContext.Provider value={tracker}>{children}</AssetLoadTrackerContext.Provider>
        );
        return { open, wrapper };
    }

    it("holds a lookup open until its bytes are back", async () => {
        imageAsset("picture");
        let finish: (value: typeof fetchResult) => void = () => undefined;
        const pending = new Promise<typeof fetchResult>(resolve => {
            finish = resolve;
        });
        const realFetchResult = { success: true, data: { data: new Uint8Array([1]) } };
        const { open, wrapper } = tracking();
        // The mocked service reads `fetchResult` when called: hand it a promise to hold the read open.
        fetchResult = pending as unknown as typeof fetchResult;

        const { result } = renderHook(() => useAssetObjectUrl("picture"), { wrapper });
        await waitFor(() => expect([...open.values()]).toEqual(["picture"]));
        expect(result.current.url).toBeNull();

        await act(async () => {
            finish(realFetchResult);
        });
        await waitFor(() => expect(result.current.url).toBe("blob:test/1"));
        expect(open.size).toBe(0);
    });

    it("ends the lookup when it fails, and when the widget goes away mid-read", async () => {
        imageAsset("picture");
        fetchResult = { success: false, error: "unreadable" };
        const first = tracking();
        const { result } = renderHook(() => useAssetObjectUrl("picture"), { wrapper: first.wrapper });
        await waitFor(() => expect(result.current.error).toBe("unreadable"));
        expect(first.open.size).toBe(0);

        fetchResult = new Promise(() => undefined) as unknown as typeof fetchResult;
        const second = tracking();
        const { unmount } = renderHook(() => useAssetObjectUrl("picture"), { wrapper: second.wrapper });
        await waitFor(() => expect(second.open.size).toBe(1));
        unmount();
        expect(second.open.size).toBe(0);
    });

    it("opens nothing for an answer it has without asking anyone", async () => {
        const { open, wrapper } = tracking();
        const { result } = renderHook(() => useAssetObjectUrl("gone"), { wrapper });
        await waitFor(() => expect(result.current.error).toBe("Asset not found: gone"));
        expect(open.size).toBe(0);
    });
});
