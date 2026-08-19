import { describe, expect, it } from "vitest";
import {
    displayableCreatorIdentity,
    displayableSourceIdentity,
    displayableSubjectWord,
    resolveDisplayableTargetRef,
} from "./displayableTarget";
import type { StoryActionPayload, StoryBlock, StoryScene } from "./document";

/**
 * The two readings of "which row owns this object". They disagree on purpose, and the gap between
 * them is where a reference would silently anchor to the wrong row, so it is pinned here rather than
 * left to whichever consumer happens to pick one.
 */

function action(id: string, payload: StoryActionPayload): StoryBlock {
    return { id, kind: "action", parentId: null, childrenIds: [], payload } as StoryBlock;
}

function scene(blocks: StoryBlock[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene",
        runtimeName: "scene",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

describe("displayableCreatorIdentity", () => {
    it("answers for a create row and refuses every row that merely addresses the object", () => {
        const create = action("a", { action: "image", operation: "create", objectName: "poster" });
        const show = action("b", { action: "image", operation: "show", objectName: "poster" });
        expect(displayableCreatorIdentity(create)).toEqual({ kind: "image", name: "poster", label: "poster" });
        expect(displayableCreatorIdentity(show)).toBeNull();
        // The permissive reading takes both, and is right to: the engine's `getImage` is
        // get-or-create, so a bare `/show poster` really does put `poster` on stage.
        expect(displayableSourceIdentity(show)).toEqual({ kind: "image", name: "poster", label: "poster" });
    });

    it("takes a character's entrance and nothing else it does afterwards", () => {
        const enter = action("a", { action: "character", operation: "enter", characterId: "char-1", objectName: "Alice" });
        const face = action("b", { action: "character", operation: "expression", characterId: "char-1", objectName: "Alice" });
        expect(displayableCreatorIdentity(enter)).toEqual({ kind: "character", name: "Alice", label: "Alice" });
        expect(displayableCreatorIdentity(face)).toBeNull();
        expect(displayableSourceIdentity(face)).not.toBeNull();
    });

    it("reads a layer exactly as the permissive rule does, since that one already gates on create", () => {
        const create = action("a", { action: "layer", operation: "create", objectName: "fx" });
        const zIndex = action("b", { action: "layer", operation: "setZIndex", objectName: "fx", zIndex: 2 });
        expect(displayableCreatorIdentity(create)).toEqual(displayableSourceIdentity(create));
        expect(displayableCreatorIdentity(zIndex)).toBeNull();
        expect(displayableSourceIdentity(zIndex)).toBeNull();
    });

    it("keeps the stage key and the label apart for an unnamed character", () => {
        // The stage key falls back to the characterId, which is a UUID and must never be rendered.
        const enter = action("a", { action: "character", operation: "enter", characterId: "8f2c-uuid" });
        expect(displayableCreatorIdentity(enter)).toEqual({ kind: "character", name: "8f2c-uuid", label: "Character" });
    });

    it("ignores a text row that only changes what the object says", () => {
        expect(displayableCreatorIdentity(action("a", { action: "text", operation: "setText", objectName: "title", text: "hi" })))
            .toBeNull();
        expect(displayableCreatorIdentity(action("b", { action: "text", operation: "create", objectName: "title" })))
            .toEqual({ kind: "text", name: "title", label: "title" });
    });
});

describe("resolveDisplayableTargetRef - the dangling case", () => {
    it("shows the stored label, not the stage key, when the creator block was deleted", () => {
        // A character with no stage name keys on its `characterId`. Once the creator block is gone
        // the reference is all that is left, and falling back to `name` would render a UUID.
        const resolved = resolveDisplayableTargetRef(scene([]), {
            kind: "character",
            name: "8f2c-uuid",
            label: "Alice",
            sourceBlockId: "gone",
        });
        expect(resolved).toEqual({ name: "8f2c-uuid", kind: "character", label: "Alice" });
        expect(resolved.label).not.toBe("8f2c-uuid");
    });

    it("falls back to the name when a reference predates the label field", () => {
        // Every reference written before `label` existed reads exactly as it did before.
        expect(resolveDisplayableTargetRef(scene([]), { kind: "image", name: "poster", sourceBlockId: "gone" }))
            .toEqual({ name: "poster", kind: "image", label: "poster" });
    });

    it("ignores the stored label while the creator block still answers", () => {
        // The block is the source of truth for both halves; a stale label beside it changes nothing.
        const document = scene([action("create-1", { action: "image", operation: "create", objectName: "banner" })]);
        expect(resolveDisplayableTargetRef(document, { kind: "image", name: "poster", label: "poster", sourceBlockId: "create-1" }))
            .toEqual({ name: "banner", kind: "image", label: "banner" });
    });
});

describe("displayableSubjectWord", () => {
    it("follows a rename of the declaring row", () => {
        // The bug an author reported: the create row was renamed `poster` -> `bg`, the compiler
        // followed the reference, and every surface went on printing `poster`.
        const document = scene([action("create-1", { action: "image", operation: "create", objectName: "bg" })]);
        expect(displayableSubjectWord(document, { kind: "image", name: "poster", label: "poster", sourceBlockId: "create-1" }, "poster"))
            .toBe("bg");
    });

    it("leaves a document written before references exactly as it read", () => {
        const document = scene([action("create-1", { action: "image", operation: "create", objectName: "bg" })]);
        expect(displayableSubjectWord(document, undefined, "poster")).toBe("poster");
    });

    it("shows the stored label for a reference whose declaring row is gone", () => {
        expect(displayableSubjectWord(scene([]), { kind: "image", name: "poster", label: "poster", sourceBlockId: "gone" }, "poster"))
            .toBe("poster");
    });

    it("keeps the stored spelling when the declaring row named nothing", () => {
        // The key falls back to the literal `object` and the label to the placeholder `Image`;
        // neither is a word the candidate list offers, so the row prints what it stored.
        const document = scene([action("create-1", { action: "image", operation: "create", objectName: "" })]);
        const word = displayableSubjectWord(document, { kind: "image", name: "object", label: "object", sourceBlockId: "create-1" }, "object");
        expect(word).toBe("object");
        expect(word).not.toBe("Image");
    });

    it("spells a built-in by the reserved word the row already stores, never by its label", () => {
        expect(displayableSubjectWord(scene([]), { builtin: "background", kind: "image", name: "Scene background", label: "Scene background" }, "background"))
            .toBe("background");
    });
});
