// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetType } from "../services/assets/assetTypes";
import type { Character } from "../services/character/Character";
import { EventEmitter } from "../services/ui/EventEmitter";
import { useCompositedSprite } from "./useCompositedSprite";

const events = new EventEmitter<Record<string, unknown>>();
let finishFetch!: (result: { success: false }) => void;
const assets = {
    getEvents: () => events,
    getAssets: () => ({ [AssetType.Image]: { image: { id: "image" } } }),
    fetch: () => new Promise<{ success: false }>(resolve => { finishFetch = resolve; }),
};
const workspace = {
    isInitialized: true,
    context: { services: { get: () => assets } },
};

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => workspace }));

describe("useCompositedSprite", () => {
    it("stops loading when the character is cleared before its image arrives", async () => {
        const character = {
            profile: {
                getId: () => "character",
                appearance: { resolveDrawList: () => ["image"] },
            },
            subscribe: () => () => undefined,
        } as unknown as Character;
        const { result, rerender, unmount } = renderHook(
            ({ selected }: { selected: Character | null }) => useCompositedSprite(selected, {}),
            { initialProps: { selected: character as Character | null } },
        );

        expect(result.current.loading).toBe(true);
        rerender({ selected: null });
        expect(result.current).toEqual({ url: null, size: null, loading: false });
        await act(async () => finishFetch({ success: false }));
        expect(result.current.loading).toBe(false);
        unmount();
    });
});
