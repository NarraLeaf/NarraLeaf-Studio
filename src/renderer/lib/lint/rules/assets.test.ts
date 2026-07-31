import { describe, expect, it, vi } from "vitest";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import type { AssetReference } from "../../workspace/services/references/referenceModel";
import type { LintAssetEntry, LintContext, LintImageProbe } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintFinding, LintRuleId } from "../types";
import { ASSETS_LINT_RULES } from "./assets";

/**
 * The `assets` rules, stated as what each one must *not* say: that a whole library is unused because
 * the index never built, that a live reference is dangling, or that a model bundle is unreadable
 * because bundles are not files.
 */

function runRule(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = ASSETS_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return Promise.resolve(rule.run(ctx, {}));
}

function asset(id: string, overrides: Partial<LintAssetEntry> = {}): LintAssetEntry {
    return { id, type: AssetType.Image, name: `${id}.png`, ext: "png", meta: {}, ...overrides };
}

const storyReference: AssetReference = {
    id: "story:s1:sc1:b1:background.assetId",
    assetId: "gone",
    kind: "story",
    label: "Kitchen",
    detail: "Chapter 1 › Kitchen",
    field: "background.assetId",
    target: {
        kind: "storyBlock",
        storyId: "s1",
        sceneId: "sc1",
        blockId: "b1",
        storyName: "Chapter 1",
        sceneName: "Kitchen",
    },
};

describe("assets/unused", () => {
    it("reports a library asset nothing references", async () => {
        const ctx = createTestLintContext({
            assets: [asset("used"), asset("orphan")],
            referencedAssetIds: new Set(["used"]),
        });

        const findings = await runRule("assets/unused", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsUnused.message");
        expect(findings[0].messageParams).toEqual({ asset: "orphan.png" });
        expect(findings[0].location).toEqual({ kind: "asset", assetId: "orphan", assetName: "orphan.png" });
        expect(findings[0].target).toEqual({ kind: "asset", assetId: "orphan", assetType: AssetType.Image });
    });

    it("stays silent when every asset is referenced", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a"), asset("b")],
            referencedAssetIds: new Set(["a", "b"]),
        });

        expect(await runRule("assets/unused", ctx)).toEqual([]);
    });

    it("indicts nothing when the reference index is empty but the library is not", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a"), asset("b"), asset("c")],
            referencedAssetIds: new Set<string>(),
        });

        expect(await runRule("assets/unused", ctx)).toEqual([]);
    });
});

describe("assets/missing", () => {
    it("reports a reference to an id the library no longer has", async () => {
        const ctx = createTestLintContext({
            assets: [asset("present")],
            assetReferences: new Map([["gone", [storyReference]]]),
        });

        const findings = await runRule("assets/missing", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsMissing.message");
        expect(findings[0].messageParams).toEqual({ location: "Chapter 1 › Kitchen (background.assetId)" });
        expect(findings[0].location).toEqual({
            kind: "story",
            storyId: "s1",
            storyName: "Chapter 1",
            sceneId: "sc1",
            sceneName: "Kitchen",
            blockId: "b1",
        });
        // The jump lands on the referencing block, not on an asset row that does not exist.
        expect(findings[0].target).toEqual(storyReference.target);
    });

    it("stays silent when the referenced asset is in the library", async () => {
        const ctx = createTestLintContext({
            assets: [asset("gone")],
            assetReferences: new Map([["gone", [storyReference]]]),
        });

        expect(await runRule("assets/missing", ctx)).toEqual([]);
    });

    it("locates a character reference through the context", async () => {
        const reference: AssetReference = {
            id: "char:c1:thumbnail",
            assetId: "gone",
            kind: "character",
            label: "Alice",
            field: "profile.thumbnail",
        };
        const ctx = createTestLintContext({
            characters: [{ id: "c1", name: "Alice", assetIds: ["gone"] }],
            assetReferences: new Map([["gone", [reference]]]),
        });

        const findings = await runRule("assets/missing", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].location).toEqual({ kind: "character", characterId: "c1", characterName: "Alice" });
        expect(findings[0].messageParams).toEqual({ location: "Alice (profile.thumbnail)" });
    });

    it("falls back to the project for a site with no location kind of its own", async () => {
        const reference: AssetReference = {
            id: "ui:e1:imageFill",
            assetId: "gone",
            kind: "uiElement",
            label: "Title Card",
            detail: "Main Menu",
            field: "imageFill",
        };
        const ctx = createTestLintContext({ assetReferences: new Map([["gone", [reference]]]) });

        const findings = await runRule("assets/missing", ctx);

        expect(findings[0].location).toEqual({ kind: "project" });
        expect(findings[0].messageParams).toEqual({ location: "Main Menu › Title Card (imageFill)" });
    });

    it("emits one finding per referencing site", async () => {
        const second: AssetReference = { ...storyReference, id: "second", field: "displayable.maskAssetId" };
        const ctx = createTestLintContext({ assetReferences: new Map([["gone", [storyReference, second]]]) });

        expect(await runRule("assets/missing", ctx)).toHaveLength(2);
    });

    it("still names the id when the key carries no sites", async () => {
        const ctx = createTestLintContext({ assetReferences: new Map([["gone", []]]) });

        const findings = await runRule("assets/missing", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ location: "gone" });
        expect(findings[0].location).toEqual({ kind: "project" });
    });
});

