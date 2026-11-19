// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { Services } from "@/lib/workspace/services/services";
import { resetAvatarBakeStateForTests, useAvatarBakeBeforeLaunch, useCharacterAvatarBake } from "./useCharacterAvatarBake";

const workspace = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: workspace.context, isInitialized: true }),
}));
vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({ useWorkspaceFrozen: () => false }));

class TestCanvas {
    pixels: number[] = [];
    constructor(public width: number, public height: number) {}
    getContext() {
        return {
            drawImage: (source: TestCanvas | { pixel: number }) => {
                this.pixels = source instanceof TestCanvas ? [...source.pixels] : [...this.pixels, source.pixel];
            },
        };
    }
    async convertToBlob() {
        return new NodeBlob([new Uint8Array(this.pixels)]);
    }
}

function harness() {
    const character = Character.fromJSON({
        profile: {
            id: "c1", name: "Narra", description: "", tags: [], attributes: {}, nicknames: [], thumbnail: null,
            portrait: { x: 0, y: 0, w: 0.5, h: 0.5 },
            appearance: { kind: "preset", defaultPoseId: "p1", poses: [{ id: "p1", name: "Default", assetId: "a1" }], avatars: {} },
        },
    } as never);
    const characters = new CharacterService();
    const internal = characters as unknown as {
        characters: Record<string, Character>;
        characterOrder: string[];
        emitChange: () => void;
    };
    internal.characters.c1 = character;
    internal.characterOrder.push("c1");
    character.setOnChange(() => internal.emitChange());

    const assets = new AssetsService();
    const record = { id: "a1", type: AssetType.Image, hash: "hash-1" };
    const records: Record<string, Record<string, typeof record>> = { [AssetType.Image]: { a1: record } };
    let pixel = 1;
    let gate: Promise<void> | null = null;
    let readable = true;
    let writeFailure = false;
    const readStarted = vi.fn();
    vi.spyOn(assets, "getAssets").mockImplementation(() => records as never);
    vi.spyOn(assets, "fetch").mockImplementation(async () => {
        const current = pixel;
        readStarted();
        if (gate) await gate;
        if (!readable) return { success: false, error: "unreadable" } as never;
        return { success: true, data: { data: new Uint8Array([current]) } } as never;
    });

    const files = new Map<string, Uint8Array>();
    const project = {
        readProjectIconFile: async (path: string) => files.get(path) ?? null,
        projectIconFileExists: async (path: string) => files.has(path),
        writeProjectDerivedFile: async (path: string, bytes: Uint8Array) => {
            if (writeFailure) throw new Error("disk full");
            files.set(path, bytes);
            return true;
        },
        deleteProjectIconFile: async (path: string) => { files.delete(path); },
    };
    workspace.context = {
        services: { get: (key: string) => ({ [Services.Character]: characters, [Services.Assets]: assets, [Services.Project]: project })[key] },
    };
    const path = "resources/characters/avatars/c1/p1.png";
    return {
        character, characters, assets, record, files, path, readStarted,
        replaceImage(next: number) {
            pixel = next;
            record.hash = `hash-${next}`;
            assets.getEvents().emit("updated", record as never);
        },
        deleteImage() {
            delete records[AssetType.Image].a1;
            assets.getEvents().emit("deleted", record as never);
        },
        holdRead(promise: Promise<void>) { gate = promise; },
        setReadable(next: boolean) { readable = next; },
        setWriteFailure(next: boolean) { writeFailure = next; },
    };
}

beforeEach(() => {
    resetAvatarBakeStateForTests();
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("OffscreenCanvas", TestCanvas);
    vi.stubGlobal("createImageBitmap", async (blob: NodeBlob) => ({
        width: 10, height: 10, pixel: new Uint8Array(await blob.arrayBuffer())[0], close() {},
    }));
});

afterEach(() => {
    cleanup();
    resetAvatarBakeStateForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    workspace.context = null;
});

