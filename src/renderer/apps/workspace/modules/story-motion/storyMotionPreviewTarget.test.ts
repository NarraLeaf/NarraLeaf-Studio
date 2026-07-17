import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { characterStageObjectName, displayableSourceIdentity, resolveDisplayableTargetRef, STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { listSceneDisplayableTargets, resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

function documentWith(blocks: Record<string, StoryBlock>, rootBlockIds: string[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene",
                runtimeName: "scene",
                rootBlockIds,
                blocks,
            },
        },
    };
}

describe("resolveStoryMotionPreviewTarget", () => {
    it("uses current text action data for text previews", () => {
        const document = documentWith({
            text: {
                id: "text",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "text",
                    operation: "create",
                    objectName: "caption",
                    text: "Hello",
                    fontSize: 28,
                    fontColor: "#ffcc00",
                },
            },
        }, ["text"]);

        const target = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "text",
            fallbackKind: "image",
            fallbackLabel: "Fallback",
        });

        expect(target).toEqual(expect.objectContaining({
            kind: "text",
            label: "caption",
            text: "Hello",
            fontSize: 28,
            fontColor: "#ffcc00",
        }));
    });

    it("falls back to the preview image only when no target asset resolves", () => {
        const standalone = resolveStoryMotionPreviewTarget({
            document: null,
            sceneId: undefined,
            blockId: undefined,
            fallbackKind: "image",
            fallbackLabel: "Motion",
            previewAssetId: "asset-preview",
        });
        expect(standalone.assetId).toBe("asset-preview");

        const document = documentWith({
            create: {
                id: "create",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "create",
                    objectName: "hero",
                    assetId: "asset-hero",
                },
            },
            move: {
                id: "move",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                },
            },
        }, ["create", "move"]);
        const bound = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "move",
            fallbackKind: "image",
            fallbackLabel: "Motion",
            previewAssetId: "asset-preview",
        });
        expect(bound.assetId).toBe("asset-hero");
    });

    it("looks backward for displayable image preview context", () => {
        const document = documentWith({
            create: {
                id: "create",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "image",
                    operation: "create",
                    objectName: "hero",
                    assetId: "asset-hero",
                },
            },
            move: {
                id: "move",
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "displayable",
                    operation: "transform",
                    target: { name: "hero", kind: "image" },
                },
            },
        }, ["create", "move"]);

        const target = resolveStoryMotionPreviewTarget({
            document,
            sceneId: "scene-1",
            blockId: "move",
            fallbackKind: "image",
            fallbackLabel: "Fallback",
        });

        expect(target).toEqual(expect.objectContaining({
            kind: "image",
            label: "hero",
            assetId: "asset-hero",
        }));
    });
});

describe("listSceneDisplayableTargets", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    it("lists creator displayables with their stable source block, deduped with the latest asset", () => {
        const document = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" }),
            heroReskin: action("heroReskin", { action: "image", operation: "setSource", objectName: "hero", assetId: "asset-hero-2" }),
            caption: action("caption", { action: "text", operation: "create", objectName: "caption", text: "Hi" }),
            move: action("move", { action: "displayable", operation: "transform", target: { name: "hero", kind: "image" } }),
        }, ["hero", "heroReskin", "caption", "move"]);

        const targets = listSceneDisplayableTargets(document, "scene-1", "move");

        // Deduped by identity: latest asset wins, but the source stays the first creator ("hero").
        expect(targets).toEqual([
            { kind: "image", name: "hero", label: "hero", assetId: "asset-hero-2", sourceBlockId: "hero" },
            { kind: "text", name: "caption", label: "caption", text: "Hi", sourceBlockId: "caption" },
        ]);
    });

    it("excludes the current block and anything after it", () => {
        const document = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "hero", assetId: "asset-hero" }),
            later: action("later", { action: "image", operation: "create", objectName: "later", assetId: "asset-later" }),
        }, ["hero", "later"]);

        expect(listSceneDisplayableTargets(document, "scene-1", "hero")).toEqual([]);
        expect(listSceneDisplayableTargets(document, "scene-1", "later")).toEqual([
            { kind: "image", name: "hero", label: "hero", assetId: "asset-hero", sourceBlockId: "hero" },
        ]);
    });

    it("lists only creator actions, never displayable references (which introduce nothing)", () => {
        const document = documentWith({
            ghostShow: action("ghostShow", { action: "displayable", operation: "show", target: { name: "ghost" } }),
            ghostMove: action("ghostMove", { action: "displayable", operation: "transform", target: { name: "ghost", kind: "image" } }),
            probe: action("probe", { action: "displayable", operation: "hide", target: { name: "ghost" } }),
        }, ["ghostShow", "ghostMove", "probe"]);

        expect(listSceneDisplayableTargets(document, "scene-1", "probe")).toEqual([]);
    });
});

