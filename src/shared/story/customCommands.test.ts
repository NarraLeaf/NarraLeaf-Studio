import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "../types/story/document";
import type { StoryCustomCommand } from "../types/story/customCommands";
import {
    customCommandCallIdOf,
    customCommandCallProblem,
    customCommandLibrary,
    customCommandNameProblem,
    expandCustomCommandCall,
    expandStoryCustomCommandsInScene,
    normalizeStoryCustomCommandDocument,
} from "./customCommands";

function transformRow(id: string, x: number): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "displayable",
            target: { kind: "character", characterId: "probe" },
            operation: "transform",
            transform: { props: { x }, durationMs: 100 },
        },
    } as unknown as StoryBlock;
}

const shake: StoryCustomCommand = {
    id: "cmd-shake",
    name: "左右摇晃",
    params: [
        { name: "角色", source: { commandId: "transform", slot: "target" } },
        { name: "力度", source: { commandId: "transform", slot: "x" }, default: { kind: "number", value: 5 } },
    ],
    rows: [
        {
            block: transformRow("r1", -1),
            bindings: [
                { param: "角色", slot: { name: "target" }, path: ["target", "characterId"], map: { kind: "pick", from: ["target", "characterId"] } },
                { param: "力度", slot: { name: "x", negate: true }, path: ["transform", "props", "x"], map: { kind: "linear", from: ["value"], scale: -1, offset: 0 } },
            ],
        },
        {
            block: transformRow("r2", 1),
            bindings: [
                { param: "角色", slot: { name: "target" }, path: ["target", "characterId"], map: { kind: "pick", from: ["target", "characterId"] } },
                { param: "力度", slot: { name: "x" }, path: ["transform", "props", "x"], map: { kind: "linear", from: ["value"], scale: 1, offset: 0 } },
            ],
        },
    ],
};

function call(id: string, args: Record<string, unknown>, commandId = shake.id): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "customCommand", commandId, args },
    } as unknown as StoryBlock;
}

describe("custom command expansion", () => {
    const library = customCommandLibrary([shake]);
    const anyo = { kind: "target", target: { kind: "character", characterId: "anyo" } };

    it("writes the arguments into the command's rows, named under the call", () => {
        const { childrenIds, blocks } = expandCustomCommandCall(call("c1", { 角色: anyo, 力度: { kind: "number", value: 10 } }), library);
        expect(childrenIds).toEqual(["c1~r1", "c1~r2"]);
        expect(blocks.map(block => (block.payload as any).transform.props.x)).toEqual([-10, 10]);
        expect(blocks.map(block => (block.payload as any).target.characterId)).toEqual(["anyo", "anyo"]);
        expect(blocks.every(block => block.parentId === "c1")).toBe(true);
        // The command itself is left alone.
        expect((shake.rows[0].block.payload as any).transform.props.x).toBe(-1);
    });

    it("takes a parameter's default when the call leaves it out", () => {
        const { blocks } = expandCustomCommandCall(call("c1", { 角色: anyo }), library);
        expect(blocks.map(block => (block.payload as any).transform.props.x)).toEqual([-5, 5]);
    });

    it("plays nothing, and says why, when a required argument is missing", () => {
        expect(expandCustomCommandCall(call("c1", {}), library).blocks).toEqual([]);
        expect(customCommandCallProblem(call("c1", {}), library)).toEqual({ code: "missingArgs", params: ["角色"] });
        expect(customCommandCallProblem(call("c1", { 角色: anyo }, "gone"), library)).toEqual({ code: "unknownCommand" });
    });

    it("expands a nested call beneath its own row and stops a loop", () => {
        const outer: StoryCustomCommand = {
            id: "cmd-outer",
            name: "两次",
            params: [],
            rows: [{ block: call("n1", { 角色: anyo }), bindings: [] }],
        };
        const loop: StoryCustomCommand = { id: "cmd-loop", name: "循环", params: [], rows: [{ block: call("l1", {}, "cmd-loop"), bindings: [] }] };
        const lib = customCommandLibrary([shake, outer, loop]);
        const { blocks } = expandCustomCommandCall(call("c1", {}, "cmd-outer"), lib);
        expect(blocks.map(block => block.id)).toEqual(["c1~n1", "c1~n1~r1", "c1~n1~r2"]);
        expect(blocks[0].childrenIds).toEqual(["c1~n1~r1", "c1~n1~r2"]);
        expect(customCommandCallIdOf("c1~n1~r2")).toBe("c1");
        expect(customCommandCallProblem(call("c2", {}, "cmd-loop"), lib)).toEqual({ code: "recursion", commandName: "循环" });
        expect(expandCustomCommandCall(call("c2", {}, "cmd-loop"), lib).blocks.length).toBeLessThan(20);
    });

    it("hangs the rows under each call in a scene and leaves a scene without calls untouched", () => {
        const scene = {
            id: "s",
            name: "s",
            rootBlockIds: ["c1"],
            blocks: { c1: call("c1", { 角色: anyo }) },
        } as unknown as StoryScene;
        const expanded = expandStoryCustomCommandsInScene(scene, library);
        expect(expanded.blocks.c1.childrenIds).toEqual(["c1~r1", "c1~r2"]);
        expect(Object.keys(expanded.blocks)).toHaveLength(3);
        expect(scene.blocks.c1.childrenIds).toEqual([]);
        const plain = { ...scene, blocks: { r: transformRow("r", 0) } } as unknown as StoryScene;
        expect(expandStoryCustomCommandsInScene(plain, library)).toBe(plain);
    });
});

describe("custom command file", () => {
    it("drops what it cannot read, one command at a time", () => {
        const document = normalizeStoryCustomCommandDocument({
            schemaVersion: 1,
            commands: [shake, { id: "x" }, { ...shake, id: "dup-name" }, "junk"],
        });
        expect(document.commands.map(command => command.id)).toEqual(["cmd-shake"]);
        expect(document.commands[0].rows).toHaveLength(2);
    });

    it("refuses names the command line cannot read back", () => {
        expect(customCommandNameProblem("左右摇晃", [shake])).toBe("taken");
        expect(customCommandNameProblem("左右摇晃", [shake], shake.id)).toBeNull();
        expect(customCommandNameProblem("两 词", [])).toBe("invalid");
        expect(customCommandNameProblem("<x>", [])).toBe("invalid");
        expect(customCommandNameProblem("3d", [])).toBe("invalid");
        expect(customCommandNameProblem(" ", [])).toBe("empty");
        expect(customCommandNameProblem("Shake", [])).toBeNull();
    });
});

describe("sharing custom commands", () => {
    it("carries the commands a chosen one calls, and reads the file back", async () => {
        const { encodeStoryCommandExchange, decodeStoryCommandExchange } = await import("./libraryExchange");
        const outer: StoryCustomCommand = { id: "cmd-outer", name: "两次", params: [], rows: [{ block: call("n1", {}), bindings: [] }] };
        const text = encodeStoryCommandExchange([outer], [shake, outer]);
        const decoded = decodeStoryCommandExchange(text);
        expect(decoded.ok && decoded.items.map(item => item.name)).toEqual(["两次", "左右摇晃"]);
        expect(decodeStoryCommandExchange("{\"format\":\"narraleaf.library\",\"version\":1,\"kind\":\"transform-preset\",\"items\":[]}"))
            .toEqual({ ok: false, reason: "wrongKind" });
    });
});
