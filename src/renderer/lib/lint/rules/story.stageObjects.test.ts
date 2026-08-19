import { describe, expect, it } from "vitest";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryActionPayload,
    type StoryBlock,
    type StoryDocument,
    type StoryScene,
} from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { runLintRules } from "../engine";
import { createTestLintContext } from "../testContext";
import type { LintContext, LintStoryEntry } from "../context";
import type { LintFinding, LintRule, LintRuleId } from "../types";
import { STORY_LINT_RULES } from "./story";

/**
 * The two stage-object rules, and the invariant that matters more than either of them.
 *
 * A row that acts on an object no row creates is reported twice over: by the story compiler while a
 * preview is built, and by this lint, whose verdict is what stops a release. Those two answers come
 * from one judgement in `@shared/types/story/stageObjects` and the last case here is the one that
 * holds them together - it compiles a scene and lints the same scene, and demands the same rows.
 *
 * Without it the two would drift apart silently and in the worst possible way: each surface would
 * look correct on its own, and the only symptom would be a build that refuses what a preview allows.
 */

// --- fixtures ---------------------------------------------------------------

const SCENE_ID = "scene-1";

function actionBlock(id: string, payload: StoryActionPayload, disabled = false): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload,
        ...(disabled ? { disabled: true } : {}),
    } as StoryBlock;
}

function scene(blocks: StoryBlock[]): StoryScene {
    return {
        id: SCENE_ID,
        name: "Opening",
        runtimeName: "Opening",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as StoryScene;
}

function document(blocks: StoryBlock[]): StoryDocument {
    const only = scene(blocks);
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE_ID] }],
        scenes: { [SCENE_ID]: only },
    } as StoryDocument;
}

function storyEntry(blocks: StoryBlock[]): LintStoryEntry {
    return { id: "story-1", name: "Story", document: document(blocks) };
}

function rule(id: LintRuleId): LintRule {
    const found = STORY_LINT_RULES.find(entry => entry.id === id);
    if (!found) {
        throw new Error(`${id} is not registered`);
    }
    return found;
}

async function run(id: LintRuleId, ctx: LintContext): Promise<LintFinding[]> {
    return [...(await rule(id).run(ctx, {}))];
}

/** The rows one rule reported, in the order it reported them. */
async function reportedRows(id: LintRuleId, blocks: StoryBlock[]): Promise<string[]> {
    const findings = await run(id, createTestLintContext({ stories: [storyEntry(blocks)] }));
    return findings.map(finding => (finding.location.kind === "story" ? finding.location.blockId ?? "" : ""));
}

const createImage = (id: string, objectName: string): StoryBlock =>
    actionBlock(id, { action: "image", operation: "create", objectName, assetId: "asset-image" });

// --- story/stage-object-missing ---------------------------------------------

