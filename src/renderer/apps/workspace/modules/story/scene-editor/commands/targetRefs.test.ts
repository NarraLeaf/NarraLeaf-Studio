import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import {
    resolveActionableTargetRef,
    resolveDisplayableTargetRef,
    STORY_DOCUMENT_SCHEMA_VERSION,
} from "@shared/types/story";
import { parseCommandLine } from "../storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "../storyCommandResolution";
import { buildStoryCommandContext } from "../storyCommandContext";
import { getCommandSpec } from "./registry";

/**
 * What a committed line stores about the object it acts on.
 *
 * The contract this pins is the pair, not either half: a row that ADDRESSES an object writes both
 * `objectName` - still the authoritative key, still what the compiler and the script view read - and
 * a `target` reference anchored to the row that DECLARED the object. A row that declares one writes
 * no reference at all, because pointing an object at itself says nothing.
 *
 * The last test is the point of the whole exercise: rename the declaring row and the referencing row
 * still resolves to the new name.
 */

const SCENE_ID = "scene-1";

/** One action block per entry, in root order - the scene a line is resolved against. */
function documentWith(payloads: Record<string, StoryActionPayload>): StoryDocument {
    const blocks: Record<string, StoryBlock> = {};
    const rootBlockIds: string[] = [];
    for (const [id, payload] of Object.entries(payloads)) {
        blocks[id] = { id, kind: "action", parentId: null, childrenIds: [], payload };
        rootBlockIds.push(id);
    }
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE_ID] }],
        scenes: { [SCENE_ID]: { id: SCENE_ID, name: "Scene", runtimeName: "scene", rootBlockIds, blocks } },
    };
}

/** A scene holding one of every declaring row, so every arm of the write side has something to bind to. */
const DECLARATIONS: Record<string, StoryActionPayload> = {
    b_char: { action: "character", operation: "enter", characterId: "c1", objectName: "Alice" },
    b_img: { action: "image", operation: "create", objectName: "hero", assetId: "i1" },
    b_txt: { action: "text", operation: "create", objectName: "title", text: "Hi" },
    b_layer: { action: "layer", operation: "create", objectName: "overlay" },
    b_vid: { action: "video", operation: "create", objectName: "clip", assetId: "v1" },
    b_snd: { action: "audio", operation: "playSound", objectName: "piano", assetId: "a1" },
    b_vfx: { action: "vfx", operation: "create", objectName: "petals", assetId: "v2" },
};

/**
 * The command context for a document, with the project-level lists a line needs filled in by hand.
 *
 * `buildStoryCommandContext` reads those off an assets map and the `Character` records, neither of
 * which exists without a project open - and neither is what these tests are about. The scene scan,
 * which IS what they are about, comes from the real collector.
 */
function contextFor(document: StoryDocument): StoryCommandContext {
    return {
        ...buildStoryCommandContext({
            assets: undefined,
            characters: [],
            document,
            sceneId: SCENE_ID,
            scene: document.scenes[SCENE_ID],
        }),
        images: [{ id: "i1", name: "forest" }, { id: "i2", name: "night" }],
        audio: [{ id: "a1", name: "theme" }, { id: "a2", name: "hit" }],
        videos: [{ id: "v1", name: "intro" }, { id: "v2", name: "rain" }],
        characters: [{ id: "c1", name: "Alice" }],
    };
}

/** Parse, resolve and build one line against a scene; throws if any stage refuses. */
function buildIn(document: StoryDocument, source: string): Extract<StoryBlock, { kind: "action" }>["payload"] {
    const context = contextFor(document);
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(line.issues).toEqual([]);
    const { args, issues } = resolveCommandLine(line, context);
    expect(issues).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    let nextId = 0;
    const block = spec.build(args, { generateId: () => `new_${nextId++}`, context });
    if (block.kind !== "action") {
        throw new Error(`not an action block: ${source}`);
    }
    return block.payload;
}

const DECLARED = documentWith(DECLARATIONS);
const build = (source: string) => buildIn(DECLARED, source);

