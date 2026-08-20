import { GAME_BUILD_FORMATS_BY_PLATFORM, type GameBuildPlatform } from "@shared/types/gameBuild";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument, type StoryScene } from "@shared/types/story";
import { describe, expect, it, vi } from "vitest";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import type { LintAlphaProbe, LintAssetEntry, LintContext, LintStoryEntry } from "../context";
import { createTestLintContext } from "../testContext";
import type { LintFinding, LintRuleId } from "../types";
import { PORTABILITY_LINT_RULES } from "./portability";

/**
 * The `portability` rules. Most of them are as much about what they must stay quiet on as what they
 * report: a Chinese file name is not a portability problem, and a project that has never declared a
 * build target has not asked about codecs.
 *
 * `portability/vfx-alpha` carries that burden further than the rest, because it is the only rule
 * here that spawns a process to answer. Every narrowing it makes has a test that would fail if the
 * narrowing were dropped - not because the finding would be wrong, but because the probe would run
 * on a project that had no question.
 */

function runRule(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    const rule = PORTABILITY_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    return Promise.resolve(rule.run(ctx, {}));
}

function asset(id: string, name: string, overrides: Partial<LintAssetEntry> = {}): LintAssetEntry {
    return { id, type: AssetType.Image, name, ext: "png", meta: {}, tags: [], ...overrides };
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

    /**
     * Taken from the shared table for the same reason the rule takes it from there: "every platform"
     * has to keep meaning every platform after the union grows, or the exhaustiveness these tests
     * claim to check quietly becomes a check of six hard-coded names.
     */
    const EVERY_PLATFORM = Object.keys(GAME_BUILD_FORMATS_BY_PLATFORM) as GameBuildPlatform[];

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
            assets: [asset("bgm", "theme.ogg", { type: AssetType.Audio, ext: "ogg" })],
            buildPlatforms: ["windows", "web", "ios", "android"],
        });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ asset: "theme.ogg", platform: "web, ios" });
    });

    it("covers every Ogg audio spelling, on the Safari-engine targets and nowhere else", async () => {
        const oggAudio = [
            asset("a1", "theme.ogg", { type: AssetType.Audio, ext: "ogg" }),
            asset("a2", "voice.oga", { type: AssetType.Audio, ext: "oga" }),
            asset("a3", "sting.opus", { type: AssetType.Audio, ext: "opus" }),
        ];

        const safari = await runRule(
            "portability/media-format",
            createTestLintContext({ assets: oggAudio, buildPlatforms: ["web", "ios"] }),
        );

        expect(safari.map(entry => entry.messageParams)).toEqual([
            { asset: "theme.ogg", platform: "web, ios" },
            { asset: "voice.oga", platform: "web, ios" },
            { asset: "sting.opus", platform: "web, ios" },
        ]);

        // Every Chromium target demuxes Ogg; only the 18.4 container gap is being reported.
        const chromium = await runRule(
            "portability/media-format",
            createTestLintContext({ assets: oggAudio, buildPlatforms: ["windows", "macos", "linux", "android"] }),
        );

        expect(chromium).toEqual([]);
    });

    it("flags Ogg video on every build target, Chromium ones included", async () => {
        const reported: Record<string, string | undefined> = {};
        for (const platform of EVERY_PLATFORM) {
            const findings = await runRule(
                "portability/media-format",
                createTestLintContext({
                    assets: [asset("v1", "cut.ogv", { type: AssetType.Video, ext: "ogv" })],
                    buildPlatforms: [platform],
                }),
            );
            reported[platform] = findings[0]?.messageParams?.platform as string | undefined;
        }

        expect(reported).toEqual(Object.fromEntries(EVERY_PLATFORM.map(platform => [platform, platform])));
    });

    it("treats .ogm and .ogx as the same container as .ogv", async () => {
        const ctx = createTestLintContext({
            assets: [
                asset("v2", "cut2.ogm", { type: AssetType.Video, ext: "ogm" }),
                asset("v3", "cut3.ogx", { type: AssetType.Video, ext: "ogx" }),
            ],
            buildPlatforms: EVERY_PLATFORM,
        });

        const findings = await runRule("portability/media-format", ctx);

        expect(findings.map(entry => entry.messageParams)).toEqual([
            { asset: "cut2.ogm", platform: EVERY_PLATFORM.join(", ") },
            { asset: "cut3.ogx", platform: EVERY_PLATFORM.join(", ") },
        ]);
    });

    it("says nothing about WebM: Safari 17.4 plays it everywhere, and 17.4 is the floor", async () => {
        const ctx = createTestLintContext({
            assets: [
                asset("clip", "intro.webm", { type: AssetType.Video, ext: "webm" }),
                asset("loop", "loop.weba", { type: AssetType.Audio, ext: "weba" }),
            ],
            buildPlatforms: EVERY_PLATFORM,
        });

        expect(await runRule("portability/media-format", ctx)).toEqual([]);
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


/* ---------------------------------------------------------------------------------------------- */
/* portability/vfx-alpha                                                                            */
/* ---------------------------------------------------------------------------------------------- */

type VfxRow = {
    id: string;
    assetId?: string;
    seed?: { seed: string };
    blendMode?: string;
    operation?: string;
    disabled?: boolean;
};

/** One scene of `/vfx` rows, wired the way the document stores them. */
function vfxStory(rows: readonly VfxRow[]): LintStoryEntry {
    const blocks: Record<string, unknown> = {};
    for (const row of rows) {
        blocks[row.id] = {
            id: row.id,
            kind: "action",
            parentId: null,
            childrenIds: [],
            ...(row.disabled ? { disabled: true } : {}),
            payload: {
                action: "vfx",
                operation: row.operation ?? "create",
                objectName: row.id,
                ...(row.assetId ? { assetId: row.assetId } : {}),
                ...(row.seed ? { seed: row.seed } : {}),
                ...(row.blendMode ? { blendMode: row.blendMode } : {}),
            },
        };
    }
    const scene = {
        id: "scene-1",
        name: "Rooftop",
        runtimeName: "Rooftop",
        rootBlockIds: rows.map(row => row.id),
        blocks,
    } as unknown as StoryScene;
    const document = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Chapter 1",
        chapters: [],
        scenes: { [scene.id]: scene },
    } as StoryDocument;
    return { id: "story-1", name: "Chapter 1", document };
}

const petals = (id = "petals"): LintAssetEntry =>
    asset(id, "petals.webm", { type: AssetType.Video, ext: "webm" });

/** A context whose probe answers `carriesAlpha` for every clip, with the call count exposed. */
function alphaContext(
    rows: readonly VfxRow[],
    options: {
        carriesAlpha?: boolean;
        buildPlatforms?: GameBuildPlatform[];
        assets?: LintAssetEntry[];
        probe?: (assetId: string) => Promise<LintAlphaProbe>;
    } = {},
) {
    const probeVideoAlpha = vi.fn(
        options.probe
            ?? (async (): Promise<LintAlphaProbe> => ({ ok: true, carriesAlpha: options.carriesAlpha ?? true })),
    );
    const ctx = createTestLintContext({
        stories: [vfxStory(rows)],
        assets: options.assets ?? [petals()],
        buildPlatforms: options.buildPlatforms ?? ["ios"],
        io: {
            exists: async () => true,
            readBytes: async () => null,
            probeImage: async () => ({ ok: false, reason: "not asked" }),
            probeVideoAlpha,
        },
    });
    return { ctx, probeVideoAlpha };
}

describe("portability/vfx-alpha", () => {
    it("reports an alpha clip on a row that composites normally, and points at the row", async () => {
        const { ctx } = alphaContext([{ id: "row-1", assetId: "petals" }]);

        const findings = await runRule("portability/vfx-alpha", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.portabilityVfxAlpha.message");
        expect(findings[0].messageParams).toEqual({ asset: "petals.webm", platform: "ios" });
        // The row, not the asset: the same clip on `screen` is correct, so the file alone is not
        // the finding and the author's repair is on this line.
        expect(findings[0].location).toMatchObject({ kind: "story", storyId: "story-1", blockId: "row-1" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "row-1" });
    });

    it("treats an absent blend mode as `normal`, which is what the inspector shows", async () => {
        const { ctx } = alphaContext([{ id: "row-1", assetId: "petals" }]);

        expect(await runRule("portability/vfx-alpha", ctx)).toHaveLength(1);
    });

    it("names every affected target at once rather than one finding per target", async () => {
        const { ctx } = alphaContext([{ id: "row-1", assetId: "petals" }], {
            buildPlatforms: ["windows", "ios", "web"],
        });

        const findings = await runRule("portability/vfx-alpha", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams?.platform).toBe("ios, web");
    });

    it("stays silent, and never probes, when no WebKit target is selected", async () => {
        const { ctx, probeVideoAlpha } = alphaContext([{ id: "row-1", assetId: "petals" }], {
            buildPlatforms: ["windows", "macos", "linux", "android"],
        });

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
        expect(probeVideoAlpha).not.toHaveBeenCalled();
    });

    it("stays silent, and never probes, when the project has declared no build target at all", async () => {
        const { ctx, probeVideoAlpha } = alphaContext([{ id: "row-1", assetId: "petals" }], {
            buildPlatforms: [],
        });

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
        expect(probeVideoAlpha).not.toHaveBeenCalled();
    });

    it("stays silent on a row that names its material route", async () => {
        for (const blendMode of ["screen", "multiply", "lighten"]) {
            const { ctx, probeVideoAlpha } = alphaContext([{ id: "row-1", assetId: "petals", blendMode }]);

            expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
            expect(probeVideoAlpha).not.toHaveBeenCalled();
        }
    });

    it("stays silent, and never probes, on a seeded overlay", async () => {
        // The weather bake has no alpha channel by construction; probing one would spawn a process
        // to re-confirm something this repository decided.
        const { ctx, probeVideoAlpha } = alphaContext([{ id: "row-1", seed: { seed: "snow" } }]);

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
        expect(probeVideoAlpha).not.toHaveBeenCalled();
    });

    it("stays silent on a clip with no alpha channel", async () => {
        const { ctx } = alphaContext([{ id: "row-1", assetId: "petals" }], { carriesAlpha: false });

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
    });

    it("stays silent when the probe never answered", async () => {
        // No ffprobe on this host is the common way this happens, and it is not evidence about the
        // file. A rule that reported here would fail builds on a machine that merely lacks a tool.
        const { ctx } = alphaContext([{ id: "row-1", assetId: "petals" }], {
            probe: async () => ({ ok: false, reason: "no probe on this host" }),
        });

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
    });

    it("ignores a disabled row and the later verbs that address the overlay", async () => {
        const { ctx, probeVideoAlpha } = alphaContext([
            { id: "row-1", assetId: "petals", disabled: true },
            { id: "row-2", assetId: "petals", operation: "show" },
            { id: "row-3", assetId: "petals", operation: "hide" },
        ]);

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
        expect(probeVideoAlpha).not.toHaveBeenCalled();
    });

    it("ignores a row whose clip is not in the library, which `assets/missing` already reports", async () => {
        const { ctx, probeVideoAlpha } = alphaContext([{ id: "row-1", assetId: "gone" }]);

        expect(await runRule("portability/vfx-alpha", ctx)).toEqual([]);
        expect(probeVideoAlpha).not.toHaveBeenCalled();
    });

    it("probes each clip once however many rows use it", async () => {
        const { ctx, probeVideoAlpha } = alphaContext([
            { id: "row-1", assetId: "petals" },
            { id: "row-2", assetId: "petals" },
            { id: "row-3", assetId: "petals" },
        ]);

        expect(await runRule("portability/vfx-alpha", ctx)).toHaveLength(3);
        expect(probeVideoAlpha).toHaveBeenCalledTimes(1);
    });
});