describe("assets/unreadable", () => {
    const readable = new Uint8Array([1, 2, 3]);

    it("reports a file that is not on disk", async () => {
        const ctx = createTestLintContext({
            assets: [asset("broken")],
            io: {
                exists: async () => false,
                readBytes: async () => null,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: true, width: 1, height: 1 }),
            },
        });

        const findings = await runRule("assets/unreadable", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsUnreadable.messageMissingBytes");
        expect(findings[0].messageParams).toEqual({ asset: "broken.png" });
    });

    it("distinguishes a decode failure from a missing file", async () => {
        const probeImage = vi.fn(async (): Promise<LintImageProbe> => ({ ok: false, reason: "not a png" }));
        const ctx = createTestLintContext({
            assets: [asset("corrupt")],
            io: { exists: async () => true, readBytes: async () => readable, probeImage },
        });

        const findings = await runRule("assets/unreadable", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsUnreadable.message");
        expect(probeImage).toHaveBeenCalledWith("corrupt");
    });

    it("stays silent for an image that is present and decodes", async () => {
        const ctx = createTestLintContext({
            assets: [asset("fine")],
            io: {
                exists: async () => true,
                readBytes: async () => readable,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: true, width: 800, height: 600 }),
            },
        });

        expect(await runRule("assets/unreadable", ctx)).toEqual([]);
    });

    /**
     * The point of the whole `exists` seam: presence is a stat, and a library of audio and video is
     * never pulled off disk to answer it. A rule that read every asset once per build was reading
     * gigabytes to learn a boolean.
     */
    it("never reads a non-image asset in full, and never probes it", async () => {
        const readBytes = vi.fn(async () => readable);
        const probeImage = vi.fn(async (): Promise<LintImageProbe> => ({ ok: false, reason: "not an image asset" }));
        const exists = vi.fn(async () => true);
        const ctx = createTestLintContext({
            assets: [
                asset("bgm", { type: AssetType.Audio, name: "bgm.ogg", ext: "ogg" }),
                asset("font", { type: AssetType.Font, name: "serif.ttf", ext: "ttf" }),
            ],
            io: { exists, readBytes, probeImage },
        });

        expect(await runRule("assets/unreadable", ctx)).toEqual([]);
        expect(exists.mock.calls).toEqual([["bgm"], ["font"]]);
        expect(readBytes).not.toHaveBeenCalled();
        expect(probeImage).not.toHaveBeenCalled();
    });

    it("does not read an image in full either - probeImage owns the bytes", async () => {
        const readBytes = vi.fn(async () => readable);
        const ctx = createTestLintContext({
            assets: [asset("fine")],
            io: {
                exists: async () => true,
                readBytes,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: true, width: 8, height: 8 }),
            },
        });

        expect(await runRule("assets/unreadable", ctx)).toEqual([]);
        expect(readBytes).not.toHaveBeenCalled();
    });

    it("skips model bundles and remote assets, which have no shard to stat", async () => {
        const exists = vi.fn(async () => false);
        const readBytes = vi.fn(async () => null);
        const ctx = createTestLintContext({
            assets: [
                asset("hiyori", { type: AssetType.Model, name: "Hiyori", ext: undefined }),
                asset("remote", { meta: { url: "https://example.com/bg.png", lifetime: 0 } }),
            ],
            io: {
                exists,
                readBytes,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: false, reason: "unreadable" }),
            },
        });

        expect(await runRule("assets/unreadable", ctx)).toEqual([]);
        expect(exists).not.toHaveBeenCalled();
        expect(readBytes).not.toHaveBeenCalled();
    });
});
