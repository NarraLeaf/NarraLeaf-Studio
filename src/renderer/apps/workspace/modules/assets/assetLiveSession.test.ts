import { describe, expect, it } from "vitest";
import { assetGroupsSpec, assetsMetadataSpec } from "@shared/documents/specs";
import { freezeAllowsWrite } from "@/lib/app/writeFreeze";
import { liveSessionWritablePaths } from "@shared/live/sharedDocuments";
import { assetClaimKey } from "@shared/live/ops";
import { ASSET_CATEGORY_ORDER, AssetType } from "@/lib/workspace/services/assets/assetTypes";
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
    it("is exactly what a session leaves writable for the library, and no more", () => {
        // The two halves of one policy held against each other. A surface that offers an edit the
        // gate then refuses is the "quietly discarding everything" failure with an encouraging cursor
        // on it; a surface greyed over a write the gate would have allowed is a dead control.
        const carried = liveSessionWritablePaths(
            [],
            { translations: [], voice: [] },
            Object.values(AssetType),
            ASSET_CATEGORY_ORDER,
        ).filter(path => path.startsWith("assets/"));
        // The row-order shards are the one thing a session leaves writable that this panel never
        // names: nothing anybody presses writes them, and `AssetOrderManager` puts them right when
        // the records move.
        const named = new Set(assetLibraryFreezeScope());
        for (const path of carried) {
            if (path.includes("assets.order.")) {
                expect(named.has(path)).toBe(false);
                continue;
            }
            expect(named.has(path)).toBe(true);
        }
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

    it("names the shards through their document specs, so a shard that moves takes it along", () => {
        expect(assetLibraryFreezeScope()).toContain(assetsMetadataSpec.pathFor({ type: AssetType.Image }));
        expect(assetLibraryFreezeScope()).toContain(assetGroupsSpec.pathFor({ category: "media" }));
    });

    it("names the payload root, and covers a file several directories inside it", () => {
        // ⚠ The one path here with no document spec, because a payload is not a format anything
        // parses. `freezeAllowsWrite` takes an entry as standing for everything under it, which is
        // what makes one directory cover every file.
        expect(assetLibraryFreezeScope()).toContain("assets/content");
        const carrying = {
            kind: "live-session",
            session: "room-1",
            writable: assetLibraryFreezeScope(),
        } as const;
        expect(freezeAllowsWrite(carrying, "assets/content/ab/cd/ef-1234.png")).toBe(true);
        // And not a sibling that merely starts with the same letters.
        expect(freezeAllowsWrite(carrying, "assets/contentious.json")).toBe(false);
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
