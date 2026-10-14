import { describe, expect, it } from "vitest";
import { forEachUiAssetIdSlot } from "../../build/uiAssetSlots";
import { normalizeUIPageMusic, readUIPageMusic } from "./pageMusic";

describe("a page's music", () => {
    it("is read with its options, and dropped options fall back to their defaults", () => {
        expect(normalizeUIPageMusic({ assetId: " theme ", audioTrackId: "bgm", volume: 0.5, loop: false, fadeMs: 1200 }))
            .toEqual({ assetId: "theme", audioTrackId: "bgm", volume: 0.5, loop: false, fadeMs: 1200 });
        expect(normalizeUIPageMusic({ assetId: "theme", audioTrackId: " ", volume: Number.NaN, loop: "yes", fadeMs: -1 }))
            .toEqual({ assetId: "theme" });
    });

    it("is no music without a clip", () => {
        expect(normalizeUIPageMusic(undefined)).toBeNull();
        expect(normalizeUIPageMusic({ volume: 0.5 })).toBeNull();
        expect(normalizeUIPageMusic({ assetId: "  " })).toBeNull();
        expect(normalizeUIPageMusic([])).toBeNull();
    });

    it("belongs to pages only", () => {
        const settings = { music: { assetId: "theme" } };
        expect(readUIPageMusic({ kind: "appSurface", settings })).toEqual({ assetId: "theme" });
        expect(readUIPageMusic({ kind: "stageSurface", settings })).toBeNull();
    });

    it("sits in a slot every build pass finds by name", () => {
        const found: string[] = [];
        forEachUiAssetIdSlot({ music: { assetId: "theme" } }, slot => found.push(`${slot.key}=${slot.read()}`));
        expect(found).toEqual(["assetId=theme"]);
    });
});
