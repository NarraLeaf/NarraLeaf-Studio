import { beforeEach, describe, expect, it } from "vitest";
import { characterAvatarAssetId } from "@shared/utils/characterAvatar";
import {
    clearCharacterAvatarAssets,
    isCharacterAvatarAssetId,
    registerCharacterAvatarAssets,
    resolveCharacterAvatarAssetUrl,
} from "./characterAvatarAssets";

describe("characterAvatarAssets", () => {
    beforeEach(() => {
        clearCharacterAvatarAssets();
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
});
