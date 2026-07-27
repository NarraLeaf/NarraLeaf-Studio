import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import {
    clearCharacterAvatarAssets,
    isCharacterAvatarAssetId,
    isCharacterAvatarDecoded,
    registerCharacterAvatarAssets,
    resolveCharacterAvatarAssetUrl,
} from "./characterAvatarAssets";

/**
 * A stand-in for the browser's `Image`, recording which URLs were decoded. The real one is what
 * holds the decoded bitmap alive; here we only need to know the decode was asked for, against the
 * URL the widget will actually render.
 */
function installFakeImage(): { decoded: string[] } {
    const decoded: string[] = [];
    class FakeImage {
        public src = "";
        public decode(): Promise<void> {
            decoded.push(this.src);
            return Promise.resolve();
        }
    }
    vi.stubGlobal("window", { Image: FakeImage });
    return { decoded };
}

describe("characterAvatarAssets", () => {
    beforeEach(() => {
        clearCharacterAvatarAssets();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("inverts the compile's url→id table into a synchronous id→url lookup", () => {
        const baked = characterAvatarAssetId("alice", "pose-angry");
        registerCharacterAvatarAssets(new Map([
            ["nlr://avatar-angry.png", baked],
            ["nlr://avatar-default.png", "asset-default"],
        ]));

        expect(resolveCharacterAvatarAssetUrl(baked)).toBe("nlr://avatar-angry.png");
        expect(resolveCharacterAvatarAssetUrl("asset-default")).toBe("nlr://avatar-default.png");
    });

    it("drops the previous story's avatars when a new compile mounts", () => {
        registerCharacterAvatarAssets(new Map([["nlr://old.png", "asset-old"]]));
        registerCharacterAvatarAssets(new Map([["nlr://new.png", "asset-new"]]));

        // Not merged: a stale entry would keep resolving after a recompile changed the URL.
        expect(resolveCharacterAvatarAssetUrl("asset-old")).toBeNull();
        expect(resolveCharacterAvatarAssetUrl("asset-new")).toBe("nlr://new.png");
    });

    it("claims synthetic baked ids even when nothing is mounted", () => {
        // The widget stops here rather than spending an IPC round trip on an id the asset library
        // has never heard of.
        expect(isCharacterAvatarAssetId(characterAvatarAssetId("alice", "pose-angry"))).toBe(true);
        expect(isCharacterAvatarAssetId("4b645b59-1723-4ac9-98ab-e6859b837bef")).toBe(false);
        expect(isCharacterAvatarAssetId(null)).toBe(false);
    });

    it("answers null for an unregistered id rather than throwing", () => {
        expect(resolveCharacterAvatarAssetUrl("asset-missing")).toBeNull();
        expect(resolveCharacterAvatarAssetUrl(undefined)).toBeNull();
    });

    it("decodes against the URL the widget will render, not a re-encoding of it", async () => {
        const fake = installFakeImage();
        await registerCharacterAvatarAssets(new Map([["nlr://avatar-angry.png", "asset-angry"]]));

        // The engine's own cache decodes a base64 copy, whose decoded bitmap a plain
        // `<img src="nlr://...">` can never reach. This one is keyed to the real URL.
        expect(fake.decoded).toEqual(["nlr://avatar-angry.png"]);
        expect(isCharacterAvatarDecoded("nlr://avatar-angry.png")).toBe(true);
    });

    it("drops retained bitmaps when the session unmounts", async () => {
        const fake = installFakeImage();
        await registerCharacterAvatarAssets(new Map([["nlr://avatar.png", "asset-a"]]));
        expect(isCharacterAvatarDecoded("nlr://avatar.png")).toBe(true);

        clearCharacterAvatarAssets();

        // Holding the element is the retention, so releasing it is what frees the bitmap - a
        // session that never released would leak one full-resolution image per avatar per story.
        expect(isCharacterAvatarDecoded("nlr://avatar.png")).toBe(false);
        expect(fake.decoded).toHaveLength(1);
    });

    it("survives an environment with no DOM", async () => {
        vi.stubGlobal("window", undefined);
        await expect(registerCharacterAvatarAssets(new Map([["nlr://a.png", "asset-a"]]))).resolves.toBeUndefined();
        expect(resolveCharacterAvatarAssetUrl("asset-a")).toBe("nlr://a.png");
    });
});
