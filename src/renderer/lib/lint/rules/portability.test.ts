import { describe, expect, it } from "vitest";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import type { LintAssetEntry, LintContext } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintFinding, LintRuleId } from "../types";
import { PORTABILITY_LINT_RULES } from "./portability";

/**
 * The `portability` rules. Two of the three are as much about what they must stay quiet on as what
 * they report: a Chinese file name is not a portability problem, and a project that has never
 * declared a build target has not asked about codecs.
 */

function runRule(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = PORTABILITY_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return Promise.resolve(rule.run(ctx, {}));
}

function asset(id: string, name: string, overrides: Partial<LintAssetEntry> = {}): LintAssetEntry {
    return { id, type: AssetType.Image, name, ext: "png", meta: {}, ...overrides };
}

async function flaggedNames(assets: readonly LintAssetEntry[]): Promise<string[]> {
    const findings = await runRule("portability/asset-name", createTestLintContext({ assets }));
    return findings.map(finding => String(finding.messageParams?.asset));
}

describe("portability/asset-name", () => {
    it("flags a reserved DOS device name even with an extension", async () => {
        expect(await flaggedNames([asset("a", "CON.png"), asset("b", "nul.png"), asset("c", "com1.png")])).toEqual([
            "CON.png",
            "nul.png",
            "com1.png",
        ]);
    });

    it("flags trailing whitespace and a trailing dot", async () => {
        const assets = [
            asset("a", "trailing ", { ext: undefined }),
            asset("b", "trailing.", { ext: undefined }),
            asset("c", " leading", { ext: undefined }),
        ];

        expect(await flaggedNames(assets)).toEqual(["trailing ", "trailing.", " leading"]);
    });

    it("flags characters Windows refuses", async () => {
        const assets = [
            asset("a", "who?.png"),
            asset("b", "a:b.png"),
            asset("c", "star*.png"),
            asset("d", "pipe|.png"),
            asset("e", 'quote".png'),
            asset("f", "angle<>.png"),
            asset("g", "tab\tname.png"),
        ];

        expect(await flaggedNames(assets)).toHaveLength(assets.length);
    });

    it("does not flag a non-ASCII name", async () => {
        const assets = [asset("a", "角色立绘.png"), asset("b", "bg_room-01.png"), asset("c", "Ártemis.png")];

        expect(await flaggedNames(assets)).toEqual([]);
    });

    it("locates the finding on the asset", async () => {
        const findings = await runRule(
            "portability/asset-name",
            createTestLintContext({ assets: [asset("a", "CON.png")] }),
        );

        expect(findings[0].messageKey).toBe("lint.rule.portabilityAssetName.message");
        expect(findings[0].location).toEqual({ kind: "asset", assetId: "a", assetName: "CON.png" });
        expect(findings[0].target).toEqual({ kind: "asset", assetId: "a", assetType: AssetType.Image });
    });
});

describe("portability/case-collision", () => {
    it("flags names differing only by case, once per member past the first", async () => {
        const ctx = createTestLintContext({ assets: [asset("a", "Bg.png"), asset("b", "bg.png")] });

        const findings = await runRule("portability/case-collision", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.portabilityCaseCollision.message");
        expect(findings[0].messageParams).toEqual({ asset: "bg.png", other: "Bg.png" });
        expect(findings[0].location).toEqual({ kind: "asset", assetId: "b", assetName: "bg.png" });
    });

    it("names the first member as the incumbent for every later one", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a", "Bg.png"), asset("b", "bg.png"), asset("c", "BG.png")],
        });

        const findings = await runRule("portability/case-collision", ctx);

        expect(findings).toHaveLength(2);
        expect(findings.map(finding => finding.messageParams?.asset)).toEqual(["bg.png", "BG.png"]);
        expect(new Set(findings.map(finding => finding.messageParams?.other))).toEqual(new Set(["Bg.png"]));
    });

    it("stays silent for names that differ by more than case", async () => {
        const ctx = createTestLintContext({
            assets: [asset("a", "bg.png"), asset("b", "bg2.png"), asset("c", "bg.jpg", { ext: "jpg" })],
        });

        expect(await runRule("portability/case-collision", ctx)).toEqual([]);
    });
});

