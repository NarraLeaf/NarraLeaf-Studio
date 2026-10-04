import { describe, expect, it } from "vitest";
import { compileStudioStoryToNlr } from "./storyCompiler";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";
import type { StoryDocument } from "@shared/types/story";

/**
 * An ambience overlay belongs to the scene that declares it, like every other stage object.
 *
 * The engine takes an overlay off the stage with the scene that showed it - rain started in one scene
 * stops when the story jumps to the next - so the compiler builds one overlay per scene that declares
 * it, names it under that scene, and a later scene that never declared the name has nothing to
 * address: its `/hide rain` is the same missing-object report any other stage object gives.
 */

const CLIP = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIP = "33333333-3333-4333-8333-333333333333";

function vfxBlock(id: string, operation: string, objectName: string, assetId?: string) {
    return {
        kind: "action",
        id,
        parentId: null,
        childrenIds: [],
        payload: { action: "vfx", operation, objectName, ...(assetId ? { assetId } : {}) },
    };
}

function lineBlock(id: string, text: string) {
    return {
        kind: "narration",
        id,
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `t-${id}`, segments: [{ type: "text", value: text }] } },
    };
}

function document(sceneA: ReturnType<typeof vfxBlock>[], sceneB: ReturnType<typeof vfxBlock>[]): StoryDocument {
    return {
        schemaVersion: 18,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "One",
                runtimeName: "one",
                rootBlockIds: sceneA.map(block => block.id),
                blocks: Object.fromEntries(sceneA.map(block => [block.id, block])),
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                rootBlockIds: sceneB.map(block => block.id),
                blocks: Object.fromEntries(sceneB.map(block => [block.id, block])),
            },
        },
    } as unknown as StoryDocument;
}

async function compile(doc: StoryDocument, extra: Partial<Parameters<typeof compileStudioStoryToNlr>[0]> = {}) {
    return compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        ...extra,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
}

const overlayIds = (compiled: Awaited<ReturnType<typeof compile>>) =>
    compiled.elementIdBindings.filter(id => /^nl:(vfx|launch):/.test(id) && id.includes("vfx:"));

describe("ambience overlays are scoped to their scene", () => {
    it("names each overlay under the scene that declares it", async () => {
        const compiled = await compile(document(
            [vfxBlock("a1", "create", "rain", CLIP)],
            [vfxBlock("b1", "create", "rain", OTHER_CLIP)],
        ));

        // Two scenes, two overlays: each scene's rain is its own, and neither is the other's.
        expect(overlayIds(compiled).sort()).toEqual(["nl:vfx:scene-a:rain", "nl:vfx:scene-b:rain"]);
        // A second scene naming a different clip is not a conflict any more - it is a different overlay.
        expect(compiled.diagnostics.filter(entry => /different clip/.test(entry.message))).toEqual([]);
    });

    it("reports a later scene addressing an overlay only an earlier scene declared", async () => {
        const compiled = await compile(document(
            [vfxBlock("a1", "create", "rain", CLIP)],
            [vfxBlock("b1", "hide", "rain")],
        ));

        // The rain left with the first scene, so the second has nothing by that name - the report
        // every stage object gives when no row in its scene declares it.
        const reported = compiled.diagnostics.filter(entry => entry.blockId === "b1");
        expect(reported).toHaveLength(1);
        expect(reported[0].level).toBe("error");
        expect(reported[0].message).toMatch(/Ambience effect/);
    });

    it("still reports a second row in one scene that names a different clip for the same overlay", async () => {
        const compiled = await compile(document(
            [vfxBlock("a1", "create", "rain", CLIP), vfxBlock("a2", "create", "rain", OTHER_CLIP)],
            [],
        ));

        const reported = compiled.diagnostics.filter(entry => /different clip/.test(entry.message));
        expect(reported).toHaveLength(1);
        expect(reported[0].level).toBe("warning");
        expect(reported[0].blockId).toBe("a2");
        expect(overlayIds(compiled)).toEqual(["nl:vfx:scene-a:rain"]);
    });

    it("gives a row launch the overlays its scene declared before the row, so the tail can address them", async () => {
        const doc = document(
            [
                vfxBlock("a1", "create", "rain", CLIP),
                vfxBlock("a2", "show", "rain"),
                lineBlock("a3", "It is raining.") as never,
                vfxBlock("a4", "hide", "rain"),
            ],
            [],
        );
        const snapshot = computeStoryStageSnapshot({ document: doc, sceneId: "scene-a", targetBlockId: "a3" });

        // The walked path created and showed the rain, and nothing hid it before the target row.
        expect(snapshot.vfx).toEqual([{ objectName: "rain", sourceBlockId: "a1", staged: true, shownBy: "a2", paused: false }]);

        const compiled = await compile(doc, { launch: { targetBlockId: "a3", snapshot } });
        // The tail's hide finds the overlay the launch built for it, under the launch's own names.
        expect(compiled.diagnostics.filter(entry => entry.level === "error")).toEqual([]);
        expect(overlayIds(compiled).some(id => id.startsWith("nl:launch:scene-a:a3:vfx:rain"))).toBe(true);
    });
});
