import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
    BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE,
    BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
    BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
    BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_FLOW_RETURN,
    BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FLOW_WHILE,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_RECT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_MATH_ABS,
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_MATH_CEIL,
    BLUEPRINT_NODE_TYPE_MATH_FLOOR,
    BLUEPRINT_NODE_TYPE_MATH_MAX,
    BLUEPRINT_NODE_TYPE_MATH_MIN,
    BLUEPRINT_NODE_TYPE_MATH_MODULO,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER,
    BLUEPRINT_NODE_TYPE_MATH_ROUND,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { isValidBlueprintPinConnection } from "../connectionPolicy";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintPersistentVariable } from "@shared/types/blueprint/document";
import { resolveSliderRuntimeValue, type UISliderRuntimeValue } from "@shared/types/ui-editor/slider";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { listBlueprintNodePaletteEntries } from "../../behavior-graph/nodeEditorCatalog";
import { booleanCompareBlueprintNodes } from "./booleanCompareNodes";
import { broadcastBlueprintNodes } from "./broadcastNodes";
import { controlFlowBlueprintNodes } from "./controlFlowNodes";
import { dataBlueprintNodes } from "./dataNodes";
import { devtoolsBlueprintNodes } from "./devtoolsNodes";
import { eventHeadBlueprintNodes } from "./events/eventHeadNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
import { resolveDataPinValue } from "./graphParamResolvers";
import { elementBlueprintNodes } from "./elementNodes";
import { sliderBlueprintNodes } from "./sliderNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";
import { imageAssetBlueprintNodes, widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";
import {
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
} from "@shared/types/blueprint/valueTypes";

function createPersistenceHostAdapter(store: Record<string, unknown>): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                navigation: {
                    openSurface: async () => undefined,
                    closeLayer: async () => undefined,
                },
                widget: {} as any,
                state: {
                    get: () => undefined,
                    set: () => undefined,
                },
                persistence: {
                    get: async (key: string) => store[key],
                    set: async (key: string, value: unknown) => {
                        if (value === undefined) {
                            delete store[key];
                        } else {
                            store[key] = value;
                        }
                    },
                },
                frame: {
                    getParam: () => undefined,
                    emit: async () => undefined,
                },
                devtools: {
                    log: () => undefined,
                },
            },
        },
    };
}

function createPageNavigationHostAdapter(
    openedSurfaceIds: string[],
    frameTargets: Record<string, string | null> = {},
    framePatches: Array<{ elementId: string; targetSurfaceId: string | null }> = [],
): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                navigation: {
                    openSurface: async (surfaceId: string) => {
                        openedSurfaceIds.push(surfaceId);
                    },
                    closeLayer: async () => undefined,
                },
                widget: {
                    getFrameProperties: (elementId: string) => ({
                        targetSurfaceId: frameTargets[elementId] ?? null,
                        params: {},
                    }),
                    setFrameProperties: async (
                        elementId: string,
                        patch: { targetSurfaceId?: string | null },
                    ) => {
                        if (patch.targetSurfaceId !== undefined) {
                            frameTargets[elementId] = patch.targetSurfaceId;
                            framePatches.push({ elementId, targetSurfaceId: patch.targetSurfaceId });
                        }
                    },
                } as any,
                state: {
                    get: () => undefined,
                    set: () => undefined,
                },
                persistence: {
                    get: async () => undefined,
                    set: async () => undefined,
                },
                frame: {
                    getParam: () => undefined,
                    emit: async () => undefined,
                },
                devtools: {
                    log: () => undefined,
                },
            },
        },
    };
}