describe("portability/media-format", () => {
    const oggAssets = [asset("bgm", "theme.ogg", { type: AssetType.Audio, ext: "ogg" })];

    it("says nothing when the project has never declared a build target", async () => {
        const ctx = createTestLintContext({ assets: oggAssets, buildPlatforms: [] });

        expect(await runRule("portability/media-format", ctx)).toEqual([]);
    });

    it("fires for a platform the project actually builds for", async () => {
        const ctx = createTestLintContext({ assets: oggAssets, buildPlatforms: ["ios"] });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.portabilityMediaFormat.message");
        expect(findings[0].messageParams).toEqual({ asset: "theme.ogg", platform: "ios" });
        expect(findings[0].location).toEqual({ kind: "asset", assetId: "bgm", assetName: "theme.ogg" });
    });

    it("stays silent for a windows-only project", async () => {
        const ctx = createTestLintContext({ assets: oggAssets, buildPlatforms: ["windows"] });

        expect(await runRule("portability/media-format", ctx)).toEqual([]);
    });

    it("lists only the selected platforms that cannot play it", async () => {
        const ctx = createTestLintContext({
            assets: [asset("clip", "intro.webm", { type: AssetType.Video, ext: "webm" })],
            buildPlatforms: ["windows", "web", "ios", "android"],
        });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ asset: "intro.webm", platform: "web, ios" });
    });

    it("covers every Ogg and WebM spelling, audio-only ones included", async () => {
        const ctx = createTestLintContext({
            assets: [
                asset("a1", "voice.oga", { type: AssetType.Audio, ext: "oga" }),
                asset("a2", "sting.opus", { type: AssetType.Audio, ext: "opus" }),
                asset("a3", "loop.weba", { type: AssetType.Audio, ext: "weba" }),
                asset("v1", "cut.ogv", { type: AssetType.Video, ext: "ogv" }),
                asset("v2", "cut2.ogm", { type: AssetType.Video, ext: "ogm" }),
                asset("v3", "cut3.ogx", { type: AssetType.Video, ext: "ogx" }),
            ],
            buildPlatforms: ["web", "ios"],
        });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings.map(entry => entry.messageParams)).toEqual([
            { asset: "voice.oga", platform: "web, ios" },
            { asset: "sting.opus", platform: "web, ios" },
            { asset: "loop.weba", platform: "web, ios" },
            { asset: "cut.ogv", platform: "web, ios" },
            { asset: "cut2.ogm", platform: "web, ios" },
            { asset: "cut3.ogx", platform: "web, ios" },
        ]);
    });

    it("stays silent for a container every target plays", async () => {
        const ctx = createTestLintContext({
            assets: [
                asset("bgm", "theme.mp3", { type: AssetType.Audio, ext: "mp3" }),
                asset("clip", "intro.mp4", { type: AssetType.Video, ext: "mp4" }),
            ],
            buildPlatforms: ["web", "ios"],
        });

        expect(await runRule("portability/media-format", ctx)).toEqual([]);
    });

    it("only judges media assets", async () => {
        const ctx = createTestLintContext({
            // An SVG font could be named `.ogg` and still not be something anyone plays.
            assets: [asset("odd", "notes.ogg", { type: AssetType.Other, ext: "ogg" })],
            buildPlatforms: ["web", "ios"],
        });

        expect(await runRule("portability/media-format", ctx)).toEqual([]);
    });

    it("falls back to the name when the record carries no extension", async () => {
        const ctx = createTestLintContext({
            assets: [asset("bgm", "theme.OGG", { type: AssetType.Audio, ext: undefined })],
            buildPlatforms: ["web"],
        });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ asset: "theme.OGG", platform: "web" });
    });
});
