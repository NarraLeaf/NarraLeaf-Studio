import { describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { storyRefJumpTarget } from "./storyRefJump";

/**
 * Where each kind of pointing word LANDS.
 *
 * The failure this guards against is silent in the worst way: a reference that resolves to the wrong
 * destination opens a real tab full of real content, and the author reads it as the editor being
 * confused about their script rather than as a bug. Nothing on screen says which row was asked for.
 *
 * The other half is `null`, which is just as load-bearing: it is what tells the token not to offer
 * the affordance at all, and a mapping that returned a target for a deleted row would light a word up
 * and then open an empty scene.
 */

const HERE = "s_here";
const THERE = "s_there";

const DOCUMENT: StoryDocument = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Chapter One",
    chapters: [{ id: "ch1", name: "Chapter", sceneIds: [HERE, THERE] }],
    scenes: {
        [HERE]: {
            id: HERE,
            name: "Kitchen",
            runtimeName: "kitchen",
            rootBlockIds: ["b_label", "b_gold"],
            blocks: {
                b_label: { id: "b_label", kind: "action", parentId: null, childrenIds: [], payload: { action: "label", name: "chorus" } },
                b_gold: {
                    id: "b_gold",
                    kind: "declaration",
                    parentId: null,
                    childrenIds: [],
                    payload: { scope: "scene", name: "gold", valueType: "number", defaultValue: 0, storageKey: "b_gold" },
                },
            },
        },
        [THERE]: { id: THERE, name: "Hallway", runtimeName: "hallway", rootBlockIds: [], blocks: {} },
    },
} as unknown as StoryDocument;

const WHERE = { document: DOCUMENT, sceneId: HERE };

describe("storyRefJumpTarget", () => {
    it("sends a cast member to their own record", () => {
        expect(storyRefJumpTarget({ kind: "character", characterId: "c1" }, WHERE))
            .toEqual({ kind: "character", characterId: "c1" });
    });

    it("names the library an asset lives in when the caller can say, and never guesses", () => {
        // The type is a search facet, not part of the address - the jump resolves the live asset by id
        // across every library - so a caller with no assets service still produces a usable target.
        expect(storyRefJumpTarget({ kind: "asset", assetId: "a1" }, { ...WHERE, assetType: () => "image" }))
            .toEqual({ kind: "asset", assetId: "a1", assetType: "image" });
        expect(storyRefJumpTarget({ kind: "asset", assetId: "a1" }, WHERE))
            .toEqual({ kind: "asset", assetId: "a1", assetType: "" });
    });

    it("carries the story a scene belongs to, which the projection never knew", () => {
        expect(storyRefJumpTarget({ kind: "scene", sceneId: THERE }, WHERE))
            .toEqual({ kind: "storyScene", storyId: "story-1", sceneId: THERE, storyName: "Chapter One", sceneName: "Hallway" });
    });

    it("resolves a row against the scene the row lives in", () => {
        // Every block reference is scene-local by construction, which is why the ref carries no scene.
        expect(storyRefJumpTarget({ kind: "block", blockId: "b_label" }, WHERE))
            .toEqual({ kind: "storyBlock", storyId: "story-1", sceneId: HERE, blockId: "b_label", storyName: "Chapter One", sceneName: "Kitchen" });
    });

    it("sends a scene variable to the row that declares it", () => {
        // The declaration block's id IS the variable's identity (schema v6), so this is the same
        // ref-to-row jump the variables panel already makes.
        expect(storyRefJumpTarget({ kind: "variable", target: { scope: "scene", variableId: "b_gold" } }, WHERE))
            .toEqual({ kind: "storyBlock", storyId: "story-1", sceneId: HERE, blockId: "b_gold", storyName: "Chapter One", sceneName: "Kitchen" });
    });

    it("sends a project variable to the panel that owns it, since no row declares one", () => {
        expect(storyRefJumpTarget({ kind: "variable", target: { scope: "saved", variableId: "v1" } }, WHERE))
            .toEqual({ kind: "storyVariable", scope: "saved", variableId: "v1" });
        expect(storyRefJumpTarget({ kind: "variable", target: { scope: "persistent", variableId: "v2" } }, WHERE))
            .toEqual({ kind: "storyVariable", scope: "persistent", variableId: "v2" });
    });

    it("declines rather than inventing a destination for something that is gone", () => {
        // Each of these is a word a projection may still print: the row that declared it was deleted
        // after the line was written. `null` is what keeps the token from offering a dead click.
        expect(storyRefJumpTarget({ kind: "block", blockId: "b_gone" }, WHERE)).toBeNull();
        expect(storyRefJumpTarget({ kind: "scene", sceneId: "s_gone" }, WHERE)).toBeNull();
        expect(storyRefJumpTarget({ kind: "variable", target: { scope: "scene", variableId: "b_gone" } }, WHERE)).toBeNull();
    });
});
