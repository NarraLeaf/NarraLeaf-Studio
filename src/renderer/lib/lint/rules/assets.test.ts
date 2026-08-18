import { describe, expect, it, vi } from "vitest";
import type { AssetSet } from "@shared/types/assetSet";
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
    return { id, type: AssetType.Image, name: `${id}.png`, ext: "png", meta: {}, tags: [], ...overrides };
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

    it("reports every asset when a complete index found no references at all", async () => {
        // A tidy project with nothing wired up yet is a real state, and the old stand-in for
        // "the index is broken" - an empty key set - hid its findings forever.
        const ctx = createTestLintContext({
            assets: [asset("a"), asset("b"), asset("c")],
            referencedAssetIds: new Set<string>(),
        });

        expect(await runRule("assets/unused", ctx)).toHaveLength(3);
    });

    it("lists nothing and names the site when the index does not cover the project", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a"), asset("b")],
            referencedAssetIds: new Set<string>(),
            assetIndex: {
                complete: false,
                gaps: [{ reason: "hashUrlUnresolved", slice: "ui", location: "Title Screen.backgroundImage" }],
            },
        });

        const findings = await runRule("assets/unused", ctx);

        // Not one unused row among them: a partial answer here is indistinguishable from a complete
        // one, and every reference the index missed is an asset this rule would tell them to delete.
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsUnused.messageIndexUnresolved");
        expect(findings[0].messageParams).toEqual({ location: "Title Screen.backgroundImage" });
    });

    it("still reports the kinds a picture-shaped gap cannot be hiding", async () => {
        // Withholding everything was the first shape and it was too blunt: one widget with an
        // unreadable picture silenced the report for the sounds too, which are not in doubt.
        const ctx = createTestLintContext({
            assets: [asset("pic"), asset("tune", { type: AssetType.Audio, name: "tune.mp3", ext: "mp3" })],
            referencedAssetIds: new Set<string>(),
            assetIndex: {
                complete: false,
                gaps: [{ reason: "hashUrlUnresolved", slice: "ui", location: "Title Screen.backgroundImage", affects: ["image"] }],
            },
        });

        const findings = await runRule("assets/unused", ctx);

        expect(findings.map(finding => finding.messageKey)).toEqual([
            "lint.rule.assetsUnused.messageIndexUnresolved",
            "lint.rule.assetsUnused.message",
        ]);
        // The audio row, and only the audio row.
        expect(findings[1].messageParams).toEqual({ asset: "tune.mp3" });
    });

    it("says the project could not be scanned when the index never built", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a")],
            assetIndex: { complete: false, gaps: [{ reason: "indexNotBuilt" }] },
        });

        const findings = await runRule("assets/unused", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsUnused.messageIndexNotBuilt");
        expect(findings[0].messageParams).toBeUndefined();
    });

    it("names the document when a slice could not be read", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a")],
            assetIndex: {
                complete: false,
                gaps: [{ reason: "documentUnreadable", slice: "story", location: "Main Story" }],
            },
        });

        const findings = await runRule("assets/unused", ctx);

        expect(findings[0].messageKey).toBe("lint.rule.assetsUnused.messageIndexUnreadable");
        expect(findings[0].messageParams).toEqual({ location: "Main Story" });
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

    it("skips model bundles, which are a directory rather than a file to stat", async () => {
        const exists = vi.fn(async () => false);
        const readBytes = vi.fn(async () => null);
        const ctx = createTestLintContext({
            assets: [asset("hiyori", { type: AssetType.Model, name: "Hiyori", ext: undefined })],
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

    it("reports a remote asset that has never been fetched, which has no bytes at all", async () => {
        // The carve-out this replaces existed because a remote asset used to be nothing but a URL.
        // They are pinned now, so a missing snapshot is a genuinely broken asset - and this is how a
        // record written before pinning announces that it needs a refresh.
        const ctx = createTestLintContext({
            assets: [asset("remote", {
                hash: "",
                meta: { url: "https://example.com/bg.png", fetchedAt: "2026-08-05T00:00:00.000Z" },
            })],
            io: {
                exists: async () => false,
                readBytes: async () => null,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: false, reason: "unreadable" }),
            },
        });

        expect(await runRule("assets/unreadable", ctx)).toHaveLength(1);
    });

    it("checks a fetched remote asset like any other, because its snapshot is an ordinary file", async () => {
        const ctx = createTestLintContext({
            assets: [asset("remote", {
                meta: { url: "https://example.com/bg.png", fetchedAt: "2026-08-05T00:00:00.000Z" },
            })],
            io: {
                exists: async () => true,
                readBytes: async () => null,
                probeImage: async (): Promise<LintImageProbe> => ({ ok: true, width: 8, height: 8 }),
            },
        });

        expect(await runRule("assets/unreadable", ctx)).toEqual([]);
    });
});