describe("resolveDisplayableTargetRef", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    it("follows the source block's current name when the stage name is renamed", () => {
        // The creator was renamed to "protagonist"; the target still carries the stale name "hero".
        const scene = documentWith({
            hero: action("hero", { action: "image", operation: "create", objectName: "protagonist", assetId: "asset-hero" }),
        }, ["hero"]).scenes["scene-1"];

        expect(resolveDisplayableTargetRef(scene, { name: "hero", kind: "image", sourceBlockId: "hero" }))
            .toEqual({ name: "protagonist", kind: "image", label: "protagonist" });
    });

    it("falls back to the stored name when the source block is gone", () => {
        const scene = documentWith({}, []).scenes["scene-1"];
        expect(resolveDisplayableTargetRef(scene, { name: "ghost", kind: "image", sourceBlockId: "deleted" }))
            .toEqual({ name: "ghost", kind: "image", label: "ghost" });
    });

    it("uses the stored name/kind for legacy targets without a source block", () => {
        const scene = documentWith({}, []).scenes["scene-1"];
        expect(resolveDisplayableTargetRef(scene, { name: "hero", kind: "character" }))
            .toEqual({ name: "hero", kind: "character", label: "hero" });
    });
});

/**
 * A displayable action finds its object by looking up the resolved `name` in the same map the
 * compiler registered it in, so a target ref must resolve to *exactly* the creator's stage name.
 * These two drifting apart is silent: the op compiles to nothing and the effect never runs.
 */
describe("resolved target name matches the stage name the compiler registers", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    function resolvedNameFor(payload: StoryActionPayload, storedName: string): string {
        const scene = documentWith({ source: action("source", payload) }, ["source"]).scenes["scene-1"];
        return resolveDisplayableTargetRef(scene, { name: storedName, sourceBlockId: "source" }).name;
    }

    const CHARACTER_CASES: Array<{ label: string; payload: Extract<StoryActionPayload, { action: "character" }> }> = [
        { label: "nothing configured", payload: { action: "character", operation: "enter" } },
        { label: "characterId, no stage name", payload: { action: "character", operation: "enter", characterId: "c-uuid" } },
        { label: "stage name auto-filled from the profile", payload: { action: "character", operation: "enter", characterId: "c-uuid", objectName: "Yuko" } },
        { label: "stage name cleared by the author", payload: { action: "character", operation: "enter", characterId: "c-uuid", objectName: "" } },
        { label: "stage name whitespace-only", payload: { action: "character", operation: "enter", characterId: "c-uuid", objectName: "   " } },
        { label: "stage name literally 'character'", payload: { action: "character", operation: "enter", characterId: "c-uuid", objectName: "character" } },
        { label: "custom stage name", payload: { action: "character", operation: "enter", characterId: "c-uuid", objectName: "heroine" } },
    ];

    for (const { label, payload } of CHARACTER_CASES) {
        it(`character — ${label}`, () => {
            // "Character" is what the legacy identity rule stored in the ref, so it doubles as a
            // regression guard: the stored name must never win over the creator's real stage name.
            expect(resolvedNameFor(payload, "Character")).toBe(characterStageObjectName(payload));
        });
    }

    it("image / text / layer fall back to the compiler's stage name when unnamed", () => {
        // `normalizeStageObjectName` is what the compiler keys these on, so an empty name is
        // "object" on both sides — not the display word "Image" / "Text" / "Layer".
        expect(resolvedNameFor({ action: "image", operation: "create", objectName: "" }, "Image")).toBe("object");
        expect(resolvedNameFor({ action: "text", operation: "create", objectName: "  ", text: "hi" }, "Text")).toBe("object");
        expect(resolvedNameFor({ action: "layer", operation: "create", objectName: "" }, "Layer")).toBe("object");
    });
});

describe("displayableSourceIdentity keeps author-facing labels free of internal ids", () => {
    function action(id: string, payload: StoryActionPayload): StoryBlock {
        return { id, kind: "action", parentId: null, childrenIds: [], payload };
    }

    it("labels an unnamed character 'Character' even though it keys on the characterId UUID", () => {
        const payload: StoryActionPayload = { action: "character", operation: "enter", characterId: "9f8c1e2a-uuid" };
        const identity = displayableSourceIdentity(action("c", payload))!;

        expect(identity.name).toBe("9f8c1e2a-uuid");
        expect(identity.label).toBe("Character");
    });

    it("prefers the authored stage name as the label", () => {
        const payload: StoryActionPayload = { action: "character", operation: "enter", characterId: "9f8c1e2a-uuid", objectName: "Yuko" };
        const identity = displayableSourceIdentity(action("c", payload))!;

        expect(identity).toMatchObject({ name: "Yuko", label: "Yuko" });
    });
});