describe("story/stage-object-missing", () => {
    it("is an error, because an image that never appears is as far from the written scene as a row can land", () => {
        expect(rule("story/stage-object-missing").defaultSeverity).toBe("error");
    });

    it("reports a row acting on an object no row creates", async () => {
        const findings = await run(
            "story/stage-object-missing",
            createTestLintContext({
                stories: [storyEntry([actionBlock("show", { action: "image", operation: "show", objectName: "poster" })])],
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.storyStageObjectMissing.message");
        // The author's own word for the object - never the registry key, which for a character or an
        // unnamed sound is an id nobody can search a project for.
        expect(findings[0].messageParams).toEqual({ object: "poster" });
        expect(findings[0].location).toMatchObject({ kind: "story", sceneId: SCENE_ID, blockId: "show" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "show" });
    });

    it("says nothing when a row creates the object", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            createImage("create", "poster"),
            actionBlock("show", { action: "image", operation: "show", objectName: "poster" }),
        ])).toEqual([]);
    });

    it("follows a stable reference through to the row that declares it", async () => {
        // The create row spells the object `bg`; the addressing row still stores the old spelling and
        // binds by `sourceBlockId`. The reference is what resolves, so nothing is reported.
        expect(await reportedRows("story/stage-object-missing", [
            createImage("create", "bg"),
            actionBlock("show", {
                action: "image",
                operation: "show",
                objectName: "poster",
                target: { kind: "image", name: "poster", sourceBlockId: "create" },
            }),
        ])).toEqual([]);
    });

    it("says nothing for a document that carries only objectName, when the name resolves", async () => {
        // Every document written before references binds this way. Falling back to the name is the
        // ordinary path for such a row, not a fault - what is reported is the lookup coming up empty.
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("create", { action: "text", operation: "create", objectName: "sign", text: "Closed" }),
            actionBlock("set", { action: "text", operation: "setText", objectName: "sign", text: "Open" }),
        ])).toEqual([]);
    });

    it("reports a dangling reference whose declaring row is gone", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("show", {
                action: "image",
                operation: "show",
                objectName: "poster",
                target: { kind: "image", name: "poster", label: "poster", sourceBlockId: "deleted-row" },
            }),
        ])).toEqual(["show"]);
    });

    it("never reports the reserved music channel", async () => {
        // The one handle that outlives its scene: a `/bgm` in scene 1 is still playing here, and no
        // single-scene reading can tell that from a row nothing set up.
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("vol", { action: "audio", operation: "setVolume", objectName: "bgm", target: { name: "bgm", builtin: "bgm" }, volume: 0.5 }),
        ])).toEqual([]);
    });

    it("reports every other sound the scene never starts", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("vol", { action: "audio", operation: "setVolume", objectName: "piano", volume: 0.5 }),
        ])).toEqual(["vol"]);
    });

    /**
     * The character half, which used to be exempt by construction: `exit`, `move` and `expression`
     * all counted as putting the portrait on stage, because the compiler built it through
     * get-or-create on those rows too. Only `enter` declares now, on both sides.
     */
    describe("a character", () => {
        const enter = (id: string, characterId: string): StoryBlock =>
            actionBlock(id, { action: "character", operation: "enter", characterId });

        it("counts only the entrance as putting the portrait on stage", async () => {
            expect(await reportedRows("story/stage-object-missing", [
                enter("enter", "char-alice"),
                actionBlock("face", { action: "character", operation: "expression", characterId: "char-alice" }),
                actionBlock("exit", { action: "character", operation: "exit", characterId: "char-alice" }),
            ])).toEqual([]);
        });

        it("reports a row on a character no row in the scene brings on", async () => {
            expect(await reportedRows("story/stage-object-missing", [
                actionBlock("exit", { action: "character", operation: "exit", characterId: "char-alice" }),
            ])).toEqual(["exit"]);
        });

        it("names the character the way the author does, never its id", async () => {
            // The stage key IS the character id when no stage name was typed, so the label has to come
            // off the project's character list - a UUID in a report that stops a build is unusable.
            const findings = await run(
                "story/stage-object-missing",
                createTestLintContext({
                    characters: [{ id: "char-alice", name: "Alice", assetIds: [] }],
                    stories: [storyEntry([actionBlock("exit", { action: "character", operation: "exit", characterId: "char-alice" })])],
                }),
            );
            expect(findings[0].messageParams).toEqual({ object: "Alice" });
            // Nothing creates a character; the remedy an author can act on is bringing it on stage.
            expect(findings[0].messageKey).toBe("lint.rule.storyStageObjectMissing.messageCharacter");
        });

        it("leaves every other kind on the create wording", async () => {
            const findings = await run(
                "story/stage-object-missing",
                createTestLintContext({
                    stories: [storyEntry([actionBlock("show", { action: "image", operation: "show", objectName: "poster" })])],
                }),
            );
            expect(findings[0].messageKey).toBe("lint.rule.storyStageObjectMissing.message");
        });

        it("stays silent on the three runtime-state verbs, which it cannot tell apart", async () => {
            // On a puppet character these address the element and the compiler reports a miss; on a
            // character Studio draws itself they never reach a lookup at all. Which one a row is
            // depends on the character's profile, which is not in the document.
            expect(await reportedRows("story/stage-object-missing", [
                actionBlock("motion", { action: "character", operation: "setMotion", characterId: "char-doll", puppetName: "run" }),
                actionBlock("skin", { action: "character", operation: "setSkin", characterId: "char-doll", puppetName: "winter" }),
                actionBlock("params", { action: "character", operation: "setParams", characterId: "char-doll", params: { ParamAngleX: 1 } }),
            ])).toEqual([]);
        });

        it("says nothing about a speaker rename, which addresses the record and not the stage", async () => {
            expect(await reportedRows("story/stage-object-missing", [
                actionBlock("rename", { action: "character", operation: "setName", characterId: "char-alice", displayName: "Alice" }),
            ])).toEqual([]);
        });

        it("lets a /show find the portrait an entrance registered, because it is an Image too", async () => {
            expect(await reportedRows("story/stage-object-missing", [
                enter("enter", "char-alice"),
                actionBlock("show", {
                    action: "displayable",
                    operation: "show",
                    target: { kind: "character", name: "char-alice", label: "Alice", sourceBlockId: "enter" },
                }),
            ])).toEqual([]);
        });
    });

    it("says nothing about a disabled row, which is authored but not in the runtime", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("show", { action: "image", operation: "show", objectName: "poster" }, true),
        ])).toEqual([]);
    });

    it("does not run at all when the project switches it off", async () => {
        const ctx = createTestLintContext({
            stories: [storyEntry([actionBlock("show", { action: "image", operation: "show", objectName: "poster" })])],
            config: { runOnBuild: true, failBuildOn: "error", severities: { "story/stage-object-missing": "off" }, options: {} },
        });
        const report = await runLintRules(ctx, { rules: [rule("story/stage-object-missing")] });
        expect(report.entries).toEqual([]);
        expect(report.skipped).toEqual(["story/stage-object-missing"]);
    });
});

