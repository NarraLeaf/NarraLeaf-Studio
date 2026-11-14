import { describe, expect, it } from "vitest";
import { sceneVariableDefs, type StoryBlock, type StoryScene } from "@shared/types/story";
import { cloneSerializedBlock, cloneSerializedBlocks } from "./storySceneClipboard";

describe("cloning a story declaration", () => {
    it("gives the copied variable its own runtime storage key", () => {
        const original: StoryBlock = {
            id: "original",
            kind: "declaration",
            parentId: null,
            childrenIds: [],
            payload: { scope: "scene", name: "score", valueType: "number", defaultValue: 1, storageKey: "original" },
        };
        const cloned = cloneSerializedBlock({ block: original, children: [] }, () => "copy").block;
        const scene = {
            rootBlockIds: [original.id, cloned.id],
            blocks: { [original.id]: original, [cloned.id]: cloned },
        } as StoryScene;

        const variables = sceneVariableDefs(scene);
        expect(variables.original.storageKey).toBe("original");
        expect(variables.copy.storageKey).toBe("copy");
        expect(original.payload.storageKey).toBe("original");
    });

    it("binds copied variable reads and writes to the copied declaration", () => {
        const declaration: StoryBlock = {
            id: "variable", kind: "declaration", parentId: null, childrenIds: [],
            payload: { scope: "scene", name: "score", valueType: "number", storageKey: "variable" },
        };
        const write: StoryBlock = {
            id: "write", kind: "action", parentId: null, childrenIds: [],
            payload: {
                action: "setVariable",
                target: { scope: "scene", variableId: "variable" },
                value: null,
                expression: {
                    source: "score + score",
                    ast: {
                        kind: "binary", op: "+",
                        left: { kind: "var", name: "score", target: { scope: "scene", variableId: "variable" } },
                        right: { kind: "var", name: "score", target: { scope: "scene", variableId: "variable" } },
                    },
                },
            },
        };
        const ids = ["variable-copy", "write-copy"];
        const cloned = cloneSerializedBlocks([
            { block: declaration, children: [] }, { block: write, children: [] },
        ], () => ids.shift() ?? "unexpected");

        expect(cloned[1].block.payload).toMatchObject({
            target: { variableId: "variable-copy" },
            expression: { ast: { left: { target: { variableId: "variable-copy" } }, right: { target: { variableId: "variable-copy" } } } },
        });
        expect(write.payload).toMatchObject({ target: { variableId: "variable" } });
    });

    it("rebinds conditions and inline values while leaving external variables and plugin data alone", () => {
        const declaration: StoryBlock = {
            id: "variable", kind: "declaration", parentId: null, childrenIds: [],
            payload: { scope: "scene", name: "score", valueType: "number", storageKey: "variable" },
        };
        const option: StoryBlock = {
            id: "option", kind: "nodeAction", parentId: null, childrenIds: [],
            payload: {
                action: "choiceOption",
                text: {
                    textId: "text", role: "choiceText", value: "Score: ",
                    rich: [{ text: "Score: " }, { interpolation: { kind: "variable", target: { scope: "scene", variableId: "variable" } } }],
                },
                hiddenWhen: { kind: "variable", target: { scope: "scene", variableId: "variable" }, operator: "exists" },
                disabledWhen: { kind: "variable", target: { scope: "saved", variableId: "variable" }, operator: "exists" },
            },
        };
        const plugin: StoryBlock = {
            id: "plugin", kind: "action", parentId: null, childrenIds: [],
            payload: { action: "plugin", pluginId: "plugin", actionId: "action", params: { scope: "scene", variableId: "variable" } },
        };
        const ids = ["variable-copy", "option-copy", "text-copy", "plugin-copy"];
        const cloned = cloneSerializedBlocks([
            { block: declaration, children: [] }, { block: option, children: [] }, { block: plugin, children: [] },
        ], () => ids.shift() ?? "unexpected");

        expect(cloned[1].block.payload).toMatchObject({
            text: { textId: "text-copy", rich: [{ text: "Score: " }, { interpolation: { target: { variableId: "variable-copy" } } }] },
            hiddenWhen: { target: { variableId: "variable-copy" } },
            disabledWhen: { target: { variableId: "variable", scope: "saved" } },
        });
        expect(cloned[2].block.payload).toMatchObject({ params: { scope: "scene", variableId: "variable" } });
    });

    it("binds a copied picked expression to the copied choice option", () => {
        const option: StoryBlock = {
            id: "option", kind: "nodeAction", parentId: null, childrenIds: [],
            payload: { action: "choiceOption", text: { textId: "text", role: "choiceText", value: "Yes" } },
        };
        const branch: StoryBlock = {
            id: "branch", kind: "control", parentId: null, childrenIds: [],
            payload: {
                control: "conditionBranch", branch: "if",
                condition: {
                    kind: "expression",
                    expression: { source: "picked(Yes)", ast: { kind: "visited", name: "Yes", target: { kind: "option", blockId: "option" } } },
                },
            },
        };
        const ids = ["option-copy", "text-copy", "branch-copy"];
        const cloned = cloneSerializedBlocks([
            { block: option, children: [] }, { block: branch, children: [] },
        ], () => ids.shift() ?? "unexpected");

        expect(cloned[1].block.payload).toMatchObject({
            condition: { expression: { ast: { target: { kind: "option", blockId: "option-copy" } } } },
        });
    });

    it("rebinds a page result and a repeat condition to a declaration copied later", () => {
        const ref = { scope: "scene" as const, variableId: "variable" };
        const page: StoryBlock = {
            id: "page", kind: "action", parentId: null, childrenIds: [],
            payload: { action: "page", surfaceId: "page-1", resultTarget: ref },
        };
        const repeat: StoryBlock = {
            id: "repeat", kind: "control", parentId: null, childrenIds: [],
            payload: { control: "repeat", until: { kind: "variable", target: ref, operator: "isTrue" } },
        };
        const declaration: StoryBlock = {
            id: "variable", kind: "declaration", parentId: null, childrenIds: [],
            payload: { scope: "scene", name: "done", valueType: "boolean", storageKey: "variable" },
        };
        const ids = ["page-copy", "repeat-copy", "variable-copy"];
        const cloned = cloneSerializedBlocks([
            { block: page, children: [] }, { block: repeat, children: [] }, { block: declaration, children: [] },
        ], () => ids.shift() ?? "unexpected");

        expect(cloned[0].block.payload).toMatchObject({ resultTarget: { variableId: "variable-copy" } });
        expect(cloned[1].block.payload).toMatchObject({ until: { target: { variableId: "variable-copy" } } });
    });
});

describe("cloning stage-object references", () => {
    it("keeps references to creators outside the copied selection", () => {
        const action: StoryBlock = {
            id: "control",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "audio",
                operation: "stopSound",
                target: { name: "piano", sourceBlockId: "outside" },
            },
        };
        const cloned = cloneSerializedBlocks([{ block: action, children: [] }], () => "copy");

        expect(cloned[0].block.payload).toMatchObject({ target: { sourceBlockId: "outside" } });
    });

    it("rebinds an action to a creator in another selected row", () => {
        const creator: StoryBlock = {
            id: "creator",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "audio", operation: "playSound", objectName: "piano", assetId: "clip" },
        };
        const action: StoryBlock = {
            id: "control",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "audio", operation: "stopSound", target: { name: "piano", sourceBlockId: "creator" } },
        };
        const ids = ["copied-creator", "copied-control"];
        const cloned = cloneSerializedBlocks([
            { block: creator, children: [] },
            { block: action, children: [] },
        ], () => ids.shift() ?? "unexpected");

        expect(cloned[1].block.payload).toMatchObject({ target: { sourceBlockId: cloned[0].block.id } });
        expect(action.payload).toMatchObject({ target: { sourceBlockId: "creator" } });
    });
});
