import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_REPLACE,
} from "@shared/types/blueprint/graph";
import { setActiveUIPageParams } from "@shared/types/ui-editor/pageParams";
import type { UIPageParam } from "@shared/types/ui-editor/document";
import { executeGraph } from "../behavior-graph/GraphExecutor";
import type { UIHostAdapter } from "../runtime/types";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import { resolveEffectiveBlueprintNodePins, uiPageParamIdFromPin, uiPageParamPinId } from "./effectivePins";
import { resolveDataPinValue } from "./built-in/graphParamResolvers";

const CONFIRM_PARAMS: UIPageParam[] = [
    { id: "message", name: "message", type: "string" },
    { id: "count", name: "count", type: "number", defaultValue: 2 },
    { id: "loud", name: "loud", type: "boolean" },
    { id: "rows", name: "buttons", type: "json", defaultValue: [] },
];

function publish(params: UIPageParam[] = CONFIRM_PARAMS): void {
    setActiveUIPageParams([
        { id: "confirm", kind: "appSurface", params },
        { id: "plain", kind: "appSurface" },
    ]);
}

function def(type: string) {
    const found = blueprintNodeRegistry.get(type);
    if (!found) {
        throw new Error(`node not registered: ${type}`);
    }
    return found;
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

afterEach(() => {
    setActiveUIPageParams([]);
});

describe("page parameter inputs", () => {
    it("leaves a node that opens a page as it was when the page declares nothing", () => {
        publish();
        expect(resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_PAGE_GO), { surfaceId: "plain" }).map(pin => pin.id))
            .toEqual(["in", "surfaceId", "props"]);
        expect(resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_PAGE_GO), {}).map(pin => pin.id))
            .toEqual(["in", "surfaceId", "props"]);
    });

    it("grows one typed input per parameter of the picked page, in front of Page props", () => {
        publish();
        const pins = resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_PAGE_GO), { surfaceId: "confirm" });
        expect(pins.map(pin => pin.id)).toEqual([
            "in",
            "surfaceId",
            uiPageParamPinId("message"),
            uiPageParamPinId("count"),
            uiPageParamPinId("loud"),
            uiPageParamPinId("rows"),
            "props",
        ]);
        const grown = pins.filter(pin => uiPageParamIdFromPin(pin.id) !== null);
        expect(grown.map(pin => pin.label)).toEqual(["message", "count", "loud", "buttons"]);
        expect(grown.map(pin => pin.valueType)).toEqual(["string", "float", "boolean", "json"]);
        // Optional - the page reads the default - and fillable on the card where a kind can be typed.
        expect(grown.every(pin => pin.optional)).toBe(true);
        expect(grown.map(pin => Boolean(pin.allowInlineLiteral))).toEqual([true, true, true, false]);
    });

    it("grows the same inputs on Replace Page, Show Layer and Set Frame Page", () => {
        publish();
        const grownIds = (type: string, params: Record<string, unknown>) =>
            resolveEffectiveBlueprintNodePins(def(type), params)
                .map(pin => uiPageParamIdFromPin(pin.id))
                .filter(Boolean);
        const expected = ["message", "count", "loud", "rows"];
        expect(grownIds(BLUEPRINT_NODE_TYPE_PAGE_REPLACE, { surfaceId: "confirm" })).toEqual(expected);
        expect(grownIds(BLUEPRINT_NODE_TYPE_LAYER_SHOW, { surfaceId: "confirm" })).toEqual(expected);
        expect(grownIds(BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE, { targetSurfaceId: "confirm" })).toEqual(expected);
        expect(grownIds(BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE, { targetSurfaceId: "confirm" })).toEqual(expected);
    });

    it("keeps an input's id through a rename and relabels it", () => {
        publish();
        const before = resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_PAGE_GO), { surfaceId: "confirm" })
            .find(pin => uiPageParamIdFromPin(pin.id) === "message");
        publish([{ ...CONFIRM_PARAMS[0], name: "question" }, ...CONFIRM_PARAMS.slice(1)]);
        const after = resolveEffectiveBlueprintNodePins(def(BLUEPRINT_NODE_TYPE_PAGE_GO), { surfaceId: "confirm" })
            .find(pin => uiPageParamIdFromPin(pin.id) === "message");
        expect(after?.id).toBe(before?.id);
        expect(after?.label).toBe("question");
    });

    it("drops Get Page Param's key input once a parameter is picked", () => {
        const reader = def(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM);
        expect(resolveEffectiveBlueprintNodePins(reader, {}).map(pin => pin.id)).toEqual(["key", "value"]);
        expect(resolveEffectiveBlueprintNodePins(reader, { paramId: "message" }).map(pin => pin.id)).toEqual(["value"]);
    });
});

