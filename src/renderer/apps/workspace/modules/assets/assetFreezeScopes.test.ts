import { describe, expect, it } from "vitest";
import { assetGroupsSpec, assetsMetadataSpec } from "@shared/documents/specs";
import { freezeAllowsWrite } from "@/lib/app/writeFreeze";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { assetLibraryFreezeScope } from "./assetFreezeScopes";

/**
 * The scope the asset panel names, held against the write boundary.
 *
 * The failure this file exists to catch is the interface and the write boundary disagreeing: a
 * surface that offers an edit the gate then refuses is the "quietly discarding everything" failure
 * with an encouraging cursor on it, and a surface greyed over a write the gate would have allowed is
 * a dead control in a workspace that was told it could keep working.
 */
describe("the scope the asset panel names", () => {
    it("is allowed by a freeze leaving the library writable, and refused by one that is not", () => {
        const writable = assetLibraryFreezeScope();
        const carrying = { kind: "live-session", session: "team-documents", writable } as const;
        for (const path of writable) {
            expect(freezeAllowsWrite(carrying, path)).toBe(true);
        }
        // A freeze that leaves only a story writable leaves every one of them refused.
        const storyOnly = {
            kind: "live-session",
            session: "team-documents",
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
            session: "team-documents",
            writable: assetLibraryFreezeScope(),
        } as const;
        expect(freezeAllowsWrite(carrying, "assets/content/ab/cd/ef-1234.png")).toBe(true);
        // And not a sibling that merely starts with the same letters.
        expect(freezeAllowsWrite(carrying, "assets/contentious.json")).toBe(false);
    });
});
