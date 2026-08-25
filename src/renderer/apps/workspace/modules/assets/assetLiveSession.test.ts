import { describe, expect, it } from "vitest";
import { assetsMetadataSpec } from "@shared/documents/specs";
import { freezeAllowsWrite } from "@/lib/app/writeFreeze";
import { liveSessionWritablePaths } from "@shared/live/sharedDocuments";
import { assetClaimKey } from "@shared/live/ops";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { assetLibraryFreezeScope, othersAssetClaims } from "./assetLiveSession";

/**
 * The two halves of one policy, held against each other.
 *
 * The failure this file exists to catch is the interface and the write boundary disagreeing: a
 * surface that offers an edit the gate then refuses is the "quietly discarding everything" failure
 * with an encouraging cursor on it, and a surface greyed over a write the gate would have allowed is
 * a dead control in a workspace that was told it could keep working.
 */
describe("the scope the asset panel names", () => {
    it("is every metadata shard, and exactly the paths a session declares writable", () => {
        // The cast is in that set unconditionally - one per project - so the comparison is against
        // the asset half of it.
        const carried = liveSessionWritablePaths([], { translations: [], voice: [] }, Object.values(AssetType))
            .filter(path => path.includes("assets.metadata."));
        expect([...assetLibraryFreezeScope()].sort()).toEqual([...carried].sort());
        expect(carried).toHaveLength(Object.values(AssetType).length);
    });

    it("is allowed by a session carrying the library, and refused by one that is not", () => {
        const writable = assetLibraryFreezeScope();
        const carrying = { kind: "live-session", session: "room-1", writable } as const;
        for (const path of writable) {
            expect(freezeAllowsWrite(carrying, path)).toBe(true);
        }
        // A session that carries only a story leaves every one of them refused.
        const storyOnly = {
            kind: "live-session",
            session: "room-1",
            writable: ["editor/story/stories/one/storydoc.json"],
        } as const;
        expect(writable.some(path => freezeAllowsWrite(storyOnly, path))).toBe(false);
    });

    it("names the shards through the document spec, so a shard that moves takes it along", () => {
        expect(assetLibraryFreezeScope()).toContain(assetsMetadataSpec.pathFor({ type: AssetType.Image }));
    });

    it("names nothing under assets/content, which is where a file's bytes live", () => {
        // The rule the whole document rests on: a session carries what the project says about an
        // asset and never the asset.
        expect(assetLibraryFreezeScope().some(path => path.startsWith("assets/content"))).toBe(false);
    });

    it("names no folder shard, because a folder has no verb", () => {
        expect(assetLibraryFreezeScope().some(path => path.includes("assets.groups."))).toBe(false);
    });
});

describe("the claims the browser draws", () => {
    function view(claims: Record<string, string>): LiveSessionView {
        return {
            claims,
            self: "instance-mine",
            session: { members: [{ instance: "instance-mine", account: "ada" }] },
        } as unknown as LiveSessionView;
    }

    it("takes only asset claims, so a translator's name never lands on a picture", () => {
        // ⚠ The claim set holds rows, character records, translations in every language and asset
        // records at once, keyed by a prefix.
        const claims = othersAssetClaims(view({
            [assetClaimKey("asset-1")]: "ben",
            "row:block-1": "ben",
            "character:c1": "ben",
            "translation:ja:text-1": "ben",
        }));
        expect(claims).toEqual({ "asset-1": "ben" });
    });

    it("leaves this window's own out, because a mark on your own row is about nobody else", () => {
        expect(othersAssetClaims(view({
            [assetClaimKey("asset-1")]: "ada",
            [assetClaimKey("asset-2")]: "ben",
        }))).toEqual({ "asset-2": "ben" });
    });
});
