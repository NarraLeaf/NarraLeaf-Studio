import { describe, expect, it } from "vitest";
import { sceneVariableDefs, savedVariableDefs, storyPersistentDefs } from "./declarations";
import type { StoryDeclarationBlock, StoryDocument, StoryScene, StoryVariableScope } from "./document";

/**
 * A disabled declaration row must still declare its variable. Disabling is "compiled out" for
 * executable rows, but a declaration is a lexical entry: un-declaring it would make every reference
 * to that variable resolve to "undeclared" and cascade errors through untouched lines. These tests
 * pin that intentional exception so a future reader does not "fix" it by adding a `.disabled` guard
 * to the scans (see the note in `declarations.ts`).
 */

function declaration(id: string, scope: StoryVariableScope, opts?: { disabled?: boolean; defaultValue?: number }): StoryDeclarationBlock {
    return {
        id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        ...(opts?.disabled ? { disabled: true } : {}),
        payload: {
            scope,
            name: id,
            valueType: "number",
            defaultValue: opts?.defaultValue ?? 0,
            storageKey: id,
        },
    };
}

function sceneWith(blocks: StoryDeclarationBlock[]): StoryScene {
    return {
        id: "scene-1",
        name: "Scene 1",
        runtimeName: "scene-1",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function documentWith(scene: StoryScene): StoryDocument {
    return { scenes: { [scene.id]: scene } } as unknown as StoryDocument;
}

describe("declaration scans and the disabled flag", () => {
    it("keeps a disabled scene declaration in the scene table", () => {
        const scene = sceneWith([
            declaration("enabled", "scene"),
            declaration("silenced", "scene", { disabled: true, defaultValue: 5 }),
        ]);
        const defs = sceneVariableDefs(scene);
        expect(Object.keys(defs).sort()).toEqual(["enabled", "silenced"]);
        // Its default survives too — the compiler seeds from this very table.
        expect(defs.silenced.defaultValue).toBe(5);
    });

    it("keeps disabled saved and persistent declarations in the document-wide tables", () => {
        const document = documentWith(sceneWith([
            declaration("save", "saved", { disabled: true }),
            declaration("global", "persistent", { disabled: true }),
        ]));
        expect(Object.keys(savedVariableDefs(document))).toEqual(["save"]);
        expect(Object.keys(storyPersistentDefs(document))).toEqual(["global"]);
    });
});