describe("assets/oversized", () => {
    function runOversized(ctx: LintContext, maxMegabytes = 1): Promise<LintFinding[]> {
        const rule = ASSETS_LINT_RULES.find(entry => entry.id === "assets/oversized")!;
        return Promise.resolve(rule.run(ctx, { maxMegabytes }));
    }

    /** One reference outside the stories, which is what makes the solver call an asset carried. */
    function widgetReference(assetId: string): AssetReference {
        return {
            id: `ui:w1:${assetId}`,
            assetId,
            kind: "uiElement",
            label: "Title art",
            field: "imageFill",
        };
    }

    const big = 4 * 1024 * 1024;

    it("reports a carried file over the declared size", async () => {
        const ctx = createTestLintContext({
            assets: [asset("cover", { meta: { size: big } })],
            assetReferences: new Map([["cover", [widgetReference("cover")]]]),
        });

        const findings = await runOversized(ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsOversized.message");
        expect(findings[0].messageParams).toEqual({ asset: "cover.png", size: "4.0 MB", limit: "1.0 MB" });
        expect(findings[0].target).toEqual({ kind: "asset", assetId: "cover", assetType: AssetType.Image });
    });

    it("says nothing about a file under the declared size", async () => {
        const ctx = createTestLintContext({
            assets: [asset("cover", { meta: { size: 1024 } })],
            assetReferences: new Map([["cover", [widgetReference("cover")]]]),
        });

        expect(await runOversized(ctx)).toEqual([]);
    });

    it("leaves an asset no build carries to assets/unused", async () => {
        const ctx = createTestLintContext({ assets: [asset("cover", { meta: { size: big } })] });

        expect(await runOversized(ctx)).toEqual([]);
    });

    it("says nothing about a record that has never been measured", async () => {
        const ctx = createTestLintContext({
            assets: [asset("cover", { meta: {} })],
            assetReferences: new Map([["cover", [widgetReference("cover")]]]),
        });

        expect(await runOversized(ctx)).toEqual([]);
    });
});

/**
 * `assets/group-incomplete`.
 *
 * Stated as what a set must not be able to hide: a variant nobody imported, a variant two files
 * claim, and an arrangement of axes no build could satisfy.
 */
describe("assets/group-incomplete", () => {
    const runSets = (ctx: LintContext) => runRule("assets/group-incomplete", ctx);

    /** `char:alice` fixed, one build axis over moods and one runtime axis over locales. */
    function aliceSet(overrides: Partial<AssetSet> = {}): AssetSet {
        return {
            id: "set-alice",
            name: "Alice",
            type: AssetType.Image,
            filter: ["char:alice"],
            axes: [
                { key: "mood", residency: "build", values: ["happy", "sad"] },
                { key: "locale", residency: "runtime", values: ["en", "ja"] },
            ],
            ...overrides,
        };
    }

    function tagged(id: string, tags: string[]): LintAssetEntry {
        return asset(id, { tags });
    }

    const fullLibrary = [
        tagged("a", ["char:alice", "mood:happy", "locale:en"]),
        tagged("b", ["char:alice", "mood:happy", "locale:ja"]),
        tagged("c", ["char:alice", "mood:sad", "locale:en"]),
        tagged("d", ["char:alice", "mood:sad", "locale:ja"]),
    ];

    it("says nothing about a project that declares no sets", async () => {
        expect(await runSets(createTestLintContext({ assets: fullLibrary }))).toEqual([]);
    });

    it("says nothing when every variant resolves to one file", async () => {
        const ctx = createTestLintContext({ assets: fullLibrary, assetSets: [aliceSet()] });

        expect(await runSets(ctx)).toEqual([]);
    });

    it("names the variant that has no file, as the tags that would fix it", async () => {
        const ctx = createTestLintContext({
            assets: fullLibrary.slice(0, 3),
            assetSets: [aliceSet()],
        });

        expect(await runSets(ctx)).toEqual([{
            ruleId: "assets/group-incomplete",
            messageKey: "lint.rule.assetsGroupIncomplete.message",
            messageParams: { set: "Alice", variant: "mood:sad · locale:ja" },
            location: { kind: "project" },
        }]);
    });

    it("reports a variant two files claim, which resolves to nothing just as a hole does", async () => {
        const ctx = createTestLintContext({
            assets: [...fullLibrary, tagged("e", ["char:alice", "mood:happy", "locale:en"])],
            assetSets: [aliceSet()],
        });

        expect(await runSets(ctx)).toEqual([{
            ruleId: "assets/group-incomplete",
            messageKey: "lint.rule.assetsGroupIncomplete.messageAmbiguous",
            messageParams: { set: "Alice", variant: "mood:happy · locale:en", count: "2" },
            location: { kind: "project" },
        }]);
    });

    it("never names a file, so a variant a package left out cannot reach a log", async () => {
        const ctx = createTestLintContext({
            assets: fullLibrary.slice(0, 3),
            assetSets: [aliceSet()],
        });

        const params = (await runSets(ctx)).map(finding => JSON.stringify(finding.messageParams));
        expect(params.some(text => text.includes("a.png") || text.includes("\"a\""))).toBe(false);
    });

    it("reports a build axis nested inside a runtime one, naming the outer axis", async () => {
        const ctx = createTestLintContext({
            assets: fullLibrary,
            assetSets: [aliceSet({
                axes: [
                    { key: "locale", residency: "runtime", values: ["en", "ja"] },
                    { key: "mood", residency: "build", values: ["happy", "sad"] },
                ],
            })],
        });

        expect(await runSets(ctx)).toEqual([{
            ruleId: "assets/group-incomplete",
            messageKey: "lint.rule.assetsGroupIncomplete.messageResidency",
            messageParams: { set: "Alice", axis: "mood", outerAxis: "locale" },
            location: { kind: "project" },
        }]);
    });

    it("reports an incoherent set once, instead of a hole for every cell it does not have", async () => {
        const ctx = createTestLintContext({
            assets: fullLibrary,
            assetSets: [aliceSet({ axes: [{ key: "mood", residency: "build", values: [] }] })],
        });

        const findings = await runSets(ctx);
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.assetsGroupIncomplete.messageDeclaration");
    });

    it("holds the fixed filter, so another character's files do not fill a hole", async () => {
        const ctx = createTestLintContext({
            assets: [...fullLibrary.slice(0, 3), tagged("z", ["char:bob", "mood:sad", "locale:ja"])],
            assetSets: [aliceSet()],
        });

        expect(await runSets(ctx)).toHaveLength(1);
    });

    it("ignores a file of another type carrying the right tags", async () => {
        const ctx = createTestLintContext({
            assets: [
                ...fullLibrary.slice(0, 3),
                asset("z", { type: AssetType.Audio, tags: ["char:alice", "mood:sad", "locale:ja"] }),
            ],
            assetSets: [aliceSet()],
        });

        expect(await runSets(ctx)).toHaveLength(1);
    });
});
