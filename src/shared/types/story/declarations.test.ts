import { describe, expect, it } from "vitest";
import { describeDeclaration, listSceneDeclarationBlocks, sceneVariableDefs, savedVariableDefs, storyPersistentDefs } from "./declarations";
import type { StoryBlock, StoryDeclarationBlock, StoryDocument, StoryScene, StoryVariableScope, StoryVariableValueType, StoryLiteralValue } from "./document";

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

function typedDeclaration(name: string, valueType: StoryVariableValueType, defaultValue?: StoryLiteralValue): StoryDeclarationBlock {
    return {
        id: name,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "scene", name, valueType, ...(defaultValue !== undefined ? { defaultValue } : {}), storageKey: name },
    };
}

describe("describeDeclaration", () => {
    it("reads as `name: type = default` when a default is declared", () => {
        expect(describeDeclaration(typedDeclaration("gold", "number", 0))).toBe("gold: number = 0");
    });

    it("JSON-encodes a string default so its quotes stay visible on the row", () => {
        expect(describeDeclaration(typedDeclaration("title", "string", "hi"))).toBe('title: string = "hi"');
    });

    it("omits the ` = value` when no default is declared", () => {
        expect(describeDeclaration(typedDeclaration("flag", "boolean"))).toBe("flag: boolean");
    });
});

/**
 * `scene.blocks` is a lookup table, not the script. `insertBlockInScene` appends every new block to
 * the record whatever position it takes in the tree, so the record's key order and the order the
 * author reads diverge the moment anything is inserted anywhere but the end. These pin that the
 * declaration scans read the tree.
 */
describe("declaration scans and document order", () => {
    it("lists declarations in tree order, not the order the record happens to hold them", () => {
        // Exactly what `StoryService.createDeclaration` produces: a new row is inserted BEFORE
        // `rootBlockIds[0]`, so the second variable an author declares is the first row of the scene
        // and the last key of the record.
        const declaredFirst = declaration("declared-first", "scene");
        const declaredSecond = declaration("declared-second", "scene");
        const scene: StoryScene = {
            ...sceneWith([]),
            rootBlockIds: [declaredSecond.id, declaredFirst.id],
            blocks: { [declaredFirst.id]: declaredFirst, [declaredSecond.id]: declaredSecond },
        };
        expect(listSceneDeclarationBlocks(scene).map(block => block.id)).toEqual(["declared-second", "declared-first"]);
        expect(Object.keys(sceneVariableDefs(scene))).toEqual(["declared-second", "declared-first"]);
    });

    it("places a nested declaration where its container sits, not after every root row", () => {
        const top = declaration("top", "scene");
        const nested = declaration("nested", "scene");
        const branch: StoryBlock = {
            id: "branch",
            kind: "control",
            parentId: null,
            childrenIds: [nested.id],
            payload: { control: "sequence", mode: "do" },
        };
        const tail = declaration("tail", "scene");
        const scene: StoryScene = {
            ...sceneWith([]),
            rootBlockIds: [top.id, branch.id, tail.id],
            // The nested row was added last, so the record holds it after `tail`.
            blocks: { [top.id]: top, [branch.id]: branch, [tail.id]: tail, [nested.id]: { ...nested, parentId: branch.id } },
        };
        expect(listSceneDeclarationBlocks(scene).map(block => block.id)).toEqual(["top", "nested", "tail"]);
    });

    it("still declares a row the block tree has lost, rather than silently un-declaring it", () => {
        // A row whose parent exists but does not claim it is unreachable from `rootBlockIds`. Studio
        // cannot produce that, but dropping such a row would turn every reference to its variable
        // into "undeclared" and cascade errors through lines the author never touched.
        const orphan = declaration("orphan", "scene");
        const scene: StoryScene = {
            ...sceneWith([]),
            rootBlockIds: [],
            blocks: { [orphan.id]: { ...orphan, parentId: "gone" } },
        };
        expect(listSceneDeclarationBlocks(scene).map(block => block.id)).toEqual(["orphan"]);
    });
});

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
