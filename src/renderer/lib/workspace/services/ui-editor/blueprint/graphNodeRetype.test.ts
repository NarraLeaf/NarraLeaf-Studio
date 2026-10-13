import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_RECT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY } from "@/lib/ui-editor/blueprint-nodes/types";
import { retypeBlueprintNodeInIr } from "./graphNodeRetype";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

const edge = (from: string, fromPort: string, to: string, toPort: string) => ({
    from: { nodeId: from, port: fromPort },
    to: { nodeId: to, port: toPort },
});

describe("retyping a node within its family", () => {
    it("keeps a comparison's wires and the number typed into it when the operator changes", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                cmp: {
                    id: "cmp",
                    type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
                    params: { a: 3, [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: ["a"] },
                    meta: { editorLayout: { x: 40, y: 80 } },
                },
                num: { id: "num", type: BLUEPRINT_NODE_TYPE_LITERAL_FLOAT, params: { value: 1 } },
                skip: { id: "skip", type: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED },
            },
            edges: [edge("num", "value", "cmp", "b"), edge("cmp", "result", "skip", "skip")],
        };

        expect(retypeBlueprintNodeInIr(ir, "cmp", BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN)).toBe(true);

        const node = ir.nodes!.cmp!;
        expect(node.type).toBe(BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN);
        expect(node.params).toEqual({ a: 3, [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: ["a"] });
        expect(node.meta).toEqual({ editorLayout: { x: 40, y: 80 } });
        expect(ir.edges).toEqual([edge("num", "value", "cmp", "b"), edge("cmp", "result", "skip", "skip")]);
    });

    it("drops a typed-in number the new member has no box for, and keeps the wires it can take", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                cmp: {
                    id: "cmp",
                    type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
                    params: { a: 3, [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: ["a"] },
                },
                num: { id: "num", type: BLUEPRINT_NODE_TYPE_LITERAL_FLOAT, params: { value: 1 } },
            },
            edges: [edge("num", "value", "cmp", "b")],
        };

        retypeBlueprintNodeInIr(ir, "cmp", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL);

        // Equal compares any two values and takes no number on the card.
        expect(ir.nodes!.cmp!.params).toEqual({});
        expect(ir.edges).toEqual([edge("num", "value", "cmp", "b")]);
    });

    it("moves a wire onto the preference the setter now names, and drops one of the wrong type", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                set: { id: "set", type: BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME },
                num: { id: "num", type: BLUEPRINT_NODE_TYPE_LITERAL_FLOAT, params: { value: 0.5 } },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
            },
            edges: [edge("num", "value", "set", "bgmVolume"), edge("set", "next", "log", "in")],
        };

        retypeBlueprintNodeInIr(ir, "set", BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME);
        expect(ir.edges).toEqual([edge("num", "value", "set", "soundVolume"), edge("set", "next", "log", "in")]);

        // Skip is on or off; a number cannot feed it.
        retypeBlueprintNodeInIr(ir, "set", BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED);
        expect(ir.edges).toEqual([edge("set", "next", "log", "in")]);
    });

    it("keeps a key head's key across Down and Up, and lets go of it for Any key", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN, params: { key: "Escape" } },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
            },
            edges: [edge("head", "then", "log", "in")],
        };

        retypeBlueprintNodeInIr(ir, "head", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP);
        expect(ir.nodes!.head!.params).toEqual({ key: "Escape" });

        retypeBlueprintNodeInIr(ir, "head", BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN);
        expect(ir.nodes!.head!.params).toEqual({});
        expect(ir.edges).toEqual([edge("head", "then", "log", "in")]);
    });

    it("drops the wire from Any key's key pin when the head goes back to a named key", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
                str: { id: "str", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "" } },
            },
            edges: [edge("head", "then", "log", "in"), edge("head", "key", "log", "value")],
        };

        retypeBlueprintNodeInIr(ir, "head", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN);

        expect(ir.nodes!.head!.type).toBe(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN);
        expect(ir.edges).toEqual([edge("head", "then", "log", "in")]);
    });

    it("starts a literal's value over when the new kind of value cannot hold it", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                lit: { id: "lit", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "abc" } },
            },
            edges: [],
        };

        retypeBlueprintNodeInIr(ir, "lit", BLUEPRINT_NODE_TYPE_LITERAL_INTEGER);
        expect(ir.nodes!.lit!.params).toEqual({ value: 0 });

        ir.nodes!.lit!.params = { value: 3 };
        retypeBlueprintNodeInIr(ir, "lit", BLUEPRINT_NODE_TYPE_LITERAL_FLOAT);
        expect(ir.nodes!.lit!.params).toEqual({ value: 3 });

        retypeBlueprintNodeInIr(ir, "lit", BLUEPRINT_NODE_TYPE_LITERAL_NULL);
        retypeBlueprintNodeInIr(ir, "lit", BLUEPRINT_NODE_TYPE_LITERAL_STRING);
        expect(ir.nodes!.lit!.params).toEqual({ value: "" });

        ir.nodes!.lit!.type = BLUEPRINT_NODE_TYPE_LITERAL_RECT;
        ir.nodes!.lit!.params = { value: { x: 1, y: 2, width: 3, height: 4 } };
        retypeBlueprintNodeInIr(ir, "lit", BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D);
        expect(ir.nodes!.lit!.params).toEqual({ value: { x: 0, y: 0 } });
    });

    it("keeps an Element node's element wire across its family", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                el: { id: "el", type: BLUEPRINT_NODE_TYPE_ELEMENT_REF },
                font: { id: "font", type: "blueprint.element.text.getFont" },
            },
            edges: [edge("el", "element", "font", "element")],
        };

        retypeBlueprintNodeInIr(ir, "font", "blueprint.element.text.getFontSize");

        expect(ir.nodes!.font!.type).toBe("blueprint.element.text.getFontSize");
        expect(ir.edges).toEqual([edge("el", "element", "font", "element")]);
    });

    it("changes nothing for a node that is missing or already that type", () => {
        const ir: BlueprintGraphIr = {
            nodes: { cmp: { id: "cmp", type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL } },
            edges: [],
        };
        expect(retypeBlueprintNodeInIr(ir, "cmp", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)).toBe(false);
        expect(retypeBlueprintNodeInIr(ir, "missing", BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)).toBe(false);
        expect(ir.nodes!.cmp!.type).toBe(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL);
    });
});
