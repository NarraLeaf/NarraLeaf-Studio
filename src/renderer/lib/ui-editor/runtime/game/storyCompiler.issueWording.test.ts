import { afterEach, describe, expect, it } from "vitest";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { containsGeneratedId } from "@shared/utils/generatedId";
import { i18nStore } from "@/lib/i18n";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * What the story compiler tells an author, in the words they would use.
 *
 * Every diagnostic reaches Dev Mode's Issues panel under the row it is about, so none may carry an id
 * (a UUID names nothing an author can find) and none may be the compiler's own English in a Chinese or
 * Japanese window. The ids in these fixtures are real UUIDs on purpose: an id that looks like
 * `char-1` would pass a guard that a real project fails.
 */

const ALICE_ID = "5b0c1e7a-3f7d-4e0a-9d7e-1c2b3a4d5e6f";
const SMILE_POSE_ID = "8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CRY_POSE_ID = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
/** An asset the project never imported - the reported case: a pose left pointing at nothing. */
const NEVER_IMPORTED = "43d15d55-9a7e-4c1b-8f3a-2e6d5c4b3a21";
/** An asset the project has, whose file the host could not hand over. */
const KNOWN_BUT_UNREADABLE = "7c6b5a49-3827-4165-9a8b-7c6d5e4f3a2b";
const HEX_DIGEST = "a".repeat(64);

const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function alice(poses: { id: string; name: string; assetId: string | null }[]): DevModeCharacterSummary {
    return {
        id: ALICE_ID,
        name: "Alice",
        appearance: { kind: "preset", poses, defaultPoseId: poses[0]?.id ?? null },
    };
}

function document(blocks: Record<string, StoryBlock>, scene: Partial<StoryDocument["scenes"][string]> = {}): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "0d4c8b2a-1f3e-4d5c-9b8a-7e6f5d4c3b2a",
        name: "Story",
        chapters: [{ id: "c1", name: "Chapter", sceneIds: ["s1"] }],
        scenes: {
            s1: {
                id: "s1",
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: Object.keys(blocks),
                blocks,
                ...scene,
            },
        },
    };
}

function action(id: string, payload: StoryActionPayload): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload };
}

/** The host every project has: it answers the assets it holds and refuses the rest, in its own words. */
function resolverFor(held: readonly string[]) {
    return async (assetId: string) => {
        if (held.includes(assetId)) {
            return `nlr://${assetId}`;
        }
        throw new Error(`Asset not found: ${assetId}`);
    };
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("an asset reference that does not resolve", () => {
    it("names the character and the pose, never the asset id - on the row and for the avatar table", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({
                enter: action("enter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: SMILE_POSE_ID }),
            }),
            sceneId: "s1",
            characters: [alice([{ id: SMILE_POSE_ID, name: "Smile", assetId: NEVER_IMPORTED }])],
            resolveAssetUrl: resolverFor([]),
            assetNames: {},
        });

        const sentence = "The pose “Smile” of “Alice” refers to an asset that is no longer in this project.";
        // Under the row that shows her - that is where the author reads it...
        expect(compiled.diagnostics).toContainEqual({ level: "warning", blockId: "enter", message: sentence });
        // ...and nothing else on that row: the row has a pose with an asset, so there is no second,
        // vaguer sentence saying the character had no image.
        expect(compiled.diagnostics.filter(entry => entry.blockId === "enter")).toHaveLength(1);
        for (const entry of compiled.diagnostics) {
            expect(entry.message).not.toMatch(UUID_SHAPE);
            expect(entry.message).not.toContain("Asset not found");
        }
    });

    it("reports a pose no row uses, which only the avatar table ever asks for", async () => {
        // The case agents kept meeting: a pose in the character's file pointing at an asset that was
        // never imported. No row names it, so the character's avatar table is the only place that
        // resolves it - and that report is about the character, with no line to stand on.
        const compiled = await compileStudioStoryToNlr({
            document: document({
                enter: action("enter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: SMILE_POSE_ID }),
            }),
            sceneId: "s1",
            characters: [alice([
                { id: SMILE_POSE_ID, name: "Smile", assetId: "asset-smile" },
                { id: CRY_POSE_ID, name: "Cry", assetId: NEVER_IMPORTED },
            ])],
            resolveAssetUrl: resolverFor(["asset-smile"]),
            assetNames: { "asset-smile": "smile.png" },
        });

        expect(compiled.diagnostics).toEqual([
            {
                level: "warning",
                blockId: `avatar:${ALICE_ID}`,
                message: "The pose “Cry” of “Alice” refers to an asset that is no longer in this project.",
            },
        ]);
    });

    it("names the asset when the project has it and its file could not be had", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({
                bg: action("bg", { action: "setBackground", assetId: KNOWN_BUT_UNREADABLE }),
            }),
            sceneId: "s1",
            resolveAssetUrl: resolverFor([]),
            assetNames: { [KNOWN_BUT_UNREADABLE]: "hallway-night.png" },
        });

        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "bg", message: "This row refers to “hallway-night.png”, which could not be read." },
        ]);
    });

    it("says the scene, for a scene's own background and music", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({}, {
                defaultBackgroundAssetId: NEVER_IMPORTED,
                bgm: { assetId: HEX_DIGEST },
            }),
            sceneId: "s1",
            resolveAssetUrl: resolverFor([]),
        });

        const messages = compiled.diagnostics.map(entry => entry.message);
        expect(messages).toContain("The background of the scene “The corridor” refers to an asset that is no longer in this project.");
        expect(messages).toContain("The music of the scene “The corridor” refers to an asset that is no longer in this project.");
    });

    it("tells a value that is not an asset from one that is gone", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({
                bg: action("bg", { action: "setBackground", assetId: "[object Object]" }),
            }),
            sceneId: "s1",
            resolveAssetUrl: resolverFor([]),
        });

        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "bg", message: "This row is set to a value that is not an asset." },
        ]);
    });

    it("speaks the window's language", async () => {
        i18nStore.setLocale("zh");
        const compiled = await compileStudioStoryToNlr({
            document: document({
                enter: action("enter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: SMILE_POSE_ID }),
            }),
            sceneId: "s1",
            characters: [{ ...alice([{ id: SMILE_POSE_ID, name: "微笑", assetId: NEVER_IMPORTED }]), name: "苏幼晴" }],
            resolveAssetUrl: resolverFor([]),
        });

        expect(compiled.diagnostics).toContainEqual({
            level: "warning",
            blockId: "enter",
            message: "角色“苏幼晴”的姿态“微笑”引用了本项目中已不存在的资产",
        });
    });
});

