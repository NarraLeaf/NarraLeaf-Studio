import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "../assets/assetTypes";
import { Services, type WorkspaceContext } from "../services";
import { UIEditorFontFaceService } from "./UIEditorFontFaceService";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fontBytes() {
    return { success: true, data: { data: new Uint8Array([1, 2, 3]), metadata: { format: "ttf" } } };
}

async function fontHarness() {
    const pending: Array<ReturnType<typeof deferred<ReturnType<typeof fontBytes>>>> = [];
    const listeners = new Map<string, (asset: { id: string; type: AssetType }) => void>();
    const asset = { id: "font-a", type: AssetType.Font, ext: "ttf" };
    const assets = {
        getAssets: () => ({ [AssetType.Font]: { [asset.id]: asset } }),
        getEvents: () => ({
            on: (event: string, handler: (font: { id: string; type: AssetType }) => void) => {
                listeners.set(event, handler);
                return () => listeners.delete(event);
            },
        }),
        fetch: vi.fn(() => {
            const request = deferred<ReturnType<typeof fontBytes>>();
            pending.push(request);
            return request.promise;
        }),
    };
    const faces = new Set<unknown>();
    class TestFontFace {
        constructor(public family: string, public source: string) {}
        async load() { return this; }
    }
    vi.stubGlobal("FontFace", TestFontFace);
    vi.stubGlobal("document", { fonts: { add: (face: unknown) => faces.add(face), delete: (face: unknown) => faces.delete(face) } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:font");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const service = new UIEditorFontFaceService();
    const context = { services: { get: (key: Services) => key === Services.Assets ? assets : null } } as unknown as WorkspaceContext;
    await service.initialize(context, async () => undefined);
    return { service, context, assets, asset, pending, faces, update: () => listeners.get("updated")?.(asset) };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("UIEditorFontFaceService asset lifetimes", () => {
    it("keeps a replacement load when an invalidated request completes", async () => {
        const { service, context, pending, update, faces } = await fontHarness();
        const old = service.acquire("font-a");
        update();
        const current = service.acquire("font-a");

        pending[0].resolve(fontBytes());
        for (let i = 0; i < 10; i++) await Promise.resolve();
        pending[1].resolve(fontBytes());
        const results = await Promise.all([old, current]);

        expect(results[1].ok).toBe(true);
        expect(faces.size).toBe(1);
        for (const result of results) if (result.ok) service.release("font-a");
        await service.teardown(context);
    });

    it("keeps a replacement while an earlier user releases the same font", async () => {
        const { service, context, pending, update, faces } = await fontHarness();
        const first = service.acquire("font-a");
        pending[0].resolve(fontBytes());
        expect((await first).ok).toBe(true);

        update();
        const second = service.acquire("font-a");
        service.release("font-a");
        pending[1].resolve(fontBytes());

        expect((await second).ok).toBe(true);
        expect(faces.size).toBe(1);
        service.release("font-a");
        expect(faces.size).toBe(0);
        await service.teardown(context);
    });

    it("refreshes an updated font held by an existing preview", async () => {
        const { service, context, pending, update, faces, assets } = await fontHarness();
        const first = service.acquire("font-a");
        pending[0].resolve(fontBytes());
        expect((await first).ok).toBe(true);

        update();
        expect(assets.fetch).toHaveBeenCalledTimes(2);
        pending[1].resolve(fontBytes());
        await vi.waitFor(() => expect(faces.size).toBe(1));

        service.release("font-a");
        expect(faces.size).toBe(0);
        await service.teardown(context);
    });
});
