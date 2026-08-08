import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { collectStoryVariableOptions, resolveVariableRefName } from "./storyInterpolation";

/**
 * The option lists the inline-value popover and the condition editor build their keys from.
 *
 * The `id` each list carries is not cosmetic: both surfaces turn it into `"<scope>:<id>"` and hand
 * that back as a `StoryVariableRef`. A saved option keyed by anything other than the entry id would
 * write a ref the compiler cannot resolve, so these assertions are about the key as much as about
 * which variables appear.
 */

function documentWithDeclarations(declarations: { id: string; scope: string; name: string }[]): StoryDocument {
    const blocks: Record<string, StoryBlock> = {};
    const rootBlockIds: string[] = [];
    for (const declaration of declarations) {
        blocks[declaration.id] = {
            id: declaration.id,
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: {
                scope: declaration.scope,
                name: declaration.name,
                valueType: "number",
                storageKey: declaration.id,
            },
        } as unknown as StoryBlock;
        rootBlockIds.push(declaration.id);
    }
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: { "scene-1": { id: "scene-1", name: "Scene", runtimeName: "scene", rootBlockIds, blocks } },
    } as StoryDocument;
}

describe("collectStoryVariableOptions", () => {
    it("offers registry saved variables alongside the document's own rows", () => {
        const document = documentWithDeclarations([{ id: "row-1", scope: "saved", name: "Gold" }]);

        const options = collectStoryVariableOptions(document, "scene-1", [], [
            { id: "reg-1", name: "Affection", valueType: "number" },
        ]);

        expect(options.saved).toEqual([
            { id: "reg-1", name: "Affection", valueType: "number" },
            { id: "row-1", name: "Gold", valueType: "number" },
        ]);
    });

    it("keys persistent options by storage key and saved options by id", () => {
        const document = documentWithDeclarations([]);

        const options = collectStoryVariableOptions(
            document,
            "scene-1",
            [{ storageKey: "pk-1", name: "Playthroughs", valueType: "number" }],
            [{ id: "reg-1", name: "Affection", valueType: "number" }],
        );

        expect(options.persistent.map(option => option.id)).toEqual(["pk-1"]);
        expect(options.saved.map(option => option.id)).toEqual(["reg-1"]);
    });
});

describe("resolveVariableRefName", () => {
    it("names a saved ref the registry declares and no row does", () => {
        const document = documentWithDeclarations([]);

        expect(
            resolveVariableRefName(document, "scene-1", [], { scope: "saved", variableId: "reg-1" }, [
                { id: "reg-1", name: "Affection", valueType: "number" },
            ]),
        ).toBe("Affection");
    });

    /** The fallback still has to mean "this points at nothing", or a deleted variable reads as fine. */
    it("falls back when neither surface declares the ref", () => {
        const document = documentWithDeclarations([]);

        expect(resolveVariableRefName(document, "scene-1", [], { scope: "saved", variableId: "gone" })).toBe("variable");
    });
});