describe("opening a page with its parameters", () => {
    function host(opened: { surfaceId: string; props: unknown }[], shown: { surfaceId: string; props: unknown }[] = []) {
        return {
            host: "player",
            blueprintRuntime: {
                surfaceId: "caller",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    navigation: {
                        openSurface: async (surfaceId: string, props?: unknown) => {
                            opened.push({ surfaceId, props });
                        },
                        replaceSurface: async (surfaceId: string, props?: unknown) => {
                            opened.push({ surfaceId: `replace:${surfaceId}`, props });
                        },
                    },
                    layers: {
                        show: async (surfaceId: string, props: unknown) => {
                            shown.push({ surfaceId, props });
                            return "layer-1";
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
    }

    it("hands each given parameter over under its name, over the Page props input", async () => {
        publish();
        const opened: { surfaceId: string; props: unknown }[] = [];
        await executeGraph({
            graph: {
                id: "go",
                entries: { main: { start: { nodeId: "go", port: "in" } } },
                nodes: {
                    go: {
                        id: "go",
                        type: BLUEPRINT_NODE_TYPE_PAGE_GO,
                        // Typed on the card: a number given as text arrives as the number it says.
                        params: { surfaceId: "confirm", [uiPageParamPinId("count")]: "5" },
                    },
                    message: { id: "message", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "Quit?" } },
                    raw: { id: "raw", type: BLUEPRINT_NODE_TYPE_LITERAL_JSON, params: { value: { message: "old", extra: 1 } } },
                },
                edges: [
                    { from: { nodeId: "message", port: "value" }, to: { nodeId: "go", port: uiPageParamPinId("message") } },
                    { from: { nodeId: "raw", port: "value" }, to: { nodeId: "go", port: "props" } },
                ],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: host(opened),
        });
        // `loud` and `buttons` were given nothing, so they are left for the page's defaults.
        expect(opened).toEqual([{ surfaceId: "confirm", props: { message: "Quit?", extra: 1, count: 5 } }]);
    });

    it("gives the Page props input alone when nothing declared was given", async () => {
        publish();
        const opened: { surfaceId: string; props: unknown }[] = [];
        await executeGraph({
            graph: {
                id: "go",
                entries: { main: { start: { nodeId: "go", port: "in" } } },
                nodes: { go: { id: "go", type: BLUEPRINT_NODE_TYPE_PAGE_REPLACE, params: { surfaceId: "confirm" } } },
                edges: [],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: host(opened),
        });
        expect(opened).toEqual([{ surfaceId: "replace:confirm", props: undefined }]);
    });

    it("ignores the inputs when a different page arrives on the wire", async () => {
        // The inputs are the picked page's; another page's names are not answers to them.
        publish();
        const opened: { surfaceId: string; props: unknown }[] = [];
        await executeGraph({
            graph: {
                id: "go",
                entries: { main: { start: { nodeId: "go", port: "in" } } },
                nodes: {
                    go: { id: "go", type: BLUEPRINT_NODE_TYPE_PAGE_GO, params: { surfaceId: "confirm", [uiPageParamPinId("message")]: "Quit?" } },
                    target: { id: "target", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "plain" } },
                },
                edges: [{ from: { nodeId: "target", port: "value" }, to: { nodeId: "go", port: "surfaceId" } }],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: host(opened),
        });
        expect(opened).toEqual([{ surfaceId: "plain", props: undefined }]);
    });

    it("shows a layer with its parameters", async () => {
        publish();
        const shown: { surfaceId: string; props: unknown }[] = [];
        await executeGraph({
            graph: {
                id: "show",
                entries: { main: { start: { nodeId: "show", port: "in" } } },
                nodes: {
                    show: {
                        id: "show",
                        type: BLUEPRINT_NODE_TYPE_LAYER_SHOW,
                        params: { surfaceId: "confirm", [uiPageParamPinId("loud")]: true },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "show", port: "in" } },
            hostAdapter: host([], shown),
        });
        expect(shown).toEqual([{ surfaceId: "confirm", props: { loud: true } }]);
    });
});

describe("Get Page Param", () => {
    function reading(props: Record<string, unknown>, surfaceId = "confirm") {
        return {
            hostAdapter: {
                host: "player",
                blueprintRuntime: {
                    surfaceId,
                    hostApi: {
                        frame: {
                            getParam: (key: string) => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
                        },
                    },
                },
            } as unknown as UIHostAdapter,
        };
    }

    function read(paramId: string, props: Record<string, unknown>, surfaceId?: string): unknown {
        const graph = { nodes: { read: { type: BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM, params: { paramId } } }, edges: [] };
        return resolveDataPinValue(graph, "read", "value", { paramId }, undefined, 0, reading(props, surfaceId));
    }

    it("reads the value under the parameter's current name, in its type", () => {
        publish([{ id: "message", name: "question", type: "string" }, { id: "count", name: "count", type: "number" }]);
        expect(read("message", { question: "Quit?" })).toBe("Quit?");
        expect(read("count", { count: "7" })).toBe(7);
    });

    it("reads the declared default when the page was given nothing", () => {
        publish();
        expect(read("count", {})).toBe(2);
        expect(read("rows", {})).toEqual([]);
        expect(read("loud", {})).toBe(false);
    });

    it("reads null for a parameter the page no longer declares", () => {
        publish();
        expect(read("gone", { gone: "x" })).toBeNull();
        expect(read("message", { message: "x" }, "plain")).toBeNull();
    });
});