describe("a character row with nothing to draw", () => {
    it("says why without the pose's id: a pose the character no longer has", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({
                enter: action("enter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: CRY_POSE_ID }),
            }),
            sceneId: "s1",
            characters: [alice([{ id: SMILE_POSE_ID, name: "Smile", assetId: "asset-smile" }])],
            resolveAssetUrl: resolverFor(["asset-smile"]),
        });

        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "enter", message: "The pose this row selects is no longer among the poses of “Alice”." },
        ]);
    });

    it("says why: a pose with no image", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: document({
                enter: action("enter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: SMILE_POSE_ID }),
            }),
            sceneId: "s1",
            characters: [alice([{ id: SMILE_POSE_ID, name: "Smile", assetId: null }])],
        });

        expect(compiled.diagnostics).toEqual([
            { level: "warning", blockId: "enter", message: "The pose “Smile” of “Alice” has no image." },
        ]);
    });
});

/**
 * The guard over the whole message family: a story that fails in as many ways as one scene can,
 * every reference in it an id, compiled in every catalog language - and not one sentence that
 * carries an id, and (outside English) not one that is the compiler's own English.
 */
describe("the compile's messages", () => {
    const MISSING_SCENE = "3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b";
    const MISSING_VARIABLE = "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a";
    const MISSING_CHARACTER = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
    const MISSING_ANIMATION = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

    function failingEverywhere(): StoryDocument {
        return document({
            jump: { id: "jump", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: MISSING_SCENE } },
            setSaved: action("setSaved", { action: "setVariable", target: { scope: "saved", variableId: MISSING_VARIABLE }, value: 1 }),
            setScene: action("setScene", { action: "setVariable", target: { scope: "scene", variableId: MISSING_VARIABLE }, value: 1 }),
            setPersistent: action("setPersistent", { action: "setVariable", target: { scope: "persistent", variableId: MISSING_VARIABLE }, value: 1 }),
            ghost: action("ghost", { action: "character", operation: "enter", characterId: MISSING_CHARACTER }),
            ghostExit: action("ghostExit", { action: "character", operation: "exit", characterId: MISSING_CHARACTER }),
            aliceEnter: action("aliceEnter", { action: "character", operation: "enter", characterId: ALICE_ID, pose: CRY_POSE_ID }),
            poster: action("poster", {
                action: "image",
                operation: "show",
                objectName: NEVER_IMPORTED,
                transform: { mode: "animation", animationId: MISSING_ANIMATION },
            } as StoryActionPayload),
            stop: action("stop", { action: "audio", operation: "stopSound", objectName: KNOWN_BUT_UNREADABLE } as StoryActionPayload),
            bg: action("bg", { action: "setBackground", assetId: NEVER_IMPORTED }),
            sound: action("sound", { action: "audio", operation: "playSound", objectName: "sting", assetId: HEX_DIGEST } as StoryActionPayload),
        }, { defaultBackgroundAssetId: NEVER_IMPORTED });
    }

    async function compileInEvery(locale: "en" | "zh" | "ja") {
        i18nStore.setLocale(locale);
        return compileStudioStoryToNlr({
            document: failingEverywhere(),
            sceneId: "s1",
            characters: [alice([
                { id: SMILE_POSE_ID, name: "Smile", assetId: NEVER_IMPORTED },
                { id: CRY_POSE_ID, name: "Cry", assetId: HEX_DIGEST },
            ])],
            resolveAssetUrl: resolverFor([]),
            assetNames: { [KNOWN_BUT_UNREADABLE]: "hallway-night.png" },
        });
    }

    it.each(["en", "zh", "ja"] as const)("carry no id in %s", async locale => {
        const compiled = await compileInEvery(locale);
        // The fixture has to actually fail, or the guard guards nothing.
        expect(compiled.diagnostics.length).toBeGreaterThan(8);
        for (const entry of compiled.diagnostics) {
            expect(containsGeneratedId(entry.message), entry.message).toBe(false);
        }
    });

    it.each(["zh", "ja"] as const)("are not the compiler's English in %s", async locale => {
        const compiled = await compileInEvery(locale);
        for (const entry of compiled.diagnostics) {
            // Three English words in a row is a sentence; the only Latin text a translated message
            // may carry is a name the author typed (`Alice`, `sting`) or a file name.
            expect(entry.message, entry.message).not.toMatch(/[A-Za-z]+ [A-Za-z]+ [A-Za-z]+/);
            expect(entry.message, entry.message).toMatch(/[぀-ヿ㐀-鿿]/);
        }
    });
});
