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
 *
 * `story/character-missing` is covered here too. It reads the same character rows and asks the one
 * question the two above take for granted - whether the id on the row still names a character the
 * project has - so the fixtures are the same fixtures.
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

/**
 * A dialogue row, optionally carrying reveal-time expression tokens.
 *
 * Two token slots rather than a list, because the only thing any test here asks of a second one is
 * that a row with two unresolved references is still one finding.
 */
function dialogueBlock(
    id: string,
    options: { characterId?: string; speakerName?: string; event?: { characterId: string }; secondEvent?: { characterId: string } },
): StoryBlock {
    const rich = [
        { text: "Hello" },
        ...(options.event ? [{ event: { expression: options.event } }] : []),
        ...(options.secondEvent ? [{ event: { expression: options.secondEvent } }] : []),
    ];
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            ...(options.characterId ? { characterId: options.characterId } : {}),
            ...(options.speakerName ? { speakerName: options.speakerName } : {}),
            text: { textId: `text-${id}`, value: "Hello", role: "dialogue", rich },
        },
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

    /**
     * A `show` row naming its own source is a declaration, so it is not a reference at all - and the
     * object it leaves behind answers every later row. The rule that made this worth writing down is
     * the one directly above it: a `show` with a name and no source is still a dangling reference, so
     * the source is the whole of the difference.
     */
    it("treats a show row that names its own source as the row that creates it", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("show", { action: "image", operation: "show", objectName: "sunset", assetId: "asset-sunset" }),
            actionBlock("hide", { action: "image", operation: "hide", objectName: "sunset" }),
        ])).toEqual([]);
    });

    it("treats a play row as the row that creates its clip", async () => {
        // A play is the one row a clip comes on with: a scene whose first row plays a clip out of the
        // library needs nothing above it, and the rows after it find the clip it defined.
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("play", { action: "video", operation: "play", objectName: "festival", assetId: "asset-festival" }),
            actionBlock("pause", { action: "video", operation: "pause", objectName: "festival" }),
            actionBlock("stop", { action: "video", operation: "stop", objectName: "festival" }),
            actionBlock("hide", { action: "video", operation: "hide", objectName: "festival" }),
        ])).toEqual([]);
    });

    it("reports a row naming a clip no play in the scene defines", async () => {
        expect(await reportedRows("story/stage-object-missing", [
            actionBlock("pause", { action: "video", operation: "pause", objectName: "festival" }),
        ])).toEqual(["pause"]);
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

// --- story/declared-never-shown ---------------------------------------------

describe("story/declared-never-shown", () => {
    it("is a warning, because a half-written scene is full of declarations not shown yet", () => {
        expect(rule("story/declared-never-shown").defaultSeverity).toBe("warning");
    });

    it("reports a create row nothing ever shows", async () => {
        const findings = await run(
            "story/declared-never-shown",
            createTestLintContext({ stories: [storyEntry([createImage("create", "poster")])] }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ object: "poster" });
        expect(findings[0].location).toMatchObject({ kind: "story", sceneId: SCENE_ID, blockId: "create" });
    });

    it("says nothing once a row shows it", async () => {
        expect(await reportedRows("story/declared-never-shown", [
            createImage("create", "poster"),
            actionBlock("show", { action: "image", operation: "show", objectName: "poster" }),
        ])).toEqual([]);
    });

    it("says nothing about a show row that names its own source", async () => {
        // The one-row form declares and reveals together, so there is no later row for it to be
        // waiting on - reporting it would put a warning on every `/show <asset>` in a project.
        expect(await reportedRows("story/declared-never-shown", [
            actionBlock("show", { action: "image", operation: "show", objectName: "sunset", assetId: "asset-sunset" }),
        ])).toEqual([]);
    });

    it("says nothing about a play row, which reveals its clip itself", async () => {
        expect(await reportedRows("story/declared-never-shown", [
            actionBlock("play", { action: "video", operation: "play", objectName: "festival", assetId: "asset-festival" }),
        ])).toEqual([]);
    });

    it("leaves a layer alone, since a layer is visible the moment it exists", async () => {
        expect(await reportedRows("story/declared-never-shown", [
            actionBlock("layer", { action: "layer", operation: "create", objectName: "foreground" }),
        ])).toEqual([]);
    });

    it("reads an ambience overlay across the whole story, not one scene", async () => {
        // An overlay is game-level: rain declared in a prologue and shown two scenes later is the
        // ordinary way to write one, and reporting it would make the rule wrong exactly where the
        // feature is used properly.
        const declare = actionBlock("declare", { action: "vfx", operation: "create", objectName: "rain", assetId: "asset-rain" });
        const reveal = actionBlock("reveal", { action: "vfx", operation: "show", objectName: "rain" });
        const entry: LintStoryEntry = {
            id: "story-1",
            name: "Story",
            document: {
                schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
                id: "story-1",
                name: "Story",
                chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE_ID, "scene-2"] }],
                scenes: {
                    [SCENE_ID]: scene([declare]),
                    "scene-2": {
                        id: "scene-2",
                        name: "Later",
                        runtimeName: "Later",
                        rootBlockIds: ["reveal"],
                        blocks: { reveal },
                    } as StoryScene,
                },
            } as StoryDocument,
        };

        const findings = await run("story/declared-never-shown", createTestLintContext({ stories: [entry] }));
        expect(findings).toEqual([]);
    });
});

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

    it("reports a play naming a different file under a name an earlier play already defined", async () => {
        // The first play stands and the later ones run its clip, so the file a later row picked is
        // the part that goes nowhere.
        expect(await reportedRows("story/stage-object-duplicate", [
            actionBlock("first", { action: "video", operation: "play", objectName: "festival", assetId: "asset-a" }),
            actionBlock("second", { action: "video", operation: "play", objectName: "festival", assetId: "asset-b" }),
            actionBlock("third", { action: "video", operation: "play", objectName: "festival", assetId: "asset-c" }),
        ])).toEqual(["second", "third"]);
    });

    it("says nothing about a play of the same file again, which is how a clip is played twice", async () => {
        expect(await reportedRows("story/stage-object-duplicate", [
            actionBlock("first", { action: "video", operation: "play", objectName: "festival", assetId: "asset-a" }),
            actionBlock("again", { action: "video", operation: "play", objectName: "festival", assetId: "asset-a" }),
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

// --- story/video-control-after-end ------------------------------------------

describe("story/video-control-after-end", () => {
    const play = (id: string, waitForEnd?: boolean): StoryBlock =>
        actionBlock(id, { action: "video", operation: "play", objectName: "festival", assetId: "asset-festival", ...(waitForEnd === undefined ? {} : { waitForEnd }) });
    const control = (id: string, operation: "pause" | "resume" | "seek" | "stop" | "hide"): StoryBlock =>
        actionBlock(id, { action: "video", operation, objectName: "festival", ...(operation === "seek" ? { timeMs: 1000 } : {}) });
    const group = (id: string, control: "parallel" | "sequence" | "race" | "repeat", children: StoryBlock[]): StoryBlock[] => [
        { id, kind: "control", parentId: null, childrenIds: children.map(child => child.id), payload: { control } } as StoryBlock,
        ...children.map(child => ({ ...child, parentId: id }) as StoryBlock),
    ];
    /** A scene whose top level is `top`, with `nested` filed under the groups that name them. */
    async function reportedIn(top: StoryBlock[], nested: StoryBlock[] = []): Promise<string[]> {
        const all = [...top, ...nested];
        const entry: LintStoryEntry = {
            id: "story-1",
            name: "Story",
            document: {
                ...document(all),
                scenes: { [SCENE_ID]: { ...scene(all), rootBlockIds: top.map(block => block.id) } },
            } as StoryDocument,
        };
        const findings = await run("story/video-control-after-end", createTestLintContext({ stories: [entry] }));
        return findings.map(finding => (finding.location.kind === "story" ? finding.location.blockId ?? "" : ""));
    }

    it("is a warning", () => {
        expect(rule("story/video-control-after-end").defaultSeverity).toBe("warning");
    });

    it("reports every control row after a play that waits, and none after one that does not", async () => {
        expect(await reportedIn([
            play("waits"),
            control("pause", "pause"),
            control("resume", "resume"),
            control("seek", "seek"),
            control("stop", "stop"),
            control("hide", "hide"),
        ])).toEqual(["pause", "resume", "seek", "stop"]);
        expect(await reportedIn([play("moves-on", false), control("pause", "pause"), control("stop", "stop")])).toEqual([]);
    });

    it("goes by the latest play of the clip", async () => {
        expect(await reportedIn([play("waits"), play("moves-on", false), control("stop", "stop")])).toEqual([]);
        expect(await reportedIn([play("moves-on", false), play("waits"), control("stop", "stop")])).toEqual(["stop"]);
    });

    it("says nothing inside a parallel group, where the rows run side by side", async () => {
        const [parallel, ...children] = group("parallel", "parallel", [play("waits"), control("stop", "stop")]);
        expect(await reportedIn([parallel], children)).toEqual([]);
    });

    it("still reports inside a sequence, which runs its rows in order", async () => {
        const [sequence, ...children] = group("sequence", "sequence", [play("waits"), control("stop", "stop")]);
        expect(await reportedIn([sequence], children)).toEqual(["stop"]);
    });

    it("says nothing when a group between the two rows could play the clip again", async () => {
        const [parallel, ...children] = group("parallel", "parallel", [play("moves-on", false)]);
        expect(await reportedIn([play("waits"), parallel, control("stop", "stop")], children)).toEqual([]);
    });

    it("says nothing across a label, which a goto may reach without passing the play", async () => {
        const label = { id: "label", kind: "control", parentId: null, childrenIds: [], payload: { control: "label", name: "again" } } as StoryBlock;
        expect(await reportedIn([play("waits"), label, control("stop", "stop")])).toEqual([]);
    });
});

// --- story/character-missing ------------------------------------------------

describe("story/character-missing", () => {
    /** A project with exactly one character, so an id other than this one resolves to nothing. */
    const characters = [{ id: "char-alice", name: "Alice", assetIds: [] }];

    /** The rows the rule reported, read against that project. */
    async function reported(blocks: StoryBlock[]): Promise<string[]> {
        const findings = await run(
            "story/character-missing",
            createTestLintContext({ characters, stories: [storyEntry(blocks)] }),
        );
        return findings.map(finding => (finding.location.kind === "story" ? finding.location.blockId ?? "" : ""));
    }

    it("is an error, because every remaining reading of the row is a wrong one", () => {
        expect(rule("story/character-missing").defaultSeverity).toBe("error");
    });

    it("reports a character row naming an id no character in the project has", async () => {
        const findings = await run(
            "story/character-missing",
            createTestLintContext({
                characters,
                stories: [storyEntry([actionBlock("enter", { action: "character", operation: "enter", characterId: "char-bob" })])],
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.storyCharacterMissing.message");
        // The stored id is a UUID, so it is in neither the sentence nor its parameters; the jump to
        // the row is what the author acts on.
        expect(findings[0].messageParams).toBeUndefined();
        expect(findings[0].location).toMatchObject({ kind: "story", sceneId: SCENE_ID, blockId: "enter" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "enter" });
    });

    it("says nothing when the same row names a character the project has", async () => {
        expect(await reported([
            actionBlock("enter", { action: "character", operation: "enter", characterId: "char-alice" }),
        ])).toEqual([]);
    });

    it("reports every operation a character row can carry", async () => {
        // Including the three the stage rules stay silent on and the speaker rename, which touches no
        // portrait at all: whichever operation the row carries, the character it names is not there.
        expect(await reported([
            actionBlock("enter", { action: "character", operation: "enter", characterId: "char-bob" }),
            actionBlock("move", { action: "character", operation: "move", characterId: "char-bob" }),
            actionBlock("face", { action: "character", operation: "expression", characterId: "char-bob" }),
            actionBlock("exit", { action: "character", operation: "exit", characterId: "char-bob" }),
            actionBlock("rename", { action: "character", operation: "setName", characterId: "char-bob", displayName: "Bob" }),
            actionBlock("motion", { action: "character", operation: "setMotion", characterId: "char-bob", puppetName: "run" }),
            actionBlock("skin", { action: "character", operation: "setSkin", characterId: "char-bob", puppetName: "winter" }),
            actionBlock("params", { action: "character", operation: "setParams", characterId: "char-bob", params: { ParamAngleX: 1 } }),
        ])).toEqual(["enter", "move", "face", "exit", "rename", "motion", "skin", "params"]);
    });

    it("says nothing about a row that names no character at all", async () => {
        // A stage object addressed by name is an ordinary row; there is no reference to resolve.
        expect(await reported([
            actionBlock("exit", { action: "character", operation: "exit", objectName: "Alice" }),
        ])).toEqual([]);
    });

    it("leaves a dialogue speaker alone, resolving or not", async () => {
        // A speaker with no character record is a shippable line rather than a defect: the dialogue
        // box displays whatever name it is given, so an unresolved id degrades to `speakerName`.
        expect(await reported([
            dialogueBlock("named", { characterId: "char-bob", speakerName: "Bob" }),
            dialogueBlock("bare", { characterId: "char-bob" }),
        ])).toEqual([]);
    });

    it("reports an inline expression event naming a character the project does not have", async () => {
        // The reveal-time portrait switch stores an id on its own and has no bare-name arm, so an
        // id that resolves to nothing is a swap that never happens.
        expect(await reported([
            dialogueBlock("line", { characterId: "char-alice", event: { characterId: "char-bob" } }),
        ])).toEqual(["line"]);
    });

    it("says nothing about an inline expression event whose character resolves", async () => {
        expect(await reported([
            dialogueBlock("line", { characterId: "char-alice", event: { characterId: "char-alice" } }),
        ])).toEqual([]);
    });

    it("reports a row once however many references it carries", async () => {
        const findings = await run(
            "story/character-missing",
            createTestLintContext({
                characters,
                stories: [storyEntry([
                    dialogueBlock("line", { event: { characterId: "char-bob" }, secondEvent: { characterId: "char-carol" } }),
                ])],
            }),
        );
        expect(findings).toHaveLength(1);
    });

    it("says nothing about a disabled row, which is authored but not in the runtime", async () => {
        expect(await reported([
            actionBlock("enter", { action: "character", operation: "enter", characterId: "char-bob" }, true),
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
        // A clip that one row plays out of the library, and a later row stops.
        actionBlock("video-play-own", { action: "video", operation: "play", objectName: "festival", assetId: "asset-festival" }),
        actionBlock("video-stop", { action: "video", operation: "stop", objectName: "festival" }),
        // Seven kinds with nothing behind them.
        actionBlock("character-missing", { action: "character", operation: "exit", characterId: "char-bob" }),
        actionBlock("image-missing", { action: "image", operation: "hide", objectName: "ghost" }),
        actionBlock("text-missing", { action: "text", operation: "setText", objectName: "sign", text: "Open" }),
        actionBlock("layer-missing", { action: "layer", operation: "setZIndex", objectName: "foreground", zIndex: 3 }),
        actionBlock("video-missing", { action: "video", operation: "pause", objectName: "intro" }),
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
