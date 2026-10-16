import { describe, expect, it } from "vitest";
import { forEachUiAssetIdSlot } from "../../build/uiAssetSlots";
import { normalizeUIPageMusic, normalizeUIPageMusicChoice, readUIPageMusic, readUIPageMusicChoice } from "./pageMusic";

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
        expect(normalizeUIPageMusic({ silent: true })).toBeNull();
    });

    it("is one of three answers: keep what plays, play this, or silence", () => {
        expect(normalizeUIPageMusicChoice(undefined)).toEqual({ kind: "keep" });
        expect(normalizeUIPageMusicChoice({ volume: 0.5 })).toEqual({ kind: "keep" });
        expect(normalizeUIPageMusicChoice({ silent: "yes" })).toEqual({ kind: "keep" });
        expect(normalizeUIPageMusicChoice({ silent: true })).toEqual({ kind: "silence" });
        expect(normalizeUIPageMusicChoice({ assetId: "theme" })).toEqual({ kind: "play", music: { assetId: "theme" } });
        // A clip is what an author can see something of, so it wins over a flag written beside it.
        expect(normalizeUIPageMusicChoice({ assetId: "theme", silent: true })).toEqual({ kind: "play", music: { assetId: "theme" } });
    });

    it("belongs to pages only", () => {
        const settings = { music: { assetId: "theme" } };
        expect(readUIPageMusic({ kind: "appSurface", settings })).toEqual({ assetId: "theme" });
        expect(readUIPageMusic({ kind: "stageSurface", settings })).toBeNull();
        expect(readUIPageMusicChoice({ kind: "stageSurface", settings: { music: { silent: true } } })).toEqual({ kind: "keep" });
        expect(readUIPageMusic({ kind: "appSurface", settings: { music: { silent: true } } })).toBeNull();
    });

    it("sits in a slot every build pass finds by name, and a silent page names no asset", () => {
        const found: string[] = [];
        forEachUiAssetIdSlot({ music: { assetId: "theme" } }, slot => found.push(`${slot.key}=${slot.read()}`));
        expect(found).toEqual(["assetId=theme"]);
        const none: string[] = [];
        forEachUiAssetIdSlot({ music: { silent: true } }, slot => none.push(slot.key));
        expect(none).toEqual([]);
    });
});