describe("a row that addresses a displayable names the row that declared it", () => {
    it("/swap binds an image and a text to their create rows, and keeps writing the name", () => {
        expect(build("/swap hero night")).toMatchObject({
            action: "image",
            operation: "setSource",
            objectName: "hero",
            target: { kind: "image", name: "hero", label: "hero", sourceBlockId: "b_img" },
        });
        expect(build("/swap title New words")).toMatchObject({
            action: "text",
            operation: "setText",
            objectName: "title",
            target: { kind: "text", name: "title", label: "title", sourceBlockId: "b_txt" },
        });
    });

    it("/font binds the text it restyles", () => {
        expect(build("/font title 24")).toMatchObject({
            action: "text",
            objectName: "title",
            target: { kind: "text", name: "title", label: "title", sourceBlockId: "b_txt" },
        });
    });

    it("/show and /hide bind every subject they reach", () => {
        expect(build("/show hero")).toMatchObject({
            action: "image",
            operation: "show",
            objectName: "hero",
            target: { kind: "image", name: "hero", label: "hero", sourceBlockId: "b_img" },
        });
        expect(build("/hide title")).toMatchObject({
            action: "text",
            operation: "hide",
            objectName: "title",
            target: { kind: "text", name: "title", label: "title", sourceBlockId: "b_txt" },
        });
        // The layer arm: it always carried the reference-shaped payload, and always left the id blank.
        expect(build("/show overlay")).toMatchObject({
            action: "displayable",
            operation: "show",
            target: { kind: "layer", name: "overlay", label: "overlay", sourceBlockId: "b_layer" },
        });
    });

    it("a built-in singleton is referenced as one, and still reads back", () => {
        expect(build("/transform backgroundLayer opacity=0.4")).toMatchObject({
            action: "displayable",
            target: { builtin: "backgroundLayer", kind: "layer", label: "Background layer" },
        });
    });
});

describe("a character reference stores the stage key, not the cast name", () => {
    it("binds to the entering row and labels itself with the name a person reads", () => {
        // The entering row named the portrait `Alice`, so the stage key and the cast name coincide -
        // which is exactly why storing one for the other went unnoticed.
        expect(build("/transform Alice d=0.4")).toMatchObject({
            action: "displayable",
            operation: "transform",
            target: { kind: "character", name: "Alice", label: "Alice", sourceBlockId: "b_char" },
        });
    });

    it("keys on the character id when the entering row named no portrait", () => {
        // `/show Alice` writes no stage name, so the compiler registers the portrait under the
        // character id. A reference storing the cast name here missed the lookup outright, and
        // `getImage` being get-or-create turned that miss into a blank sprite rather than an error.
        const document = documentWith({
            b_char: { action: "character", operation: "enter", characterId: "c1" },
        });
        expect(buildIn(document, "/transform Alice d=0.4")).toMatchObject({
            target: { kind: "character", name: "c1", label: "Alice", sourceBlockId: "b_char" },
        });
    });

    it("falls back to the shared naming rule when the scene declares no entrance", () => {
        const document = documentWith({
            b_img: { action: "image", operation: "create", objectName: "hero", assetId: "i1" },
        });
        const payload = buildIn(document, "/transform Alice d=0.4");
        expect(payload).toMatchObject({ target: { kind: "character", name: "c1", label: "Alice" } });
        expect(payload).not.toHaveProperty("target.sourceBlockId");
    });
});

describe("a row that addresses an actionable handle names the row that declared it", () => {
    it("/play, /seek and /hide bind a clip", () => {
        expect(build("/play clip")).toMatchObject({
            action: "video",
            operation: "play",
            objectName: "clip",
            target: { name: "clip", label: "clip", sourceBlockId: "b_vid" },
        });
        expect(build("/seek clip 12")).toMatchObject({
            action: "video",
            operation: "seek",
            timeMs: 12000,
            target: { name: "clip", sourceBlockId: "b_vid" },
        });
        expect(build("/hide clip")).toMatchObject({
            action: "video",
            operation: "hide",
            target: { name: "clip", sourceBlockId: "b_vid" },
        });
    });

    it("/show, /pause and /rate bind an ambience overlay", () => {
        expect(build("/show petals")).toMatchObject({
            action: "vfx",
            operation: "show",
            objectName: "petals",
            target: { name: "petals", label: "petals", sourceBlockId: "b_vfx" },
        });
        expect(build("/pause petals")).toMatchObject({ action: "vfx", operation: "pause", target: { sourceBlockId: "b_vfx" } });
        expect(build("/rate petals 1.5")).toMatchObject({ action: "vfx", operation: "setRate", rate: 1.5, target: { sourceBlockId: "b_vfx" } });
    });

    it("/stop and /vol bind a named sound", () => {
        expect(build("/stop piano")).toMatchObject({
            action: "audio",
            operation: "stopSound",
            objectName: "piano",
            target: { name: "piano", label: "piano", sourceBlockId: "b_snd" },
        });
        expect(build("/vol piano 0.5")).toMatchObject({
            action: "audio",
            operation: "setVolume",
            volume: 0.5,
            target: { name: "piano", sourceBlockId: "b_snd" },
        });
    });

    it("the music channel is a built-in, whether it is named or omitted", () => {
        // It has no declaring row to bind to: a scene states its music on its own record, and every
        // `/vol` addresses the same handle whether or not this scene holds a `/bgm` line.
        const omitted = build("/vol 0.5");
        expect(omitted).toMatchObject({
            action: "audio",
            operation: "setVolume",
            objectName: "bgm",
            target: { builtin: "bgm", name: "bgm", label: "Background music" },
        });
        expect(omitted).not.toHaveProperty("target.sourceBlockId");
        expect(build("/mute bgm")).toMatchObject({ target: { builtin: "bgm" } });
        expect(build("/seek bgm 30")).toMatchObject({ action: "audio", operation: "seekSound", target: { builtin: "bgm" } });
    });

    it("a free-typed name resolves by name alone, as it always did", () => {
        // Nothing on stage answers to it - an object some other scene made, or a typo. There is no
        // row to point at, so the reference carries the name and nothing else.
        const payload = build("/stop ambience");
        expect(payload).toMatchObject({ action: "audio", objectName: "ambience", target: { name: "ambience", label: "ambience" } });
        expect(payload).not.toHaveProperty("target.sourceBlockId");
    });
});