// --- story/stage-object-duplicate -------------------------------------------

describe("story/stage-object-duplicate", () => {
    it("is a warning, because the object exists and only the author's intent is unsettled", () => {
        expect(rule("story/stage-object-duplicate").defaultSeverity).toBe("warning");
    });

    it("reports the later of two rows creating one name, never the first", async () => {
        const findings = await run(
            "story/stage-object-duplicate",
            createTestLintContext({ stories: [storyEntry([createImage("first", "poster"), createImage("second", "poster")])] }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.storyStageObjectDuplicate.message");
        expect(findings[0].messageParams).toEqual({ object: "poster" });
        expect(findings[0].location).toMatchObject({ blockId: "second" });
    });

    it("says nothing about two objects with different names", async () => {
        expect(await reportedRows("story/stage-object-duplicate", [
            createImage("first", "poster"),
            createImage("second", "sign"),
        ])).toEqual([]);
    });

    it("keeps the kinds apart: an image and a layer may share a word", async () => {
        expect(await reportedRows("story/stage-object-duplicate", [
            createImage("image", "fx"),
            actionBlock("layer", { action: "layer", operation: "create", objectName: "fx" }),
        ])).toEqual([]);
    });

    it("says nothing when a character enters twice, which is what leaving and coming back looks like", async () => {
        expect(await reportedRows("story/stage-object-duplicate", [
            actionBlock("enter", { action: "character", operation: "enter", characterId: "char-1" }),
            actionBlock("exit", { action: "character", operation: "exit", characterId: "char-1" }),
            actionBlock("again", { action: "character", operation: "enter", characterId: "char-1" }),
        ])).toEqual([]);
    });
});

// --- the invariant ----------------------------------------------------------

/**
 * One scene, compiled and linted, asserted to name the same rows.
 *
 * The scene deliberately mixes every arm of the judgement - resolving and dangling, a stable
 * reference and a name-only one, all six kinds a row can address, and the two exemptions - so a
 * change that moves any one of them out of step fails here rather than in a release.
 *
 * Every row is written after the row it depends on, which is what makes the two comparable at all:
 * the compiler walks a scene in order and lint reads it whole, so a forward reference is the one
 * shape where they are meant to differ (lint being the quieter half; see the module note on
 * `stageObjects.ts`).
 */
describe("lint and the story compiler answer as one", () => {
    /** Every stage-object miss the compiler reported, by row. */
    function compilerReportedRows(diagnostics: { level: string; blockId?: string; message: string }[]): string[] {
        return diagnostics
            .filter(diagnostic => diagnostic.level === "error"
                && (diagnostic.message.includes("is not on stage") || diagnostic.message.includes("is not playing")))
            .map(diagnostic => diagnostic.blockId ?? "");
    }

    const blocks: StoryBlock[] = [
        // Declared, then addressed - the ordinary shape, and neither half reports it.
        createImage("image-create", "poster"),
        actionBlock("image-show", { action: "image", operation: "show", objectName: "poster" }),
        // Declared under a new name, addressed through the reference that binds to the declaring row.
        createImage("image-renamed", "bg"),
        actionBlock("image-renamed-show", {
            action: "image",
            operation: "show",
            objectName: "wallpaper",
            target: { kind: "image", name: "wallpaper", sourceBlockId: "image-renamed" },
        }),
        // A character, the most common subject there is: the entrance declares the portrait and the
        // exit addresses it. The asset is on the row so the compile needs no character profile.
        actionBlock("character-enter", { action: "character", operation: "enter", characterId: "char-alice", assetId: "asset-alice" }),
        actionBlock("character-exit", { action: "character", operation: "exit", characterId: "char-alice" }),
        // Seven kinds with nothing behind them.
        actionBlock("character-missing", { action: "character", operation: "exit", characterId: "char-bob" }),
        actionBlock("image-missing", { action: "image", operation: "hide", objectName: "ghost" }),
        actionBlock("text-missing", { action: "text", operation: "setText", objectName: "sign", text: "Open" }),
        actionBlock("layer-missing", { action: "layer", operation: "setZIndex", objectName: "foreground", zIndex: 3 }),
        actionBlock("video-missing", { action: "video", operation: "play", objectName: "intro" }),
        actionBlock("vfx-missing", { action: "vfx", operation: "show", objectName: "snow" }),
        actionBlock("sound-missing", { action: "audio", operation: "setVolume", objectName: "piano", volume: 0.5 }),
        // The two exemptions: the built-in displayable layer, and the reserved music channel.
        actionBlock("layer-default", { action: "layer", operation: "setZIndex", target: { kind: "default", layer: "displayable" }, objectName: "", zIndex: 1 }),
        actionBlock("bgm-volume", { action: "audio", operation: "setVolume", objectName: "bgm", target: { name: "bgm", builtin: "bgm" }, volume: 0.5 }),
        // Authored but switched off, so it is in neither reading.
        actionBlock("image-disabled", { action: "image", operation: "show", objectName: "nowhere" }, true),
    ];

    const expectedRows = [
        "character-missing",
        "image-missing",
        "text-missing",
        "layer-missing",
        "video-missing",
        "vfx-missing",
        "sound-missing",
    ];

    it("names the same rows from a compile and from a sweep", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document(blocks),
            sceneId: SCENE_ID,
            resolveAssetUrl: async (assetId: string) => `nlr://${assetId}`,
        } as Parameters<typeof compileStudioStoryToNlr>[0]);

        const fromCompiler = compilerReportedRows(compiled.diagnostics);
        const fromLint = await reportedRows("story/stage-object-missing", blocks);

        expect([...fromCompiler].sort()).toEqual([...expectedRows].sort());
        expect([...fromLint].sort()).toEqual([...fromCompiler].sort());
    });

    /**
     * The one shape where they are meant to differ, asserted in the direction that is safe.
     *
     * A row written above the row it depends on misses the compiler's in-order walk and passes lint's
     * whole-scene reading. Lint has to be the quieter half: a build refused for something a preview
     * plays correctly is a fault nobody can act on, while the reverse is a diagnostic in the console
     * with the row still there to fix.
     */
    it("leaves a forward reference to the compiler alone", async () => {
        const forward: StoryBlock[] = [
            actionBlock("face-early", { action: "character", operation: "expression", characterId: "char-alice" }),
            actionBlock("enter", { action: "character", operation: "enter", characterId: "char-alice", assetId: "asset-alice" }),
        ];

        const compiled = await compileStudioStoryToNlr({
            document: document(forward),
            sceneId: SCENE_ID,
            resolveAssetUrl: async (assetId: string) => `nlr://${assetId}`,
        } as Parameters<typeof compileStudioStoryToNlr>[0]);

        expect(compilerReportedRows(compiled.diagnostics)).toEqual(["face-early"]);
        expect(await reportedRows("story/stage-object-missing", forward)).toEqual([]);
    });
});