describe("the character avatar bake through the workspace hooks", () => {
    it("re-bakes changed image bytes before a launch even when the character is unchanged", async () => {
        const h = harness();
        renderHook(() => {
            useAvatarBakeBeforeLaunch();
            return useCharacterAvatarBake(true);
        });
        await waitFor(() => expect([...h.files.get(h.path) ?? []]).toEqual([1]));

        await act(async () => {
            h.replaceImage(2);
            await h.characters.flushPendingChanges();
        });

        expect([...h.files.get(h.path) ?? []]).toEqual([2]);
    });

    it("checks image changes before launch even if the character panel has never opened", async () => {
        const h = harness();
        renderHook(() => useAvatarBakeBeforeLaunch());
        await act(async () => h.characters.flushPendingChanges());
        expect([...h.files.get(h.path) ?? []]).toEqual([1]);

        await act(async () => {
            h.replaceImage(2);
            await h.characters.flushPendingChanges();
        });
        expect([...h.files.get(h.path) ?? []]).toEqual([2]);
    });

    it("re-bakes an updated image after the panel's debounce", async () => {
        const h = harness();
        renderHook(() => useCharacterAvatarBake(true));
        await waitFor(() => expect([...h.files.get(h.path) ?? []]).toEqual([1]));
        act(() => h.replaceImage(2));
        await waitFor(() => expect([...h.files.get(h.path) ?? []]).toEqual([2]), { timeout: 2000 });
    });

    it("removes the bake when its source image is deleted", async () => {
        const h = harness();
        renderHook(() => {
            useAvatarBakeBeforeLaunch();
            return useCharacterAvatarBake(true);
        });
        await waitFor(() => expect(h.files.has(h.path)).toBe(true));
        await act(async () => {
            h.deleteImage();
            await h.characters.flushPendingChanges();
        });
        expect(h.files.has(h.path)).toBe(false);
        expect(h.character.profile.appearance.getAvatar("p1")).toBeNull();
    });

    it("retries an unreadable image on the next launch", async () => {
        const h = harness();
        h.setReadable(false);
        renderHook(() => useAvatarBakeBeforeLaunch());
        await act(async () => h.characters.flushPendingChanges());
        expect(h.files.has(h.path)).toBe(false);

        h.setReadable(true);
        await act(async () => h.characters.flushPendingChanges());
        expect([...h.files.get(h.path) ?? []]).toEqual([1]);
    });

    it("retries a failed panel bake at launch", async () => {
        const h = harness();
        h.setWriteFailure(true);
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        renderHook(() => {
            useAvatarBakeBeforeLaunch();
            return useCharacterAvatarBake(true);
        });
        await waitFor(() => expect(warning).toHaveBeenCalled());
        expect(h.files.has(h.path)).toBe(false);
        h.setWriteFailure(false);
        await act(async () => h.characters.flushPendingChanges());
        expect([...h.files.get(h.path) ?? []]).toEqual([1]);
    });

    it("preserves an avatar override written while the image is being decoded", async () => {
        const h = harness();
        let release!: () => void;
        h.holdRead(new Promise<void>(resolve => { release = resolve; }));
        const view = renderHook(() => useCharacterAvatarBake(true));
        await waitFor(() => expect(h.readStarted).toHaveBeenCalledOnce());

        const portrait = { x: 0.2, y: 0.1, w: 0.3, h: 0.3 };
        act(() => h.character.profile.appearance.setAvatar("p1", { overrideAssetId: "hand-drawn", portrait }));
        await act(async () => {
            release();
        });
        await waitFor(() => expect(view.result.current.running).toBe(false));

        expect(h.character.profile.appearance.getAvatar("p1")).toEqual({ overrideAssetId: "hand-drawn", portrait });
        await act(async () => h.characters.flushPendingChanges());
        expect(h.files.has(h.path)).toBe(false);
    });
});