describe("built-in blueprint nodes", () => {
    it("registers documented event, page, broadcast, string, text, slider, and debug nodes", () => {
        registerCoreBlueprintNodes();

        const types = new Set(blueprintNodeRegistry.list().map(def => def.type));

        for (const def of [
            ...eventHeadBlueprintNodes,
            ...broadcastBlueprintNodes,
            ...frameBlueprintNodes,
            ...controlFlowBlueprintNodes,
            ...dataBlueprintNodes,
            ...elementBlueprintNodes,
            ...localVariableBlueprintNodes,
            ...persistentVariableBlueprintNodes,
            ...booleanCompareBlueprintNodes,
            ...stringBlueprintNodes,
            ...textBlueprintNodes,
            ...sliderBlueprintNodes,
            ...widgetPropertyBlueprintNodes,
            ...devtoolsBlueprintNodes,
        ]) {
            expect(types.has(def.type)).toBe(true);
        }
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_SEND)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_EMIT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_NOOP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_WHILE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_RETURN)).toBe(true);
        expect(blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_FLOW_RETURN)?.displayName).toBe("Return");
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_COMMENT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_INTEGER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_NUMBER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_COLOR)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_RECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LITERAL_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_TO_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_NULL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_INT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_HAS)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_SET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_MODULO)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_ABS)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_MIN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_MAX)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_ROUND)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_FLOOR)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_CEIL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BOOLEAN_AND)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BOOLEAN_OR)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BOOLEAN_NOT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_BOOLEAN_XOR)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_STRING_TO_STRING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOCAL_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOCAL_SET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PERSISTENT_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PERSISTENT_SET)).toBe(true);
        expect([...types].some(type => type.startsWith("blueprint.persistence."))).toBe(false);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_REF)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE)).toBe(true);
        expect(blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE)?.displayName).toBe("Get Value");
        expect(types.has(BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(true);
    });

    it("defines filtered and any keyboard event head card fields and pins", () => {
        registerCoreBlueprintNodes();

        const onKeyDown = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN);
        const onKeyUp = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP);
        const anyKeyDown = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN);
        const anyKeyUp = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP);

        expect(onKeyDown?.displayName).toBe("On Key Down");
        expect(onKeyUp?.displayName).toBe("On Key Up");
        expect(onKeyDown?.inspectorParams).toEqual([
            { key: BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME, label: "Key", kind: "string" },
        ]);
        expect(onKeyDown?.pins.map(pin => pin.id)).toEqual(["then", "altKey", "ctrlKey", "shiftKey", "metaKey"]);
        expect(onKeyUp?.pins.map(pin => pin.id)).toEqual(["then", "altKey", "ctrlKey", "shiftKey", "metaKey"]);

        expect(anyKeyDown?.displayName).toBe("Any Key Down");
        expect(anyKeyUp?.displayName).toBe("Any Key Up");
        expect(anyKeyDown?.inspectorParams).toBeUndefined();
        expect(anyKeyDown?.pins.map(pin => pin.id)).toEqual([
            "then",
            "key",
            "altKey",
            "ctrlKey",
            "shiftKey",
            "metaKey",
        ]);
        expect(anyKeyUp?.pins.map(pin => pin.id)).toEqual([
            "then",
            "key",
            "altKey",
            "ctrlKey",
            "shiftKey",
            "metaKey",
        ]);
    });

    it("keeps the Variables category scoped to variable access nodes", () => {
        registerCoreBlueprintNodes();

        const variableTypes = blueprintNodeRegistry
            .list()
            .filter(def => def.category === "Variables")
            .map(def => def.type)
            .sort();

        expect(variableTypes).toEqual([
            BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
            BLUEPRINT_NODE_TYPE_LOCAL_GET,
            BLUEPRINT_NODE_TYPE_LOCAL_SET,
            BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
            BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
        ].sort());
    });

    it("registers Var as a pinless blueprint-scope declaration node", () => {
        registerCoreBlueprintNodes();

        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR);
        expect(def).toMatchObject({
            displayName: "Var",
            category: "Variables",
            isPure: true,
            pins: [],
        });
        expect(def?.inspectorParams?.map(param => param.key)).toEqual(["name", "valueType", "defaultValue"]);

        const widgetPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );
        const globalPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "globalMain" },
            }).map(entry => entry.type),
        );
        const valuePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: {
                    kind: "widgetValue",
                    surfaceId: "surface",
                    elementId: "text",
                    propPath: "props.text",
                },
                isBlueprintValueGraph: true,
            }).map(entry => entry.type),
        );

        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(false);
    });

    it("projects Get Var and Set Var value pins from the selected variable type", () => {
        registerCoreBlueprintNodes();

        const getEntry = blueprintNodeRegistry.resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_LOCAL_GET, {
            variableId: "score",
            [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "integer",
        });
        const setEntry = blueprintNodeRegistry.resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_LOCAL_SET, {
            variableId: "score",
            [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "integer",
        });

        expect(getEntry.pins.find(pin => pin.id === "value")?.valueType).toBe("integer");
        expect(setEntry.pins.find(pin => pin.id === "value")?.valueType).toBe("integer");
    });

    it("executes persistent variable get/set through the host store", async () => {
        registerCoreBlueprintNodes();

        const persistentVariables: Record<string, BlueprintPersistentVariable> = {
            volume: {
                id: "volume",
                name: "Volume",
                valueType: "number",
                defaultValue: 7,
                storageKey: "settings.volume",
            },
        };

        const store: Record<string, unknown> = { "settings.volume": 42 };
        const localsFromStored: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "getStored",
                entries: { main: { start: { nodeId: "get", port: "in" } } },
                nodes: {
                    get: {
                        id: "get",
                        type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                        params: { persistentVariableId: "volume" },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "captured" },
                    },
                },
                edges: [
                    { from: { nodeId: "get", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "get", port: "value" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createPersistenceHostAdapter(store),
            blueprintLocals: localsFromStored,
            persistentVariables,
        });
        expect(localsFromStored.captured).toBe(42);

        delete store["settings.volume"];
        const localsFromDefault: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "getDefault",
                entries: { main: { start: { nodeId: "get", port: "in" } } },
                nodes: {
                    get: {
                        id: "get",
                        type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                        params: { persistentVariableId: "volume" },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "captured" },
                    },
                },
                edges: [
                    { from: { nodeId: "get", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "get", port: "value" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createPersistenceHostAdapter(store),
            blueprintLocals: localsFromDefault,
            persistentVariables,
        });
        expect(localsFromDefault.captured).toBe(7);
        expect(store["settings.volume"]).toBeUndefined();

        await executeGraph({
            graph: {
                id: "setPersistent",
                entries: { main: { start: { nodeId: "set", port: "in" } } },
                nodes: {
                    set: {
                        id: "set",
                        type: BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
                        params: { persistentVariableId: "volume" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                        params: { value: 11 },
                    },
                },
                edges: [
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "set", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createPersistenceHostAdapter(store),
            persistentVariables,
        });
        expect(store["settings.volume"]).toBe(11);
    });

    it("executes Page navigation and Frame page switching through host APIs", async () => {
        registerCoreBlueprintNodes();

        const openedSurfaceIds: string[] = [];
        const localsAfterGoPage: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "goPage",
                entries: { main: { start: { nodeId: "go", port: "in" } } },
                nodes: {
                    go: {
                        id: "go",
                        type: BLUEPRINT_NODE_TYPE_PAGE_GO,
                        params: { surfaceId: "target-page" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterGoPage" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "go", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter(openedSurfaceIds),
            blueprintLocals: localsAfterGoPage,
        });
        expect(openedSurfaceIds).toEqual(["target-page"]);
        expect(localsAfterGoPage).not.toHaveProperty("afterGoPage");

        const framePatches: Array<{ elementId: string; targetSurfaceId: string | null }> = [];
        await executeGraph({
            graph: {
                id: "setPage",
                entries: { main: { start: { nodeId: "set", port: "in" } } },
                nodes: {
                    set: {
                        id: "set",
                        type: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
                        params: { targetSurfaceId: "embedded-page" },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], {}, framePatches),
            executionOwner: { surfaceId: "surface", elementId: "frame" },
        });
        expect(framePatches).toEqual([{ elementId: "frame", targetSurfaceId: "embedded-page" }]);
    });

    it("uses class.md palette categories for the new node groups", () => {
        registerCoreBlueprintNodes();

        expect(eventHeadBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(broadcastBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(frameBlueprintNodes.every(def => def.category === "Page")).toBe(true);
        expect(frameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_GO)?.pins.map(pin => pin.id)).toEqual([
            "in",
        ]);
        expect(controlFlowBlueprintNodes.every(def => def.category === "Flow")).toBe(true);
        expect(localVariableBlueprintNodes.every(def => def.category === "Variables")).toBe(true);
        expect(persistentVariableBlueprintNodes.every(def => def.category === "Variables")).toBe(true);
        expect(dataBlueprintNodes.every(def => def.category === "Data")).toBe(true);
        expect(booleanCompareBlueprintNodes.every(def => def.category === "Math")).toBe(true);
        expect(devtoolsBlueprintNodes.every(def => def.category === "Debug")).toBe(true);
        expect(stringBlueprintNodes.every(def => def.category === "Data")).toBe(true);
        expect(textBlueprintNodes.every(def => def.category === "Text")).toBe(true);
        expect(sliderBlueprintNodes.some(def => def.category === "Slider")).toBe(true);
        expect(sliderBlueprintNodes.some(def => def.category === "Element")).toBe(true);
        expect(imageAssetBlueprintNodes.every(def => def.category === "Image")).toBe(true);
        expect(widgetPropertyBlueprintNodes.some(def => def.category === "Image")).toBe(true);
        const frameSetPage = widgetPropertyBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE);
        const elementFrameSetPage = widgetPropertyBlueprintNodes.find(
            def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
        );
        expect(frameSetPage?.category).toBe("Frame");
        expect(elementFrameSetPage?.category).toBe("Element");
        expect(frameSetPage?.pins.map(pin => pin.id)).toEqual(["in", "next"]);
        expect(elementFrameSetPage?.pins.map(pin => pin.id)).toEqual(["in", "next", "element"]);
        expect(frameSetPage?.inspectorParams).toEqual([
            {
                key: "targetSurfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ]);
        expect(elementFrameSetPage?.inspectorParams).toEqual(frameSetPage?.inspectorParams);
        expect(elementBlueprintNodes.some(def => def.category === "Element")).toBe(true);
        expect(elementBlueprintNodes.some(def => def.category === "Displayable")).toBe(true);
    });

    it("keeps structured literal editor metadata locked to fixed schemas", () => {
        const stringLiteral = dataBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_LITERAL_STRING);
        const rectLiteral = dataBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_LITERAL_RECT);

        expect(stringLiteral?.displayName).toBe("String");
        expect(stringLiteral?.pins.find(pin => pin.id === "value")?.label).toBe("String");
        expect(stringLiteral?.inspectorParams?.[0]).toMatchObject({ key: "value", label: "String", kind: "string" });
        expect(rectLiteral?.inspectorParams?.[0]).toMatchObject({
            key: "value",
            label: "Rect",
            kind: "json",
            jsonSchema: {
                kind: "object",
                allowExtraFields: false,
                fields: [
                    { key: "x", label: "X", kind: "number", required: true },
                    { key: "y", label: "Y", kind: "number", required: true },
                    { key: "width", label: "Width", kind: "number", required: true },
                    { key: "height", label: "Height", kind: "number", required: true },
                ],
            },
        });
    });

    it("resolves Data literals and explicit conversions", () => {
        registerCoreBlueprintNodes();

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                            params: { value: 12.7 },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: 12.7 },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
                            params: { value: 12.7 },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: 12.7 },
                undefined,
            ),
        ).toBe(12);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
                            params: { value: 12.7 },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: 12.7 },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
                            params: { value: "#ff00aa" },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: "#ff00aa" },
                undefined,
            ),
        ).toEqual({ r: 255, g: 0, b: 170, a: 1 });

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
                            params: { value: { x: 10, y: 20 } },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: { x: 10, y: 20 } },
                undefined,
            ),
        ).toEqual({ x: 10, y: 20 });

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        value: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_RECT,
                            params: { value: { x: 1, y: 2, width: 3, height: 4 } },
                        },
                    },
                    edges: [],
                },
                "value",
                "value",
                { value: { x: 1, y: 2, width: 3, height: 4 } },
                undefined,
            ),
        ).toEqual({ x: 1, y: 2, width: 3, height: 4 });

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        convert: {
                            type: BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
                            params: { value: "12.7" },
                        },
                    },
                    edges: [],
                },
                "convert",
                "result",
                { value: "12.7" },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        convert: {
                            type: BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
                            params: { value: "{\"ok\":true}" },
                        },
                    },
                    edges: [],
                },
                "convert",
                "result",
                { value: "{\"ok\":true}" },
                undefined,
            ),
        ).toEqual({ ok: true });

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        parse: {
                            type: BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
                            params: { value: "12.7px" },
                        },
                    },
                    edges: [],
                },
                "parse",
                "result",
                { value: "12.7px" },
                undefined,
            ),
        ).toBe(12);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        parse: {
                            type: BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
                            params: { value: "12.7px" },
                        },
                    },
                    edges: [],
                },
                "parse",
                "result",
                { value: "12.7px" },
                undefined,
            ),
        ).toBe(12.7);

        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_STRING, params: { value: "Ada" } } },
                    edges: [],
                },
                "check",
                "result",
                { value: "Ada" },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER, params: { value: 42 } } },
                    edges: [],
                },
                "check",
                "result",
                { value: 42 },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN, params: { value: false } } },
                    edges: [],
                },
                "check",
                "result",
                { value: false },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY, params: { value: [] } } },
                    edges: [],
                },
                "check",
                "result",
                { value: [] },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT, params: { value: {} } } },
                    edges: [],
                },
                "check",
                "result",
                { value: {} },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_NULL, params: { value: null } } },
                    edges: [],
                },
                "check",
                "result",
                { value: null },
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE, params: { value: {} } } },
                    edges: [],
                },
                "check",
                "result",
                { value: {} },
                undefined,
            ),
        ).toBe(true);
    });

    it("coerces numeric outputs when consumed by string inputs", () => {
        registerCoreBlueprintNodes();

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        number: {
                            type: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                            params: { value: 12.7 },
                        },
                        stringify: {
                            type: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "number", port: "value" },
                            to: { nodeId: "stringify", port: "value" },
                        },
                    ],
                },
                "stringify",
                "value",
                {},
                undefined,
            ),
        ).toBe("12.7");
    });

    it("resolves JSON parse, path read, existence, and stringify nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                parse: {
                    type: BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
                    params: { value: "{\"user\":{\"profile\":{\"name\":\"Ada\"}},\"items\":[10,20]}" },
                },
                getName: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: "user.profile.name" },
                },
                getArrayItem: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
                    params: { path: "items.1" },
                },
                hasName: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
                    params: { path: "user.profile.name" },
                },
                stringify: {
                    type: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
                    params: { value: { ok: true } },
                },
            },
            edges: [
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "getName", port: "json" } },
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "getArrayItem", port: "json" } },
                { from: { nodeId: "parse", port: "result" }, to: { nodeId: "hasName", port: "json" } },
            ],
        };

        expect(resolveDataPinValue(graph, "parse", "result", graph.nodes.parse.params, undefined)).toEqual({
            user: { profile: { name: "Ada" } },
            items: [10, 20],
        });
        expect(resolveDataPinValue(graph, "getName", "result", graph.nodes.getName.params, undefined)).toBe("Ada");
        expect(resolveDataPinValue(graph, "getArrayItem", "result", graph.nodes.getArrayItem.params, undefined)).toBe(20);
        expect(resolveDataPinValue(graph, "hasName", "result", graph.nodes.hasName.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "stringify", "result", graph.nodes.stringify.params, undefined)).toBe(
            "{\"ok\":true}",
        );
    });

    it("resolves JSON make object, make array, and array length nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                object: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
                    params: {
                        __jsonObjectInputPins: [
                            "field_1_name",
                            "field_1_value",
                            "field_2_name",
                            "field_2_value",
                        ],
                        field_1_name: "name",
                        field_1_value: "Ada",
                        field_2_name: "score",
                        field_2_value: 42,
                    },
                },
                legacyObject: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
                    params: {
                        __jsonObjectInputPins: ["field_1", "field_2"],
                        __jsonObjectFieldNames: { field_1: "legacyName", field_2: "legacyScore" },
                        field_1: "Ada",
                        field_2: 42,
                    },
                },
                array: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
                    params: {
                        __jsonArrayInputPins: ["item_1", "item_2"],
                        item_1: true,
                    },
                },
                length: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
                    params: {},
                },
            },
            edges: [{ from: { nodeId: "array", port: "result" }, to: { nodeId: "length", port: "value" } }],
        };

        expect(resolveDataPinValue(graph, "object", "result", graph.nodes.object.params, undefined)).toEqual({
            name: "Ada",
            score: 42,
        });
        expect(resolveDataPinValue(graph, "legacyObject", "result", graph.nodes.legacyObject.params, undefined)).toEqual({
            legacyName: "Ada",
            legacyScore: 42,
        });
        expect(resolveDataPinValue(graph, "array", "result", graph.nodes.array.params, undefined)).toEqual([
            true,
            null,
        ]);
        expect(resolveDataPinValue(graph, "length", "length", graph.nodes.length.params, undefined)).toBe(2);
    });

    it("resolves JSON set, remove, merge object, and clone nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                set: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
                    params: {
                        json: { user: { name: "Ada" }, items: [10] },
                        path: "user.score",
                        value: 42,
                    },
                },
                remove: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
                    params: {
                        json: { user: { name: "Ada", score: 42 }, items: [10, 20] },
                        path: "items.0",
                    },
                },
                merge: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
                    params: {
                        a: { name: "Ada", score: 1 },
                        b: { score: 42, ok: true },
                    },
                },
                clone: {
                    type: BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
                    params: {
                        value: { nested: { enabled: true } },
                    },
                },
            },
            edges: [],
        };

        expect(resolveDataPinValue(graph, "set", "result", graph.nodes.set.params, undefined)).toEqual({
            user: { name: "Ada", score: 42 },
            items: [10],
        });
        expect(resolveDataPinValue(graph, "remove", "result", graph.nodes.remove.params, undefined)).toEqual({
            user: { name: "Ada", score: 42 },
            items: [20],
        });
        expect(resolveDataPinValue(graph, "merge", "result", graph.nodes.merge.params, undefined)).toEqual({
            name: "Ada",
            score: 42,
            ok: true,
        });
        const cloned = resolveDataPinValue(graph, "clone", "result", graph.nodes.clone.params, undefined);
        expect(cloned).toEqual({ nested: { enabled: true } });
        expect(cloned).not.toBe(graph.nodes.clone.params.value);
    });

    it("keeps JSON pin compatibility strict while allowing numeric values into string inputs", () => {
        registerCoreBlueprintNodes();

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
                targetPort: "value",
            }),
        ).toBe(false);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
                sourcePort: "result",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_MATH_ADD,
                targetPort: "a",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
                targetPort: "color",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(false);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
                targetPort: "value",
            }),
        ).toBe(false);
    });

    it("connects generic and typed Element refs while rejecting nonmatching typed refs", () => {
        registerCoreBlueprintNodes();

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                sourcePort: "element",
                sourceParams: { surfaceId: "surface", elementId: "text", elementType: "nl.text" },
                targetType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
                targetPort: "element",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                sourcePort: "element",
                sourceParams: { surfaceId: "surface", elementId: "slider", elementType: "nl.slider" },
                targetType: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
                targetPort: "element",
            }),
        ).toBe(false);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                sourcePort: "element",
                sourceParams: { surfaceId: "surface", elementId: "text", elementType: "nl.text" },
                targetType: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
                targetPort: "element",
            }),
        ).toBe(true);
    });

    it("exposes element-derived palette entries only after a bound Element Literal is present", () => {
        registerCoreBlueprintNodes();

        const baseEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [],
        });
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_REF)).toBe(true);
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT)).toBe(false);
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE)).toBe(false);

        const derivedEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [
                {
                    sourceNodeId: "element-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "text",
                    elementType: "nl.text",
                    label: "Title",
                },
            ],
        });
        const getTextEntry = derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT);
        expect(getTextEntry?.magicElementRef).toMatchObject({
            sourceNodeId: "element-ref",
            sourcePortId: "element",
            targetPortId: "element",
        });
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT)).toBe(true);
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE)).toBe(true);
    });

    it("exposes Set Frame Page as an Element-category derived element entry", () => {
        registerCoreBlueprintNodes();

        const baseEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [],
        });
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE)).toBe(false);

        const derivedEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [
                {
                    sourceNodeId: "frame-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "frame",
                    elementType: "nl.frame",
                    label: "Dialog Frame",
                },
            ],
        });
        const setPage = derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE);
        expect(setPage).toMatchObject({
            category: "Element",
            displayName: "Set Frame Page",
        });
        expect(setPage?.pins.map(pin => pin.id)).toEqual(["in", "next", "element"]);
        expect(setPage?.inspectorParams).toEqual([
            {
                key: "targetSurfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: "surfaces",
            },
        ]);
        expect(setPage?.magicElementRef).toMatchObject({
            sourceNodeId: "frame-ref",
            sourcePortId: "element",
            targetPortId: "element",
        });
    });

    it("scopes ImageAsset nodes to Image owners or bound Image elements", () => {
        registerCoreBlueprintNodes();

        const surfaceEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [],
        });
        expect(surfaceEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL)).toBe(false);
        expect(surfaceEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET)).toBe(false);

        const imageOwnerEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "image" },
            widgetElementType: "nl.image",
            magicElementRefs: [],
        });
        expect(imageOwnerEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL)).toBe(true);
        const setSelf = imageOwnerEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET);
        expect(setSelf?.pins.find(pin => pin.id === "asset")).toMatchObject({
            valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
            allowInlineLiteral: true,
        });

        const derivedEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [
                {
                    sourceNodeId: "element-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "image",
                    elementType: "nl.image",
                    label: "Poster",
                },
            ],
        });
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL)).toBe(true);
        const getImage = derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET);
        expect(getImage?.category).toBe("Image");
        expect(getImage?.pins.find(pin => pin.id === "asset")).toMatchObject({
            valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
        });
    });

    it("connects ImageAsset literals to Set Image Asset and keeps legacy string compatibility", () => {
        registerCoreBlueprintNodes();

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                targetPort: "asset",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                sourcePort: "value",
                targetType: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                targetPort: "asset",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET,
                sourcePort: "asset",
                targetType: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                targetPort: "asset",
            }),
        ).toBe(true);
    });

    it("resolves ImageAsset literal values", () => {
        registerCoreBlueprintNodes();

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        asset: {
                            type: BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
                            params: { asset: { kind: "imageAsset", assetId: "img-1" } },
                        },
                    },
                    edges: [],
                },
                "asset",
                "value",
                { asset: { kind: "imageAsset", assetId: "img-1" } },
                undefined,
            ),
        ).toEqual({ kind: "imageAsset", assetId: "img-1" });
    });

    it("resolves completed Math, Boolean, and Compare nodes", () => {
        registerCoreBlueprintNodes();

        const graph = {
            nodes: {
                modulo: { type: BLUEPRINT_NODE_TYPE_MATH_MODULO, params: { a: 10, b: 3 } },
                abs: { type: BLUEPRINT_NODE_TYPE_MATH_ABS, params: { value: -4 } },
                min: {
                    type: BLUEPRINT_NODE_TYPE_MATH_MIN,
                    params: { a: 5, b: 3, __dynamicInputPinIds: ["in_1"], in_1: 1 },
                },
                max: {
                    type: BLUEPRINT_NODE_TYPE_MATH_MAX,
                    params: { a: 5, b: 3, __dynamicInputPinIds: ["in_1"], in_1: 9 },
                },
                round: { type: BLUEPRINT_NODE_TYPE_MATH_ROUND, params: { value: 2.6 } },
                floor: { type: BLUEPRINT_NODE_TYPE_MATH_FLOOR, params: { value: 2.6 } },
                ceil: { type: BLUEPRINT_NODE_TYPE_MATH_CEIL, params: { value: 2.1 } },
                randomFloat: { type: BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT, params: { min: 2, max: 4 } },
                randomInteger: { type: BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER, params: { min: 2, max: 4 } },
                and: { type: BLUEPRINT_NODE_TYPE_BOOLEAN_AND, params: { a: true, b: false } },
                or: { type: BLUEPRINT_NODE_TYPE_BOOLEAN_OR, params: { a: true, b: false } },
                not: { type: BLUEPRINT_NODE_TYPE_BOOLEAN_NOT, params: { a: false } },
                xor: { type: BLUEPRINT_NODE_TYPE_BOOLEAN_XOR, params: { a: true, b: false } },
                equalStrict: { type: BLUEPRINT_NODE_TYPE_COMPARE_EQUAL, params: { a: 1, b: "1" } },
                notEqualStrict: { type: BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL, params: { a: 1, b: "1" } },
                greater: { type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN, params: { a: 4, b: 2 } },
                greaterEqual: { type: BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL, params: { a: 2, b: 2 } },
                less: { type: BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN, params: { a: 1, b: 2 } },
                lessEqual: { type: BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL, params: { a: 2, b: 2 } },
            },
            edges: [],
        };

        expect(resolveDataPinValue(graph, "modulo", "result", graph.nodes.modulo.params, undefined)).toBe(1);
        expect(resolveDataPinValue(graph, "abs", "result", graph.nodes.abs.params, undefined)).toBe(4);
        expect(resolveDataPinValue(graph, "min", "result", graph.nodes.min.params, undefined)).toBe(1);
        expect(resolveDataPinValue(graph, "max", "result", graph.nodes.max.params, undefined)).toBe(9);
        expect(resolveDataPinValue(graph, "round", "result", graph.nodes.round.params, undefined)).toBe(3);
        expect(resolveDataPinValue(graph, "floor", "result", graph.nodes.floor.params, undefined)).toBe(2);
        expect(resolveDataPinValue(graph, "ceil", "result", graph.nodes.ceil.params, undefined)).toBe(3);

        const randomFloat = resolveDataPinValue(
            graph,
            "randomFloat",
            "result",
            graph.nodes.randomFloat.params,
            undefined,
        );
        expect(typeof randomFloat).toBe("number");
        expect(randomFloat as number).toBeGreaterThanOrEqual(2);
        expect(randomFloat as number).toBeLessThanOrEqual(4);

        const randomInteger = resolveDataPinValue(
            graph,
            "randomInteger",
            "result",
            graph.nodes.randomInteger.params,
            undefined,
        );
        expect(Number.isInteger(randomInteger)).toBe(true);
        expect(randomInteger as number).toBeGreaterThanOrEqual(2);
        expect(randomInteger as number).toBeLessThanOrEqual(4);

        expect(resolveDataPinValue(graph, "and", "result", graph.nodes.and.params, undefined)).toBe(false);
        expect(resolveDataPinValue(graph, "or", "result", graph.nodes.or.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "not", "result", graph.nodes.not.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "xor", "result", graph.nodes.xor.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "equalStrict", "result", graph.nodes.equalStrict.params, undefined)).toBe(false);
        expect(resolveDataPinValue(graph, "notEqualStrict", "result", graph.nodes.notEqualStrict.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "greater", "result", graph.nodes.greater.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "greaterEqual", "result", graph.nodes.greaterEqual.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "less", "result", graph.nodes.less.params, undefined)).toBe(true);
        expect(resolveDataPinValue(graph, "lessEqual", "result", graph.nodes.lessEqual.params, undefined)).toBe(true);
    });

    it("exposes and executes the If flow node", () => {
        registerCoreBlueprintNodes();

        const eventPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );
        const functionPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "function",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );

        expect(eventPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(eventPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE)).toBe(true);
        expect(functionPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(false);
        expect(functionPaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE)).toBe(false);

        const ifNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_IF)!;
        expect(
            ifNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "branch", port: "in" } } },
                    nodes: {
                        condition: {
                            id: "condition",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                            params: { value: "true" },
                        },
                        branch: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF, params: {} },
                    },
                    edges: [
                        {
                            from: { nodeId: "condition", port: "value" },
                            to: { nodeId: "branch", port: "condition" },
                        },
                    ],
                },
                entry: { start: { nodeId: "branch", port: "in" } },
                node: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF, params: {} },
                params: {},
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "true" });

        const ifElseNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE)!;
        expect(
            ifElseNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "branch", port: "in" } } },
                    nodes: {
                        branch: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE, params: { condition: false } },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "branch", port: "in" } },
                node: { id: "branch", type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE, params: { condition: false } },
                params: { condition: false },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "else" });

        const ifElseCatalog = blueprintNodeRegistry.resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE, {
            __ifElseBranchPins: ["if_1_condition", "if_1_then"],
        });
        expect(ifElseCatalog.dynamicInputPinAddLabel).toBe("Add If condition");
        expect(ifElseCatalog.pins.map(pin => pin.id)).toEqual(["in", "condition", "if_1_condition", "then", "if_1_then", "else"]);

        expect(
            ifElseNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "branch", port: "in" } } },
                    nodes: {
                        firstCondition: {
                            id: "firstCondition",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                            params: { value: "false" },
                        },
                        secondCondition: {
                            id: "secondCondition",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                            params: { value: "true" },
                        },
                        branch: {
                            id: "branch",
                            type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
                            params: { __ifElseBranchPins: ["if_1_condition", "if_1_then"] },
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "firstCondition", port: "value" },
                            to: { nodeId: "branch", port: "condition" },
                        },
                        {
                            from: { nodeId: "secondCondition", port: "value" },
                            to: { nodeId: "branch", port: "if_1_condition" },
                        },
                    ],
                },
                entry: { start: { nodeId: "branch", port: "in" } },
                node: {
                    id: "branch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
                    params: { __ifElseBranchPins: ["if_1_condition", "if_1_then"] },
                },
                params: { __ifElseBranchPins: ["if_1_condition", "if_1_then"] },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "if_1_then" });
    });

    it("executes string switch, bounded loops, and zero-duration delay flow nodes", async () => {
        registerCoreBlueprintNodes();

        const switchNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING)!;
        expect(
            switchNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "switch", port: "in" } } },
                    nodes: {
                        switch: {
                            id: "switch",
                            type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                            params: { value: "menu", case0Value: "title", case1Value: "menu" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "switch", port: "in" } },
                node: {
                    id: "switch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                    params: { value: "menu", case0Value: "title", case1Value: "menu" },
                },
                params: { value: "menu", case0Value: "title", case1Value: "menu" },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "case1" });

        const sequenceEntered: string[] = [];
        await executeGraph({
            graph: {
                id: "sequenceGraph",
                entries: { main: { start: { nodeId: "sequence", port: "in" } } },
                nodes: {
                    sequence: { id: "sequence", type: BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE, params: {} },
                    first: { id: "first", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
                    second: { id: "second", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
                },
                edges: [
                    { from: { nodeId: "sequence", port: "then0" }, to: { nodeId: "first", port: "in" } },
                    { from: { nodeId: "sequence", port: "then1" }, to: { nodeId: "second", port: "in" } },
                ],
            },
            entry: { start: { nodeId: "sequence", port: "in" } },
            hostAdapter: { host: "player" as const },
            trace: {
                executionId: "sequence",
                graphId: "sequenceGraph",
                emit: event => {
                    if (event.type === "node.enter") {
                        sequenceEntered.push(event.nodeId);
                    }
                },
            },
        });
        expect(sequenceEntered).toEqual(["sequence", "first", "second"]);

        const returnEntered: string[] = [];
        await executeGraph({
            graph: {
                id: "returnGraph",
                entries: { main: { start: { nodeId: "sequence", port: "in" } } },
                nodes: {
                    sequence: { id: "sequence", type: BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE, params: {} },
                    stop: { id: "stop", type: BLUEPRINT_NODE_TYPE_FLOW_RETURN, params: {} },
                    skipped: { id: "skipped", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
                },
                edges: [
                    { from: { nodeId: "sequence", port: "then0" }, to: { nodeId: "stop", port: "in" } },
                    { from: { nodeId: "sequence", port: "then1" }, to: { nodeId: "skipped", port: "in" } },
                ],
            },
            entry: { start: { nodeId: "sequence", port: "in" } },
            hostAdapter: { host: "player" as const },
            trace: {
                executionId: "return",
                graphId: "returnGraph",
                emit: event => {
                    if (event.type === "node.enter") {
                        returnEntered.push(event.nodeId);
                    }
                },
            },
        });
        expect(returnEntered).toEqual(["sequence", "stop"]);

        const loopLocals: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "loopGraph",
                entries: { main: { start: { nodeId: "loop", port: "in" } } },
                nodes: {
                    loop: {
                        id: "loop",
                        type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
                        params: { start: 0, end: 2, step: 1, maxIterations: 10 },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "lastIndex" },
                    },
                    done: { id: "done", type: BLUEPRINT_NODE_TYPE_FLOW_NOOP, params: {} },
                },
                edges: [
                    { from: { nodeId: "loop", port: "loop" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "loop", port: "index" }, to: { nodeId: "capture", port: "value" } },
                    { from: { nodeId: "capture", port: "next" }, to: { nodeId: "loop", port: "in" } },
                    { from: { nodeId: "loop", port: "completed" }, to: { nodeId: "done", port: "in" } },
                ],
            },
            entry: { start: { nodeId: "loop", port: "in" } },
            hostAdapter: { host: "player" as const },
            blueprintLocals: loopLocals,
            maxSteps: 20,
        });
        expect(loopLocals.lastIndex).toBe(2);

        const forEachNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH)!;
        const forEachLocals: Record<string, unknown> = {};
        expect(
            forEachNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "each", port: "in" } } },
                    nodes: {
                        each: {
                            id: "each",
                            type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
                            params: { items: ["a", "b"], maxIterations: 10 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "each", port: "in" } },
                node: {
                    id: "each",
                    type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
                    params: { items: ["a", "b"], maxIterations: 10 },
                },
                params: { items: ["a", "b"], maxIterations: 10 },
                hostAdapter: { host: "player" },
                blueprintLocals: forEachLocals,
            }),
        ).toEqual({ nextPort: "loop", outputValues: { item: "a", index: 0 } });

        const whileNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_WHILE)!;
        const whileLocals: Record<string, unknown> = {};
        const whileContext = {
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "while", port: "in" } } },
                nodes: {
                    condition: {
                        id: "condition",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                        params: { value: true },
                    },
                    while: {
                        id: "while",
                        type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
                        params: { maxIterations: 1 },
                    },
                },
                edges: [{ from: { nodeId: "condition", port: "value" }, to: { nodeId: "while", port: "condition" } }],
            },
            entry: { start: { nodeId: "while", port: "in" } },
            node: {
                id: "while",
                type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
                params: { maxIterations: 1 },
            },
            params: { maxIterations: 1 },
            hostAdapter: { host: "player" as const },
            blueprintLocals: whileLocals,
        };
        expect(whileNode.execute(whileContext)).toEqual({ nextPort: "loop" });
        expect(whileNode.execute(whileContext)).toEqual({ nextPort: "completed" });

        const delayNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_DELAY)!;
        await expect(
            Promise.resolve(
                delayNode.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId: "delay", port: "in" } } },
                        nodes: {
                            delay: {
                                id: "delay",
                                type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                                params: { duration: 0 },
                            },
                        },
                        edges: [],
                    },
                    entry: { start: { nodeId: "delay", port: "in" } },
                    node: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 0 },
                    },
                    params: { duration: 0 },
                    hostAdapter: { host: "player" },
                }),
            ),
        ).resolves.toEqual({ nextPort: "completed" });
    });

    it("only exposes Text nodes for Text widget blueprints", () => {
        registerCoreBlueprintNodes();

        const textPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
                widgetElementType: "nl.text",
            }).map(entry => entry.type),
        );
        const buttonPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );

        expect(textPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(true);
        expect(textPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
    });

    it("scopes Blueprint Value event heads and return nodes to value blueprints", () => {
        registerCoreBlueprintNodes();

        const valuePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
                widgetElementType: "nl.text",
                isBlueprintValueGraph: true,
            }).map(entry => entry.type),
        );
        const widgetPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
                widgetElementType: "nl.text",
            }).map(entry => entry.type),
        );

        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(valuePaletteTypes.has("blueprint.event.head.flush")).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_REF)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_BOOLEAN_AND)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_COMMENT)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_GET)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_SET)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PERSISTENT_GET)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PERSISTENT_SET)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(false);

        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(false);
    });

    it("exposes Blueprint Value nodes through the editor palette facade", () => {
        const entries = listBlueprintNodePaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
            widgetElementType: "nl.text",
            isBlueprintValueGraph: true,
        });
        const byType = new Map(entries.map(entry => [entry.type, entry]));

        expect(byType.get(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)?.category).toBe("Events");
        expect(byType.has("blueprint.event.head.flush")).toBe(false);
        expect(byType.get(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)?.category).toBe("Data");
        expect(byType.get(BLUEPRINT_NODE_TYPE_ELEMENT_REF)?.category).toBe("Element");
        expect(byType.get(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)?.category).toBe("Variables");
        expect(byType.get(BLUEPRINT_NODE_TYPE_LOCAL_GET)?.category).toBe("Variables");
        expect(byType.get(BLUEPRINT_NODE_TYPE_LOCAL_SET)?.category).toBe("Variables");
        expect(byType.has(BLUEPRINT_NODE_TYPE_PERSISTENT_GET)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_PERSISTENT_SET)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
    });

    it("exposes Broadcast nodes for surface blueprints", () => {
        registerCoreBlueprintNodes();

        const surfacePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );

        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_BROADCAST_SEND)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT)).toBe(true);
    });

    it("scopes event heads by owner and widget capability without duplicate click aliases", () => {
        registerCoreBlueprintNodes();

        const globalPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "globalMain" },
            }).map(entry => entry.type),
        );
        const surfacePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );
        const buttonPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );
        const listEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
            widgetElementType: "nl.list",
        });
        const listPaletteTypes = new Set(listEntries.map(entry => entry.type));
        const sliderEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "slider" },
            widgetElementType: "nl.slider",
        });
        const sliderPaletteTypes = new Set(sliderEntries.map(entry => entry.type));
        const framePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "frame" },
                widgetElementType: "nl.frame",
            }).map(entry => entry.type),
        );
        const allTypes = new Set(blueprintNodeRegistry.list().map(def => def.type));

        expect(allTypes.has("blueprint.event.head.click")).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);

        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);

        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS)).toBe(true);
        const listGetItems = listEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS);
        expect(listGetItems?.pins.some(pin => pin.id === "list")).toBe(false);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE)).toBe(true);
        const sliderGetValue = sliderEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE);
        expect(sliderGetValue?.pins.some(pin => pin.id === "slider")).toBe(false);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);

        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE)).toBe(true);
        const frameSetPageEntry = blueprintNodeRegistry
            .listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "frame" },
                widgetElementType: "nl.frame",
            })
            .find(entry => entry.type === BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE);
        expect(frameSetPageEntry).toMatchObject({
            category: "Frame",
            displayName: "Set Frame Page",
        });
    });

    it("filters widget event heads by the active event layer slot when provided", () => {
        registerCoreBlueprintNodes();

        const listScrollPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                widgetElementType: "nl.list",
                widgetEventLayerSlots: ["scroll"],
            }).map(entry => entry.type),
        );

        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(true);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(false);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(false);
        expect(listScrollPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);

        const listItemClickPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                widgetElementType: "nl.list",
                widgetEventLayerSlots: ["itemClick"],
            }).map(entry => entry.type),
        );

        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(listItemClickPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED)).toBe(false);

        const buttonKeyDownPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                widgetElementType: "nl.button",
                widgetEventLayerSlots: ["keyDown"],
            }).map(entry => entry.type),
        );

        expect(buttonKeyDownPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(buttonKeyDownPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(buttonKeyDownPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(false);
        expect(buttonKeyDownPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(false);
        expect(buttonKeyDownPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
    });

    it("executes Text write nodes and resolves Text read nodes against the current widget owner", async () => {
        registerCoreBlueprintNodes();

        const textProps = {
            text: "Before",
            fontAssetId: null,
            fontSize: 16,
            fontWeight: "normal" as const,
            color: "#ffffff",
            textAlign: "left" as const,
            textVerticalAlign: "start" as const,
            lineHeight: 1.4,
            textWrapMode: "word" as const,
            effects: {
                effectBlur: 0,
                effectBackgroundBlur: 0,
                effectShadow: null,
                effectTextShadow: null,
                effectInnerShadow: null,
                effectBlend: "",
                effectGlow: null,
                effectFilter: null,
            },
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    widget: {
                        getTextProperties: () => textProps,
                        setTextProperties: async (_elementId: string, patch: Partial<typeof textProps>) => {
                            Object.assign(textProps, patch);
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;

        const setNode = textBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)!;
        await Promise.resolve(
            setNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setText", port: "in" } } },
                    nodes: {
                        setText: {
                            id: "setText",
                            type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                            params: { text: "After" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setText", port: "in" } },
                node: {
                    id: "setText",
                    type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
                    params: { text: "After" },
                },
                params: { text: "After" },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
            }),
        );

        expect(textProps.text).toBe("After");
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getText: { type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT },
                    },
                    edges: [],
                },
                "getText",
                "text",
                {},
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
                },
            ),
        ).toBe("After");

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getColor: { type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR },
                    },
                    edges: [],
                },
                "getColor",
                "color",
                {},
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
                },
            ),
        ).toEqual({ r: 255, g: 255, b: 255, a: 1 });

        const setColorNode = textBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR)!;
        await Promise.resolve(
            setColorNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setColor", port: "in" } } },
                    nodes: {
                        setColor: {
                            id: "setColor",
                            type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
                            params: { color: { r: 16, g: 32, b: 48, a: 1 } },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setColor", port: "in" } },
                node: {
                    id: "setColor",
                    type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
                    params: { color: { r: 16, g: 32, b: 48, a: 1 } },
                },
                params: { color: { r: 16, g: 32, b: 48, a: 1 } },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "text", blueprintId: "bp" },
            }),
        );
        expect(textProps.color).toBe("#102030");
    });

    it("executes Slider write nodes and resolves Slider read nodes against the current widget owner", async () => {
        registerCoreBlueprintNodes();

        let sliderProps: UISliderRuntimeValue = resolveSliderRuntimeValue({
            value: 20,
            min: 0,
            max: 100,
            step: 5,
        });
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    widget: {
                        getSliderProperties: () => sliderProps,
                        setSliderProperties: async (_elementId: string, patch: Partial<UISliderRuntimeValue>) => {
                            sliderProps = resolveSliderRuntimeValue({
                                ...sliderProps,
                                ...patch,
                            });
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const owner = { surfaceId: "surface", elementId: "slider", blueprintId: "bp" };

        const setValueNode = sliderBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE)!;
        await Promise.resolve(
            setValueNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setValue", port: "in" } } },
                    nodes: {
                        setValue: {
                            id: "setValue",
                            type: BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
                            params: { value: 88 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setValue", port: "in" } },
                node: {
                    id: "setValue",
                    type: BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
                    params: { value: 88 },
                },
                params: { value: 88 },
                hostAdapter,
                executionOwner: owner,
            }),
        );

        expect(sliderProps.value).toBe(90);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getValue: { type: BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE },
                    },
                    edges: [],
                },
                "getValue",
                "value",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(90);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getNormalized: { type: BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE },
                    },
                    edges: [],
                },
                "getNormalized",
                "normalizedValue",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(0.9);

        const setRangeNode = sliderBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE)!;
        await Promise.resolve(
            setRangeNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setRange", port: "in" } } },
                    nodes: {
                        setRange: {
                            id: "setRange",
                            type: BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
                            params: { min: -50, max: 50, step: 10 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setRange", port: "in" } },
                node: {
                    id: "setRange",
                    type: BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
                    params: { min: -50, max: 50, step: 10 },
                },
                params: { min: -50, max: 50, step: 10 },
                hostAdapter,
                executionOwner: owner,
            }),
        );

        expect(sliderProps).toMatchObject({
            min: -50,
            max: 50,
            step: 10,
            value: 50,
            normalizedValue: 1,
        });
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getRange: { type: BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE },
                    },
                    edges: [],
                },
                "getRange",
                "min",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(-50);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getRange: { type: BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE },
                    },
                    edges: [],
                },
                "getRange",
                "max",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(50);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getRange: { type: BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE },
                    },
                    edges: [],
                },
                "getRange",
                "step",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(10);
    });

    it("executes ImageAsset write nodes and resolves ImageAsset reads", async () => {
        registerCoreBlueprintNodes();

        let imageProps: {
            asset: { kind: "imageAsset"; assetId: string } | null;
            assetId: string | null;
        } = {
            asset: { kind: "imageAsset" as const, assetId: "old-image" },
            assetId: "old-image",
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    widget: {
                        getImageProperties: () => imageProps,
                        setImageProperties: async (_elementId: string, patch: Partial<typeof imageProps>) => {
                            const asset = patch.asset ?? (patch.assetId ? { kind: "imageAsset" as const, assetId: patch.assetId } : null);
                            imageProps = {
                                asset,
                                assetId: asset?.assetId ?? null,
                            };
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const owner = { surfaceId: "surface", elementId: "image", blueprintId: "bp" };
        const setAssetNode = widgetPropertyBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET)!;

        await Promise.resolve(
            setAssetNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setImage", port: "in" } } },
                    nodes: {
                        setImage: {
                            id: "setImage",
                            type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                            params: { asset: { kind: "imageAsset", assetId: "new-image" } },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setImage", port: "in" } },
                node: {
                    id: "setImage",
                    type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                    params: { asset: { kind: "imageAsset", assetId: "new-image" } },
                },
                params: { asset: { kind: "imageAsset", assetId: "new-image" } },
                hostAdapter,
                executionOwner: owner,
            }),
        );

        expect(imageProps.asset).toEqual({ kind: "imageAsset", assetId: "new-image" });
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getImage: { type: BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET },
                    },
                    edges: [],
                },
                "getImage",
                "asset",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toEqual({ kind: "imageAsset", assetId: "new-image" });

        await Promise.resolve(
            setAssetNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setLegacy", port: "in" } } },
                    nodes: {
                        literal: {
                            id: "literal",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                            params: { value: "legacy-image" },
                        },
                        setLegacy: {
                            id: "setLegacy",
                            type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                            params: {},
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "literal", port: "value" },
                            to: { nodeId: "setLegacy", port: "assetId" },
                        },
                    ],
                },
                entry: { start: { nodeId: "setLegacy", port: "in" } },
                node: {
                    id: "setLegacy",
                    type: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
                    params: {},
                },
                params: {},
                hostAdapter,
                executionOwner: owner,
            }),
        );

        expect(imageProps.asset).toEqual({ kind: "imageAsset", assetId: "legacy-image" });
    });
});