describe("a row that declares an object writes no reference", () => {
    it("holds for every create verb - a reference pointing at its own row says nothing", () => {
        for (const source of [
            "/image night",
            "/text Chapter One",
            "/video intro",
            "/layer fx",
            "/vfx rain",
            "/sound hit",
            "/bgm theme",
        ]) {
            expect(buildIn(DECLARED, source), source).not.toHaveProperty("target");
        }
    });
});

describe("the reference follows a rename of the row that declared the object", () => {
    /** Rewrite one declaring row's stage name, the edit the whole change exists to survive. */
    function renamed(document: StoryDocument, blockId: string, objectName: string): StoryScene {
        const scene = document.scenes[SCENE_ID];
        const block = scene.blocks[blockId];
        if (block.kind !== "action" || !("objectName" in block.payload)) {
            throw new Error(`not a named declaration: ${blockId}`);
        }
        return {
            ...scene,
            blocks: { ...scene.blocks, [blockId]: { ...block, payload: { ...block.payload, objectName } } },
        };
    }

    it("a displayable reference reports the new name while the row keeps the old one", () => {
        const payload = build("/swap hero night");
        if (payload.action !== "image" || !payload.target) {
            throw new Error("expected an image row carrying a reference");
        }
        const after = renamed(DECLARED, "b_img", "champion");
        expect(resolveDisplayableTargetRef(after, payload.target)).toMatchObject({ name: "champion", kind: "image", label: "champion" });
        // `objectName` is untouched and still says `hero`. That staleness is the state of the world
        // today and is not what this change addresses - the reference is the half that had to move.
        expect(payload.objectName).toBe("hero");
    });

    it("an actionable reference does the same for a sound", () => {
        const payload = build("/stop piano");
        if (payload.action !== "audio" || !payload.target) {
            throw new Error("expected a sound row carrying a reference");
        }
        const after = renamed(DECLARED, "b_snd", "keys");
        expect(resolveActionableTargetRef(after, payload.target, "audio")).toEqual({ name: "keys", label: "keys", resolved: true });
    });

    it("a character reference follows the portrait's stage name", () => {
        const payload = build("/transform Alice d=0.4");
        if (payload.action !== "displayable") {
            throw new Error("expected a displayable row");
        }
        const after = renamed(DECLARED, "b_char", "alice_left");
        expect(resolveDisplayableTargetRef(after, payload.target)).toMatchObject({ name: "alice_left", kind: "character" });
    });

    it("a deleted declaring row leaves a readable reference rather than a key", () => {
        const payload = buildIn(
            documentWith({ b_char: { action: "character", operation: "enter", characterId: "c1" } }),
            "/transform Alice d=0.4",
        );
        if (payload.action !== "displayable") {
            throw new Error("expected a displayable row");
        }
        // The stage key here is the character id. `label` is the only half safe to draw, and this is
        // the case that proves it has to be written: without it the row would read as a UUID.
        expect(resolveDisplayableTargetRef({ ...DECLARED.scenes[SCENE_ID], blocks: {} }, payload.target))
            .toMatchObject({ name: "c1", label: "Alice" });
    });
});
