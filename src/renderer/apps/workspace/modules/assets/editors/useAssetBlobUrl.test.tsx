// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetBlobUrl } from "./useAssetBlobUrl";

const library = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: workspace }),
}));
const workspace = { services: { get: () => ({ fetch: library.fetch }) } };

const asset = { id: "clip", hash: "same-bytes" } as never;
const create = vi.fn();
const revoke = vi.fn();

beforeEach(() => {
    library.fetch.mockResolvedValue({ success: true, data: { data: new Uint8Array([1, 2]) } });
    create.mockImplementation((_blob: Blob) => `blob:${create.mock.calls.length}`);
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
    });
});
afterEach(() => {
    cleanup();
    library.fetch.mockReset();
    create.mockReset();
    revoke.mockReset();
    vi.unstubAllGlobals();
});

describe("asset object URL", () => {
    it("rebuilds and releases the URL when its MIME type changes", async () => {
        const hook = renderHook(({ mime }) => useAssetBlobUrl(asset, mime), {
            initialProps: { mime: "video/mp4" },
        });
        await waitFor(() => expect(hook.result.current.url).toBe("blob:1"));
        expect((create.mock.calls[0][0] as Blob).type).toBe("video/mp4");

        hook.rerender({ mime: "video/webm" });
        await waitFor(() => expect(hook.result.current.url).toBe("blob:2"));
        expect((create.mock.calls[1][0] as Blob).type).toBe("video/webm");
        expect(revoke).toHaveBeenCalledWith("blob:1");
        hook.unmount();
        expect(revoke).toHaveBeenCalledWith("blob:2");
    });
});
