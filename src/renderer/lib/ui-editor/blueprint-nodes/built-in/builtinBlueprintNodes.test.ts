import { describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
    BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
    BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER,
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
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
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
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
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
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT,
    BLUEPRINT_NODE_TYPE_GAME_GET_GAME_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_GET_GLOBAL_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS,
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ,
    BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE,
    BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ,
    BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_ENABLED,
    BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_INTERVAL,
    BLUEPRINT_NODE_TYPE_GAME_GET_SOUND_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_END_MODE,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_FADE_DURATION,
    BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST,
    BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
    BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SET_GLOBAL_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED,
    BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL,
    BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_FADE_DURATION,
    BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_VOLUME,
    BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
    BLUEPRINT_NODE_TYPE_GAME_SKIP,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_FLOW_RETURN,
    BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
    BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FLOW_WHILE,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_X,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_CLEAR_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_X,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_Y,
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
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_SCENE_SET,
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
import { fnBlueprintNodes } from "./fnNodes";
import { frameBlueprintNodes } from "./frameNodes";
import { gameBlueprintNodes } from "./gameNodes";
import { backlogBlueprintNodes } from "./backlogNodes";
import { localVariableBlueprintNodes } from "./localVariableNodes";
import { persistentVariableBlueprintNodes } from "./persistentVariableNodes";
import { resolveDataPinValue } from "./graphParamResolvers";
import { elementBlueprintNodes } from "./elementNodes";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "./elementRefUtils";
import { BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE } from "../frameTargetSurfaceOptions";
import { sliderBlueprintNodes } from "./sliderNodes";
import { stringBlueprintNodes } from "./stringNodes";
import { textBlueprintNodes } from "./textNodes";
import { widgetHostBlueprintNodes } from "./widget/widgetHostNodes";
import { imageAssetBlueprintNodes, widgetPropertyBlueprintNodes } from "./widgetPropertyNodes";
import {
    BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    BLUEPRINT_VALUE_TYPE_TIMER,
} from "@shared/types/blueprint/valueTypes";
import { BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT } from "../types";
import { resolveEffectiveBlueprintCatalogEntry, resolveEffectiveBlueprintNodePins } from "../effectivePins";

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
                    getPageProps: () => ({}),
                    closeLayer: async () => undefined,
                    quitApplication: async () => undefined,
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
                localization: {
                    getConfig: () => null,
                    getLocale: async () => "",
                    setLocale: async () => undefined,
                },
                frame: {
                    getParam: () => undefined,
                    emit: async () => undefined,
                },
                game: {
                    startStory: async () => undefined,
                    isInGame: () => false,
                    isGameOverlay: () => false,
                    quit: async () => undefined,
                    writeSave: async () => undefined,
                    loadSave: async () => undefined,
                    deleteSave: async () => undefined,
                    listSaveIds: async () => [],
                    getSaveMetadata: async () => ({}),
                    getSavePreview: async () => null,
                    getHistory: async () => [],
                    restoreHistory: async () => undefined,
                    getNametag: () => null,
                    getNotifications: () => [],
                    getChoiceCount: () => 0,
                    isNvlMode: () => false,
                    isCurrentTextRead: () => false,
                    clearTextRead: async () => undefined,
                    choose: async () => undefined,
                    next: async () => undefined,
                    skip: async () => undefined,
                    showDialog: async () => undefined,
                    hideDialog: async () => undefined,
                    toggleDialogDisplay: async () => undefined,
                    setSentenceSpeed: async () => undefined,
                    getPreference: () => 0,
                    setPreference: async () => undefined,
                },
                devtools: {
                    log: () => undefined,
                },
            },
        },
    };
}

type FramePatchCall = {
    elementId: string;
    targetSurfaceId?: string | null;
    params?: Record<string, unknown>;
};

function createPageNavigationHostAdapter(
    openedSurfaceIds: string[],
    frameTargets: Record<string, string | null> = {},
    framePatches: FramePatchCall[] = [],
    startedStories: Array<{ storyId: string; sceneId: string }> = [],
    openedPageProps: unknown[] = [],
    pageProps: Record<string, unknown> = {},
    quitApplicationCalls: boolean[] = [],
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
                    openSurface: async (surfaceId: string, props?: unknown) => {
                        openedSurfaceIds.push(surfaceId);
                        openedPageProps.push(props);
                    },
                    getPageProps: () => pageProps,
                    closeLayer: async () => undefined,
                    quitApplication: async () => {
                        quitApplicationCalls.push(true);
                    },
                },
                widget: {
                    getFrameProperties: (elementId: string) => ({
                        targetSurfaceId: frameTargets[elementId] ?? null,
                        params: {},
                    }),
                    setFrameProperties: async (
                        elementId: string,
                        patch: { targetSurfaceId?: string | null; params?: Record<string, unknown> },
                    ) => {
                        const call: FramePatchCall = { elementId };
                        if (patch.targetSurfaceId !== undefined) {
                            frameTargets[elementId] = patch.targetSurfaceId;
                            call.targetSurfaceId = patch.targetSurfaceId;
                        }
                        if (patch.params !== undefined) {
                            call.params = patch.params;
                        }
                        if (call.targetSurfaceId !== undefined || call.params !== undefined) {
                            framePatches.push(call);
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
                localization: {
                    getConfig: () => null,
                    getLocale: async () => "",
                    setLocale: async () => undefined,
                },
                frame: {
                    getParam: () => undefined,
                    emit: async () => undefined,
                },
                game: {
                    startStory: async request => {
                        startedStories.push(request);
                    },
                    isInGame: () => false,
                    isGameOverlay: () => false,
                    quit: async () => undefined,
                    writeSave: async () => undefined,
                    loadSave: async () => undefined,
                    deleteSave: async () => undefined,
                    listSaveIds: async () => [],
                    getSaveMetadata: async () => ({}),
                    getSavePreview: async () => null,
                    getHistory: async () => [],
                    restoreHistory: async () => undefined,
                    getNametag: () => null,
                    getNotifications: () => [],
                    getChoiceCount: () => 0,
                    isNvlMode: () => false,
                    isCurrentTextRead: () => false,
                    clearTextRead: async () => undefined,
                    choose: async () => undefined,
                    next: async () => undefined,
                    skip: async () => undefined,
                    showDialog: async () => undefined,
                    hideDialog: async () => undefined,
                    toggleDialogDisplay: async () => undefined,
                    setSentenceSpeed: async () => undefined,
                    getPreference: () => 0,
                    setPreference: async () => undefined,
                },
                devtools: {
                    log: () => undefined,
                },
            },
        },
    };
}

function createGameSaveHostAdapter(options: {
    writtenIds?: string[];
    writtenMetadata?: unknown[];
    writtenScreenshots?: boolean[];
    loadedIds?: string[];
    deletedIds?: string[];
    listedIds?: string[];
    metadata?: unknown;
    previews?: Record<string, unknown>;
    history?: Array<Record<string, unknown>>;
    restoredIds?: Array<string | undefined>;
    nametag?: string | null;
    notifications?: Array<{ id: string; message: string }>;
    choiceCount?: number;
    nvlMode?: boolean;
    textRead?: boolean;
    clearTextReadCalls?: boolean[];
    chosenIndexes?: number[];
    isInGame?: boolean;
    isGameOverlay?: boolean;
    quitSurfaceIds?: string[];
    nextCalls?: boolean[];
    skipCalls?: boolean[];
    showDialogCalls?: boolean[];
    hideDialogCalls?: boolean[];
    toggleDialogDisplayCalls?: boolean[];
    sentenceCpsValues?: number[];
    preferenceReads?: Partial<Record<string, unknown>>;
    preferenceWrites?: Array<{ key: string; value: unknown }>;
}): UIHostAdapter {
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
                    getPageProps: () => ({}),
                    closeLayer: async () => undefined,
                    quitApplication: async () => undefined,
                },
                widget: {} as any,
                state: {
                    get: () => undefined,
                    set: () => undefined,
                },
                persistence: {
                    get: async () => undefined,
                    set: async () => undefined,
                },
                localization: {
                    getConfig: () => null,
                    getLocale: async () => "",
                    setLocale: async () => undefined,
                },
                frame: {
                    getParam: () => undefined,
                    emit: async () => undefined,
                },
                game: {
                    startStory: async () => undefined,
                    isInGame: () => options.isInGame ?? false,
                    isGameOverlay: () => options.isGameOverlay ?? false,
                    quit: async (surfaceId: string) => {
                        options.quitSurfaceIds?.push(surfaceId);
                    },
                    writeSave: async (id: string, metadata?: unknown, screenshot?: boolean) => {
                        options.writtenIds?.push(id);
                        options.writtenMetadata?.push(metadata ?? {});
                        options.writtenScreenshots?.push(screenshot === true);
                    },
                    loadSave: async (id: string) => {
                        options.loadedIds?.push(id);
                    },
                    deleteSave: async (id: string) => {
                        options.deletedIds?.push(id);
                    },
                    listSaveIds: async () => options.listedIds ?? [],
                    getSaveMetadata: async () => options.metadata ?? {},
                    getSavePreview: async (id: string) => options.previews?.[id] as any ?? null,
                    getHistory: async () => (options.history ?? []) as any,
                    restoreHistory: async (id?: string) => {
                        options.restoredIds?.push(id);
                    },
                    getNametag: () => options.nametag ?? null,
                    getNotifications: () => options.notifications ?? [],
                    getChoiceCount: () => options.choiceCount ?? 0,
                    isNvlMode: () => options.nvlMode ?? false,
                    isCurrentTextRead: () => options.textRead ?? false,
                    clearTextRead: async () => {
                        options.clearTextReadCalls?.push(true);
                    },
                    choose: async (index: number) => {
                        options.chosenIndexes?.push(index);
                    },
                    next: async () => {
                        options.nextCalls?.push(true);
                    },
                    skip: async () => {
                        options.skipCalls?.push(true);
                    },
                    showDialog: async () => {
                        options.showDialogCalls?.push(true);
                    },
                    hideDialog: async () => {
                        options.hideDialogCalls?.push(true);
                    },
                    toggleDialogDisplay: async () => {
                        options.toggleDialogDisplayCalls?.push(true);
                    },
                    setSentenceSpeed: async (cps: number) => {
                        options.sentenceCpsValues?.push(cps);
                    },
                    getPreference: key => options.preferenceReads?.[key] as any,
                    setPreference: async (key, value) => {
                        options.preferenceWrites?.push({ key, value });
                    },
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
            ...gameBlueprintNodes,
            ...backlogBlueprintNodes,
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
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_START_STORY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_QUIT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(true);
        expect(frameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)?.hideInPalette).toBe(true);
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
        expect(types.has(BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY)).toBe(true);
        expect(blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY)?.displayName).toBe("Skip Delay");
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
        expect(types.has(BLUEPRINT_NODE_TYPE_DATA_NOT_NULL)).toBe(true);
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
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY)).toBe(true);
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
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_X)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_CLEAR_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_X)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_Y)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_Y)).toBe(true);
        expect(types.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(true);
    });

    it("logs a visible marker when Log has no value input", () => {
        const logNode = devtoolsBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_LOG)!;
        const devtoolsLog = vi.fn();
        const hostAdapter = createPersistenceHostAdapter({});
        hostAdapter.blueprintRuntime!.hostApi!.devtools.log = devtoolsLog;
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            const result = logNode.execute({
                graph: {
                    id: "graph",
                    entries: {
                        main: { start: { nodeId: "log", port: "in" } },
                    },
                    nodes: {
                        log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "log", port: "in" } },
                node: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
                params: {},
                hostAdapter,
            });

            expect(result).toEqual({ nextPort: "next" });
            expect(devtoolsLog).toHaveBeenCalledWith("info", "Log node reached");
            expect(consoleLog).toHaveBeenCalledWith("[Blueprint]", "Log node reached");
        } finally {
            consoleLog.mockRestore();
        }
    });

    it("concatenates Log fixed and dynamic value inputs like Concat", () => {
        const logNode = devtoolsBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_LOG)!;
        const devtoolsLog = vi.fn();
        const hostAdapter = createPersistenceHostAdapter({});
        hostAdapter.blueprintRuntime!.hostApi!.devtools.log = devtoolsLog;
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            logNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "log", port: "in" } } },
                    nodes: { log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG } },
                    edges: [],
                },
                entry: { start: { nodeId: "log", port: "in" } },
                node: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
                params: {
                    value: "result: ",
                    __dynamicInputPinIds: ["in_1"],
                    in_1: "42",
                },
                hostAdapter,
            });

            expect(devtoolsLog).toHaveBeenCalledWith("info", "result: 42");
        } finally {
            consoleLog.mockRestore();
        }
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
            { key: BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME, label: "Key", kind: "keyboardBinding" },
        ]);
        expect(onKeyDown?.pins.map(pin => pin.id)).toEqual(["then"]);
        expect(onKeyUp?.pins.map(pin => pin.id)).toEqual(["then"]);

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
            BLUEPRINT_NODE_TYPE_SCENE_GET,
            BLUEPRINT_NODE_TYPE_SCENE_SET,
            BLUEPRINT_NODE_TYPE_SAVED_GET,
            BLUEPRINT_NODE_TYPE_SAVED_SET,
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
        const surfacePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "surfaceMain", surfaceId: "surface" },
            }).map(entry => entry.type),
        );
        const globalPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "globalMain" },
            }).map(entry => entry.type),
        );
        const componentWidgetPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "componentWidgetMain", componentId: "component", elementId: "button" },
                widgetElementType: "nl.button",
            }).map(entry => entry.type),
        );
        const sharedAssetPaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "sharedAsset", assetId: "dialog-template" },
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
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(componentWidgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(sharedAssetPaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(false);
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
        const openedPageProps: unknown[] = [];
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
                    props: {
                        id: "props",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
                        params: { value: { tab: "audio", index: 2 } },
                    },
                },
                edges: [
                    { from: { nodeId: "go", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                    { from: { nodeId: "props", port: "value" }, to: { nodeId: "go", port: "props" } },
                ],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter(openedSurfaceIds, {}, [], [], openedPageProps),
            blueprintLocals: localsAfterGoPage,
        });
        expect(openedSurfaceIds).toEqual(["target-page"]);
        expect(openedPageProps).toEqual([{ tab: "audio", index: 2 }]);
        expect(localsAfterGoPage).not.toHaveProperty("afterGoPage");

        openedSurfaceIds.length = 0;
        openedPageProps.length = 0;
        await executeGraph({
            graph: {
                id: "clearPage",
                entries: { main: { start: { nodeId: "go", port: "in" } } },
                nodes: {
                    go: {
                        id: "go",
                        type: BLUEPRINT_NODE_TYPE_PAGE_GO,
                        params: {},
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "go", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter(openedSurfaceIds, {}, [], [], openedPageProps),
        });
        expect(openedSurfaceIds).toEqual([""]);
        expect(openedPageProps).toEqual([undefined]);

        const quitApplicationCalls: boolean[] = [];
        const localsAfterQuit: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "quitPage",
                entries: { main: { start: { nodeId: "quit", port: "in" } } },
                nodes: {
                    quit: {
                        id: "quit",
                        type: BLUEPRINT_NODE_TYPE_PAGE_QUIT,
                        params: {},
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterQuit" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "quit", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "quit", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], {}, [], [], [], {}, quitApplicationCalls),
            blueprintLocals: localsAfterQuit,
        });
        expect(quitApplicationCalls).toEqual([true]);
        expect(localsAfterQuit).not.toHaveProperty("afterQuit");

        const currentPageProps = { tab: "video", nested: { muted: true } };
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        props: {
                            type: BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
                            params: {},
                        },
                    },
                },
                "props",
                "props",
                {},
                undefined,
                0,
                { hostAdapter: createPageNavigationHostAdapter([], {}, [], [], [], currentPageProps) },
            ),
        ).toEqual(currentPageProps);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        exiting: {
                            type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
                            params: {},
                        },
                    },
                },
                "exiting",
                "isExiting",
                {},
                undefined,
                0,
                {
                    hostAdapter: {
                        host: "player",
                        blueprintRuntime: {
                            surfaceId: "surface",
                            setSurfaceState: () => undefined,
                            getSurfaceState: () => undefined,
                            emitDebug: () => undefined,
                            dispatchElementBlueprintEvent: async () => undefined,
                            getSurfaceTransitionState: () => ({ isEntering: false, isExiting: true }),
                        },
                    },
                },
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        entering: {
                            type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
                            params: {},
                        },
                    },
                },
                "entering",
                "isEntering",
                {},
                undefined,
                0,
                {
                    hostAdapter: {
                        host: "player",
                        blueprintRuntime: {
                            surfaceId: "surface",
                            setSurfaceState: () => undefined,
                            getSurfaceState: () => undefined,
                            emitDebug: () => undefined,
                            dispatchElementBlueprintEvent: async () => undefined,
                            getSurfaceTransitionState: () => ({ isEntering: true, isExiting: false }),
                        },
                    },
                },
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        transitioning: {
                            type: BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING,
                            params: {},
                        },
                    },
                },
                "transitioning",
                "isTransitioning",
                {},
                undefined,
                0,
                {
                    hostAdapter: {
                        host: "player",
                        blueprintRuntime: {
                            surfaceId: "surface",
                            setSurfaceState: () => undefined,
                            getSurfaceState: () => undefined,
                            emitDebug: () => undefined,
                            dispatchElementBlueprintEvent: async () => undefined,
                            getSurfaceTransitionState: () => ({ isEntering: false, isExiting: true }),
                        },
                    },
                },
            ),
        ).toBe(true);

        const framePatches: FramePatchCall[] = [];
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
                    props: {
                        id: "props",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
                        params: { value: { tab: "details", index: 3 } },
                    },
                },
                edges: [
                    { from: { nodeId: "props", port: "value" }, to: { nodeId: "set", port: "props" } },
                ],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], {}, framePatches),
            executionOwner: { surfaceId: "surface", elementId: "frame" },
        });
        expect(framePatches).toEqual([
            { elementId: "frame", targetSurfaceId: "embedded-page", params: { tab: "details", index: 3 } },
        ]);

        framePatches.length = 0;
        await executeGraph({
            graph: {
                id: "clearPage",
                entries: { main: { start: { nodeId: "set", port: "in" } } },
                nodes: {
                    set: {
                        id: "set",
                        type: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
                        params: {},
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], { frame: "embedded-page" }, framePatches),
            executionOwner: { surfaceId: "surface", elementId: "frame" },
        });
        expect(framePatches).toEqual([{ elementId: "frame", targetSurfaceId: null }]);

        framePatches.length = 0;
        await executeGraph({
            graph: {
                id: "setPageFromElementRef",
                entries: { main: { start: { nodeId: "set", port: "in" } } },
                nodes: {
                    ref: {
                        id: "ref",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                        params: {
                            [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                            [ELEMENT_REF_PARAM_ELEMENT_ID]: "frame-from-ref",
                            [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.frame",
                        },
                    },
                    set: {
                        id: "set",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
                        params: { targetSurfaceId: "element-page" },
                    },
                    props: {
                        id: "props",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_JSON,
                        params: { value: { pane: "summary" } },
                    },
                },
                edges: [
                    { from: { nodeId: "ref", port: "element" }, to: { nodeId: "set", port: "element" } },
                    { from: { nodeId: "props", port: "value" }, to: { nodeId: "set", port: "props" } },
                ],
            },
            entry: { start: { nodeId: "set", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], {}, framePatches),
            executionOwner: { surfaceId: "surface" },
        });
        expect(framePatches).toEqual([
            { elementId: "frame-from-ref", targetSurfaceId: "element-page", params: { pane: "summary" } },
        ]);
    });

    it("executes Start Game as a terminal host API node", async () => {
        registerCoreBlueprintNodes();

        const startedStories: Array<{ storyId: string; sceneId: string }> = [];
        const localsAfterStartGame: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "startGame",
                entries: { main: { start: { nodeId: "start", port: "in" } } },
                nodes: {
                    start: {
                        id: "start",
                        type: BLUEPRINT_NODE_TYPE_GAME_START_STORY,
                        params: { storyId: "story-1", sceneId: "scene-1" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterStartGame" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "start", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "start", port: "in" } },
            hostAdapter: createPageNavigationHostAdapter([], {}, [], startedStories),
            blueprintLocals: localsAfterStartGame,
        });

        expect(startedStories).toEqual([{ storyId: "story-1", sceneId: "scene-1" }]);
        expect(localsAfterStartGame).not.toHaveProperty("afterStartGame");
    });

    it("executes dialog Game nodes through host APIs", async () => {
        registerCoreBlueprintNodes();

        const localsFromNametag: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "getNametag",
                entries: { main: { start: { nodeId: "capture", port: "in" } } },
                nodes: {
                    get: {
                        id: "get",
                        type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
                        params: {},
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "nametag" },
                    },
                },
                edges: [
                    { from: { nodeId: "get", port: "nametag" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "capture", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ nametag: "Alice" }),
            blueprintLocals: localsFromNametag,
        });
        expect(localsFromNametag.nametag).toBe("Alice");

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        state: {
                            type: BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME,
                            params: {},
                        },
                    },
                    edges: [],
                },
                "state",
                "isInGame",
                {},
                undefined,
                0,
                { hostAdapter: createGameSaveHostAdapter({ isInGame: true }) },
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        overlay: {
                            type: BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
                            params: {},
                        },
                    },
                    edges: [],
                },
                "overlay",
                "isGameOverlay",
                {},
                undefined,
                0,
                { hostAdapter: createGameSaveHostAdapter({ isGameOverlay: true }) },
            ),
        ).toBe(true);

        const quitSurfaceIds: string[] = [];
        const localsAfterQuit: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "quitGame",
                entries: { main: { start: { nodeId: "quit", port: "in" } } },
                nodes: {
                    quit: {
                        id: "quit",
                        type: BLUEPRINT_NODE_TYPE_GAME_QUIT,
                        params: { surfaceId: "return-page" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterQuit" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "quit", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "quit", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ quitSurfaceIds }),
            blueprintLocals: localsAfterQuit,
        });
        expect(quitSurfaceIds).toEqual(["return-page"]);
        expect(localsAfterQuit).not.toHaveProperty("afterQuit");

        const nextCalls: boolean[] = [];
        const localsAfterNext: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "next",
                entries: { main: { start: { nodeId: "next", port: "in" } } },
                nodes: {
                    next: {
                        id: "next",
                        type: BLUEPRINT_NODE_TYPE_GAME_NEXT,
                        params: {},
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterNext" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "next", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "next", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ nextCalls }),
            blueprintLocals: localsAfterNext,
        });
        expect(nextCalls).toEqual([true]);
        expect(localsAfterNext.afterNext).toBe("continued");

        const skipCalls: boolean[] = [];
        await executeGraph({
            graph: {
                id: "skip",
                entries: { main: { start: { nodeId: "skip", port: "in" } } },
                nodes: {
                    skip: {
                        id: "skip",
                        type: BLUEPRINT_NODE_TYPE_GAME_SKIP,
                        params: {},
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "skip", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ skipCalls }),
        });
        expect(skipCalls).toEqual([true]);

        async function executeDialogDisplayNode(
            graphId: string,
            nodeType: string,
            hostAdapter: UIHostAdapter,
        ): Promise<Record<string, unknown>> {
            const locals: Record<string, unknown> = {};
            await executeGraph({
                graph: {
                    id: graphId,
                    entries: { main: { start: { nodeId: "action", port: "in" } } },
                    nodes: {
                        action: {
                            id: "action",
                            type: nodeType,
                            params: {},
                        },
                        capture: {
                            id: "capture",
                            type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                            params: { variableId: `${graphId}Next` },
                        },
                        literal: {
                            id: "literal",
                            type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                            params: { value: "continued" },
                        },
                    },
                    edges: [
                        { from: { nodeId: "action", port: "next" }, to: { nodeId: "capture", port: "in" } },
                        { from: { nodeId: "literal", port: "value" }, to: { nodeId: "capture", port: "value" } },
                    ],
                },
                entry: { start: { nodeId: "action", port: "in" } },
                hostAdapter,
                blueprintLocals: locals,
            });
            return locals;
        }

        const showDialogCalls: boolean[] = [];
        const showLocals = await executeDialogDisplayNode(
            "showDialog",
            BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG,
            createGameSaveHostAdapter({ showDialogCalls }),
        );
        expect(showDialogCalls).toEqual([true]);
        expect(showLocals.showDialogNext).toBe("continued");

        const hideDialogCalls: boolean[] = [];
        const hideLocals = await executeDialogDisplayNode(
            "hideDialog",
            BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG,
            createGameSaveHostAdapter({ hideDialogCalls }),
        );
        expect(hideDialogCalls).toEqual([true]);
        expect(hideLocals.hideDialogNext).toBe("continued");

        const toggleDialogDisplayCalls: boolean[] = [];
        const toggleLocals = await executeDialogDisplayNode(
            "toggleDialogDisplay",
            BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY,
            createGameSaveHostAdapter({ toggleDialogDisplayCalls }),
        );
        expect(toggleDialogDisplayCalls).toEqual([true]);
        expect(toggleLocals.toggleDialogDisplayNext).toBe("continued");

        const sentenceCpsValues: number[] = [];
        await executeGraph({
            graph: {
                id: "setSentenceSpeed",
                entries: { main: { start: { nodeId: "cps", port: "in" } } },
                nodes: {
                    cps: {
                        id: "cps",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
                        params: { cps: 32 },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "cps", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ sentenceCpsValues }),
        });
        expect(sentenceCpsValues).toEqual([32]);
    });

    it("executes game preference getter and setter nodes through host APIs", async () => {
        registerCoreBlueprintNodes();

        const preferenceWrites: Array<{ key: string; value: unknown }> = [];
        const setterLocals: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "setPreferences",
                entries: { main: { start: { nodeId: "autoForward", port: "in" } } },
                nodes: {
                    autoForward: {
                        id: "autoForward",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
                        params: { autoForward: true },
                    },
                    gameSpeed: {
                        id: "gameSpeed",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED,
                        params: { gameSpeed: 1.5 },
                    },
                    voiceEndMode: {
                        id: "voiceEndMode",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
                        params: { voiceEndMode: "fade" },
                    },
                    done: {
                        id: "done",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "done", value: "yes" },
                    },
                },
                edges: [
                    { from: { nodeId: "autoForward", port: "next" }, to: { nodeId: "gameSpeed", port: "in" } },
                    { from: { nodeId: "gameSpeed", port: "next" }, to: { nodeId: "voiceEndMode", port: "in" } },
                    { from: { nodeId: "voiceEndMode", port: "next" }, to: { nodeId: "done", port: "in" } },
                ],
            },
            entry: { start: { nodeId: "autoForward", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ preferenceWrites }),
            blueprintLocals: setterLocals,
        });
        expect(preferenceWrites).toEqual([
            { key: "autoForward", value: true },
            { key: "gameSpeed", value: 1.5 },
            { key: "voiceEndMode", value: "fade" },
        ]);
        expect(setterLocals.done).toBe("yes");

        const getterLocals: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "getSentenceSpeed",
                entries: { main: { start: { nodeId: "capture", port: "in" } } },
                nodes: {
                    cps: {
                        id: "cps",
                        type: BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
                        params: {},
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "cps" },
                    },
                },
                edges: [
                    { from: { nodeId: "cps", port: "cps" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "capture", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ preferenceReads: { cps: 28 } }),
            blueprintLocals: getterLocals,
        });
        expect(getterLocals.cps).toBe(28);

        await expect(executeGraph({
            graph: {
                id: "invalidVoiceEndMode",
                entries: { main: { start: { nodeId: "voiceEndMode", port: "in" } } },
                nodes: {
                    voiceEndMode: {
                        id: "voiceEndMode",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
                        params: { voiceEndMode: "hold" },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "voiceEndMode", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ preferenceWrites: [] }),
        })).rejects.toThrow(/Voice End Mode/);

        await expect(executeGraph({
            graph: {
                id: "invalidSkipInterval",
                entries: { main: { start: { nodeId: "skipInterval", port: "in" } } },
                nodes: {
                    skipInterval: {
                        id: "skipInterval",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL,
                        params: { skipInterval: 0 },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "skipInterval", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ preferenceWrites: [] }),
        })).rejects.toThrow(/Skip Interval/);
    });

    it("executes game save nodes through host APIs", async () => {
        registerCoreBlueprintNodes();

        const writtenIds: string[] = [];
        const writtenMetadata: unknown[] = [];
        const writtenScreenshots: boolean[] = [];
        const writeMetadata = ["chapter", 3, { route: "true" }];
        await executeGraph({
            graph: {
                id: "writeSave",
                entries: { main: { start: { nodeId: "write", port: "in" } } },
                nodes: {
                    write: {
                        id: "write",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
                        params: { id: "slot-a", metadata: writeMetadata },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
                        params: { value: "true" },
                    },
                },
                edges: [
                    { from: { nodeId: "capture", port: "value" }, to: { nodeId: "write", port: "screenshot" } },
                ],
            },
            entry: { start: { nodeId: "write", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ writtenIds, writtenMetadata, writtenScreenshots }),
        });
        expect(writtenIds).toEqual(["slot-a"]);
        expect(writtenMetadata).toEqual([writeMetadata]);
        expect(writtenScreenshots).toEqual([true]);

        const deletedIds: string[] = [];
        const localsAfterDelete: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "deleteSave",
                entries: { main: { start: { nodeId: "delete", port: "in" } } },
                nodes: {
                    delete: {
                        id: "delete",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE,
                        params: { id: "slot-a" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterDelete" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "delete", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "delete", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ deletedIds }),
            blueprintLocals: localsAfterDelete,
        });
        expect(deletedIds).toEqual(["slot-a"]);
        expect(localsAfterDelete.afterDelete).toBe("continued");

        const localsFromList: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "listSaves",
                entries: { main: { start: { nodeId: "list", port: "in" } } },
                nodes: {
                    list: {
                        id: "list",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
                        params: {},
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "ids" },
                    },
                },
                edges: [
                    { from: { nodeId: "list", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "list", port: "ids" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "list", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ listedIds: ["slot-b", "slot-a"] }),
            blueprintLocals: localsFromList,
        });
        expect(localsFromList.ids).toEqual(["slot-b", "slot-a"]);

        const saveMetadata = ["chapter", 2, { flags: { metAlice: true } }];
        const localsFromMetadata: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "metadataSave",
                entries: { main: { start: { nodeId: "metadata", port: "in" } } },
                nodes: {
                    metadata: {
                        id: "metadata",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA,
                        params: { id: "slot-a" },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "metadata" },
                    },
                },
                edges: [
                    { from: { nodeId: "metadata", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "metadata", port: "metadata" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "metadata", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ metadata: saveMetadata }),
            blueprintLocals: localsFromMetadata,
        });
        expect(localsFromMetadata.metadata).toEqual(saveMetadata);

        const preview = { kind: "imageAsset", assetId: "dev-mode-save-preview:slot-a" };
        const localsFromPreview: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "previewSave",
                entries: { main: { start: { nodeId: "preview", port: "in" } } },
                nodes: {
                    preview: {
                        id: "preview",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
                        params: { id: "slot-a" },
                    },
                    capture: {
                        id: "capture",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "preview" },
                    },
                },
                edges: [
                    { from: { nodeId: "preview", port: "next" }, to: { nodeId: "capture", port: "in" } },
                    { from: { nodeId: "preview", port: "preview" }, to: { nodeId: "capture", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "preview", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ previews: { "slot-a": preview } }),
            blueprintLocals: localsFromPreview,
        });
        expect(localsFromPreview.preview).toEqual(preview);

        const loadedIds: string[] = [];
        const localsAfterLoad: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "loadSave",
                entries: { main: { start: { nodeId: "load", port: "in" } } },
                nodes: {
                    load: {
                        id: "load",
                        type: BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
                        params: { id: "slot-a" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterLoad" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "load", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "load", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ loadedIds }),
            blueprintLocals: localsAfterLoad,
        });
        expect(loadedIds).toEqual(["slot-a"]);
        expect(localsAfterLoad).not.toHaveProperty("afterLoad");
    });

    it("reads the dialogue backlog and restores the game from a history entry", async () => {
        registerCoreBlueprintNodes();

        // Get History exposes the entries array and its count to downstream nodes, then continues.
        const backlogEntries = [
            { id: "t1", type: "say", text: "Hello", character: "Alice", voice: "v1", selected: null, isPending: false },
            { id: "t2", type: "menu", text: "Pick one", character: null, voice: null, selected: "Left", isPending: true },
        ];
        const localsFromBacklog: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "getBacklog",
                entries: { main: { start: { nodeId: "backlog", port: "in" } } },
                nodes: {
                    backlog: { id: "backlog", type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET, params: {} },
                    captureEntries: {
                        id: "captureEntries",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "entries" },
                    },
                    captureCount: {
                        id: "captureCount",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "count" },
                    },
                },
                edges: [
                    { from: { nodeId: "backlog", port: "next" }, to: { nodeId: "captureEntries", port: "in" } },
                    { from: { nodeId: "backlog", port: "entries" }, to: { nodeId: "captureEntries", port: "value" } },
                    { from: { nodeId: "captureEntries", port: "next" }, to: { nodeId: "captureCount", port: "in" } },
                    { from: { nodeId: "backlog", port: "count" }, to: { nodeId: "captureCount", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "backlog", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ history: backlogEntries }),
            blueprintLocals: localsFromBacklog,
        });
        expect(localsFromBacklog.entries).toEqual(backlogEntries);
        expect(localsFromBacklog.count).toBe(2);

        // Restore From History forwards the entry id to the host and continues to `next`.
        const restoredIds: Array<string | undefined> = [];
        const localsAfterRestore: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "restoreHistory",
                entries: { main: { start: { nodeId: "restore", port: "in" } } },
                nodes: {
                    restore: {
                        id: "restore",
                        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
                        params: { id: "t2" },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterRestore" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "restore", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "restore", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ restoredIds }),
            blueprintLocals: localsAfterRestore,
        });
        expect(restoredIds).toEqual(["t2"]);
        expect(localsAfterRestore.afterRestore).toBe("continued");

        // Undo Last Dialogue restores without an id (undo the most recent entry).
        const undoneIds: Array<string | undefined> = [];
        await executeGraph({
            graph: {
                id: "undoLast",
                entries: { main: { start: { nodeId: "undo", port: "in" } } },
                nodes: {
                    undo: { id: "undo", type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST, params: {} },
                },
                edges: [],
            },
            entry: { start: { nodeId: "undo", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ restoredIds: undoneIds }),
            blueprintLocals: {},
        });
        expect(undoneIds).toEqual([undefined]);

        // Restore From History requires a non-empty entry id.
        await expect(executeGraph({
            graph: {
                id: "restoreHistoryMissingId",
                entries: { main: { start: { nodeId: "restore", port: "in" } } },
                nodes: {
                    restore: {
                        id: "restore",
                        type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE,
                        params: { id: "  " },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "restore", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ restoredIds: [] }),
            blueprintLocals: {},
        })).rejects.toThrow(/entry id is required/);
    });

    it("uses class.md palette categories for the new node groups", () => {
        registerCoreBlueprintNodes();

        expect(eventHeadBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(broadcastBlueprintNodes.every(def => def.category === "Events")).toBe(true);
        expect(frameBlueprintNodes.every(def => def.category === "Page")).toBe(true);
        expect(gameBlueprintNodes.every(def => def.category === "Game")).toBe(true);
        // Backlog / dialogue-history nodes live under the shared "Game" category.
        expect(backlogBlueprintNodes.every(def => def.category === "Game")).toBe(true);
        const gameReadyHead = eventHeadBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY);
        expect(gameReadyHead?.displayName).toBe("On Game Ready");
        expect(gameReadyHead?.role).toBe("eventHead");
        expect(gameReadyHead?.scope).toEqual({ ownerKinds: ["globalMain"] });
        expect(gameReadyHead?.pins.map(pin => pin.id)).toEqual(["then"]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_START_STORY)?.pins.map(pin => pin.id)).toEqual([
            "in",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)?.pins.map(pin => pin.id)).toEqual([
            "nametag",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME)?.pins.map(pin => pin.id)).toEqual([
            "isInGame",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY)?.pins.map(pin => pin.id)).toEqual([
            "isGameOverlay",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_QUIT)?.pins.map(pin => pin.id)).toEqual([
            "in",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_QUIT)?.inspectorParams).toEqual([
            expect.objectContaining({
                key: "surfaceId",
                dynamicOptionsSource: "surfaces",
            }),
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_NEXT)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SKIP)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
        ]);
        const setSentenceSpeedNode = gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED);
        expect(setSentenceSpeedNode?.pins.map(pin => pin.id)).toEqual(["in", "next", "cps"]);
        expect(setSentenceSpeedNode?.pins.find(pin => pin.id === "cps")).toMatchObject({ label: "CPS" });
        const preferenceNodeExpectations: Array<{
            getterType: string;
            setterType?: string;
            getterName: string;
            setterName?: string;
            pinId: string;
            pinLabel: string;
            valueType: string;
        }> = [
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
                getterName: "Get Auto Forward",
                setterName: "Set Auto Forward",
                pinId: "autoForward",
                pinLabel: "Auto Forward",
                valueType: "boolean",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_ENABLED,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED,
                getterName: "Get Skip",
                setterName: "Set Skip",
                pinId: "skip",
                pinLabel: "Skip",
                valueType: "boolean",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_GAME_SPEED,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED,
                getterName: "Get Game Speed",
                setterName: "Set Game Speed",
                pinId: "gameSpeed",
                pinLabel: "Game Speed",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED,
                getterName: "Get Sentence Speed",
                pinId: "cps",
                pinLabel: "CPS",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_VOLUME,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_VOLUME,
                getterName: "Get Voice Volume",
                setterName: "Set Voice Volume",
                pinId: "voiceVolume",
                pinLabel: "Voice Volume",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_FADE_DURATION,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_FADE_DURATION,
                getterName: "Get Voice Fade Duration",
                setterName: "Set Voice Fade Duration",
                pinId: "voiceFadeDuration",
                pinLabel: "Voice Fade",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_END_MODE,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE,
                getterName: "Get Voice End Mode",
                setterName: "Set Voice End Mode",
                pinId: "voiceEndMode",
                pinLabel: "Voice End Mode",
                valueType: "string",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME,
                getterName: "Get BGM Volume",
                setterName: "Set BGM Volume",
                pinId: "bgmVolume",
                pinLabel: "BGM Volume",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SOUND_VOLUME,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME,
                getterName: "Get Sound Volume",
                setterName: "Set Sound Volume",
                pinId: "soundVolume",
                pinLabel: "Sound Volume",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_GLOBAL_VOLUME,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_GLOBAL_VOLUME,
                getterName: "Get Global Volume",
                setterName: "Set Global Volume",
                pinId: "globalVolume",
                pinLabel: "Global Volume",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_DELAY,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_DELAY,
                getterName: "Get Skip Delay",
                setterName: "Set Skip Delay",
                pinId: "skipDelay",
                pinLabel: "Skip Delay",
                valueType: "float",
            },
            {
                getterType: BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_INTERVAL,
                setterType: BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL,
                getterName: "Get Skip Interval",
                setterName: "Set Skip Interval",
                pinId: "skipInterval",
                pinLabel: "Skip Interval",
                valueType: "float",
            },
        ];
        for (const item of preferenceNodeExpectations) {
            const getter = gameBlueprintNodes.find(def => def.type === item.getterType);
            expect(getter?.displayName).toBe(item.getterName);
            expect(getter?.graphKinds).toEqual(["event", "function", "macro"]);
            expect(getter?.isPure).toBe(true);
            expect(getter?.isLatent).toBe(false);
            expect(getter?.pins).toEqual([
                expect.objectContaining({
                    id: item.pinId,
                    kind: "output",
                    label: item.pinLabel,
                    valueType: item.valueType,
                }),
            ]);
            if (!item.setterType) {
                continue;
            }
            const setter = gameBlueprintNodes.find(def => def.type === item.setterType);
            expect(setter?.displayName).toBe(item.setterName);
            expect(setter?.graphKinds).toEqual(["event", "macro"]);
            expect(setter?.isPure).toBe(false);
            expect(setter?.isLatent).toBe(true);
            expect(setter?.pins.map(pin => pin.id)).toEqual(["in", "next", item.pinId]);
            expect(setter?.pins.find(pin => pin.id === item.pinId)).toMatchObject({
                kind: "input",
                label: item.pinLabel,
                valueType: item.valueType,
            });
        }
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "id",
        ]);
        const saveGameNode = gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE);
        expect(saveGameNode?.displayName).toBe("Save Game");
        expect(saveGameNode?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
            "id",
            "metadata",
            "screenshot",
        ]);
        expect(saveGameNode?.pins.find(pin => pin.id === "metadata")).toMatchObject({ optional: true });
        expect(saveGameNode?.pins.find(pin => pin.id === "screenshot")).toMatchObject({
            label: "Capture",
            optional: true,
        });
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
            "id",
            "metadata",
        ]);
        expect(gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
            "id",
        ]);
        expect(frameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_GO)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "props",
        ]);
        expect(frameBlueprintNodes
            .find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_GO)
            ?.pins.find(pin => pin.id === "props")?.optional).toBe(true);
        expect(frameBlueprintNodes
            .find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)
            ?.pins.map(pin => pin.id)).toEqual(["isExiting"]);
        expect(frameBlueprintNodes
            .find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)
            ?.pins.map(pin => pin.id)).toEqual(["isEntering"]);
        expect(frameBlueprintNodes
            .find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)
            ?.pins.map(pin => pin.id)).toEqual(["isTransitioning"]);
        expect(frameBlueprintNodes
            .find(def => def.type === BLUEPRINT_NODE_TYPE_PAGE_GO)
            ?.inspectorParams).toEqual([
                {
                    key: "surfaceId",
                    label: "Page",
                    kind: "select",
                    dynamicOptionsSource: "surfaces",
                    emptyOptionLabel: "None",
                },
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
        expect(frameSetPage?.pins.map(pin => pin.id)).toEqual(["in", "next", "props"]);
        expect(elementFrameSetPage?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "props"]);
        expect(frameSetPage?.pins.find(pin => pin.id === "props")).toMatchObject({
            label: "Page props",
            valueType: "json",
            optional: true,
        });
        expect(elementFrameSetPage?.pins.find(pin => pin.id === "props")).toMatchObject({
            label: "Page props",
            valueType: "json",
            optional: true,
        });
        expect(frameSetPage?.inspectorParams).toEqual([
            {
                key: "targetSurfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE,
                emptyOptionLabel: "None",
            },
        ]);
        expect(elementFrameSetPage?.inspectorParams).toEqual(frameSetPage?.inspectorParams);
        const buttonSetPointer = widgetPropertyBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER);
        const elementButtonSetPointer = widgetPropertyBlueprintNodes.find(
            def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER,
        );
        expect(buttonSetPointer?.category).toBe("Button");
        expect(elementButtonSetPointer?.category).toBe("Element");
        expect(buttonSetPointer?.pins.map(pin => pin.id)).toEqual(["in", "next"]);
        expect(elementButtonSetPointer?.pins.map(pin => pin.id)).toEqual(["in", "next", "element"]);
        expect(buttonSetPointer?.inspectorParams).toEqual([
            {
                key: "cursor",
                label: "Pointer",
                kind: "buttonCursor",
            },
        ]);
        expect(elementButtonSetPointer?.inspectorParams).toEqual(buttonSetPointer?.inspectorParams);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
        ]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)?.pins.map(pin => pin.id)).toEqual([
            "in",
            "next",
        ]);
        expect(elementBlueprintNodes.some(def => def.category === "Element")).toBe(true);
        expect(elementBlueprintNodes.some(def => def.category === "Displayable")).toBe(true);
    });

    it("continues the active Element event bubble through the runtime", async () => {
        registerCoreBlueprintNodes();

        const bubbleCalls: Array<{
            elementId: string;
            eventName: string;
            payload?: Record<string, unknown>;
            options?: Record<string, unknown>;
        }> = [];
        const blueprintLocals: Record<string, unknown> = {};
        const eventPayload = { x: 12, y: 34, button: 0 };

        await executeGraph({
            graph: {
                id: "continueEventBubble",
                entries: { main: { start: { nodeId: "bubble", port: "in" } } },
                nodes: {
                    bubble: {
                        id: "bubble",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE,
                        params: {},
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterBubble" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "bubble", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "bubble", port: "in" } },
            hostAdapter: {
                host: "player",
                blueprintRuntime: {
                    continueElementEventBubble: async (
                        elementId: string,
                        eventName: string,
                        payload?: Record<string, unknown>,
                        options?: Record<string, unknown>,
                    ) => {
                        bubbleCalls.push({ elementId, eventName, payload, options });
                        return true;
                    },
                },
            } as unknown as UIHostAdapter,
            eventName: "mouseClick",
            eventPayload,
            executionOwner: { surfaceId: "surface", elementId: "button" },
            blueprintLocals,
        });

        expect(bubbleCalls).toEqual([
            {
                elementId: "button",
                eventName: "mouseClick",
                payload: eventPayload,
                options: {
                    listItemScope: undefined,
                    instanceKey: undefined,
                    componentId: undefined,
                },
            },
        ]);
        expect(blueprintLocals.afterBubble).toBe("continued");
    });

    it("stops the active Element event bubble before a later continue request", async () => {
        registerCoreBlueprintNodes();

        const bubbleCalls: string[] = [];
        let stopped = false;
        const blueprintLocals: Record<string, unknown> = {};

        await executeGraph({
            graph: {
                id: "stopEventBubble",
                entries: { main: { start: { nodeId: "stop", port: "in" } } },
                nodes: {
                    stop: {
                        id: "stop",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE,
                        params: {},
                    },
                    bubble: {
                        id: "bubble",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE,
                        params: {},
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                        params: { variableId: "afterStop" },
                    },
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "continued" },
                    },
                },
                edges: [
                    { from: { nodeId: "stop", port: "next" }, to: { nodeId: "bubble", port: "in" } },
                    { from: { nodeId: "bubble", port: "next" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "after", port: "value" } },
                ],
            },
            entry: { start: { nodeId: "stop", port: "in" } },
            hostAdapter: {
                host: "player",
                blueprintRuntime: {
                    continueElementEventBubble: async (elementId: string) => {
                        bubbleCalls.push(elementId);
                        return true;
                    },
                },
            } as unknown as UIHostAdapter,
            eventName: "mouseClick",
            eventPayload: { x: 12, y: 34 },
            eventControl: {
                stopPropagation: () => {
                    stopped = true;
                },
                isPropagationStopped: () => stopped,
            },
            executionOwner: { surfaceId: "surface", elementId: "button" },
            blueprintLocals,
        });

        expect(stopped).toBe(true);
        expect(bubbleCalls).toEqual([]);
        expect(blueprintLocals.afterStop).toBe("continued");
    });

    it("adds Displayable variant and generic property nodes", () => {
        const displayableTypes = new Set(elementBlueprintNodes
            .filter(def => def.category === "Displayable")
            .map(def => def.type));
        const elementTypes = new Set(elementBlueprintNodes
            .filter(def => def.category === "Element")
            .map(def => def.type));

        expect([...displayableTypes]).toEqual(expect.arrayContaining([
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
        ]));
        expect(displayableTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY)).toBe(false);
        expect(displayableTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toBe(false);
        expect(displayableTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY)).toBe(false);
        expect(displayableTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY)).toBe(false);
        expect(displayableTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)).toBe(false);

        expect([...elementTypes]).toEqual(expect.arrayContaining([
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
            BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION,
        ]));
        expect(elementTypes.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY)).toBe(false);
        expect(elementTypes.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY)).toBe(false);
        expect(elementTypes.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)).toBe(false);

        const setVariant = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT);
        expect(setVariant?.category).toBe("Displayable");
        expect(setVariant?.inspectorParams).toBeUndefined();
        expect(setVariant?.pins.map(pin => pin.id)).toEqual(["in", "next"]);
        expect(setVariant?.scope).toMatchObject({
            ownerKinds: ["widgetMain"],
            widgetElementTypes: ["nl.container", "nl.text", "nl.image", "nl.button"],
        });

        const setElementVariant = elementBlueprintNodes.find(
            def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
        );
        expect(setElementVariant?.category).toBe("Element");
        expect(setElementVariant?.pins.map(pin => pin.id)).toEqual(["in", "next", "element"]);
        expect(setElementVariant?.magicElementTarget).toEqual({
            inputPinId: "element",
            elementTypes: ["nl.container", "nl.text", "nl.image", "nl.button"],
        });

        const getProperty = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY);
        expect(getProperty?.inspectorParams?.[0]).toMatchObject({
            key: "property",
            kind: "select",
            options: expect.arrayContaining([
                { value: "position", label: "Position" },
                { value: "offsetX", label: "Offset X" },
                { value: "offsetY", label: "Offset Y" },
                { value: "visible", label: "Visible" },
            ]),
        });
        expect(getProperty?.inspectorParams?.[0]).not.toMatchObject({
            options: expect.arrayContaining([
                { value: "variant", label: "Variant" },
            ]),
        });
        const setProperty = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY);
        expect(setProperty?.pins.map(pin => pin.id)).toEqual(["in", "next", "value"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "display"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "display"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "value"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "animation"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "animation"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "animation"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION)
            ?.pins.map(pin => pin.id)).toEqual(["in", "next", "animation"]);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)
            ?.pins.find(pin => pin.id === "animation")).toMatchObject({
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN,
                label: "Animation",
            });
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION)
            ?.pins.find(pin => pin.id === "animation")).toMatchObject({
                kind: "input",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_ANIMATION_TOKEN,
                label: "Animation",
            });
        expect(setProperty?.inspectorParams?.[0]).toMatchObject({
            key: "property",
            kind: "select",
            options: expect.arrayContaining([
                { value: "x", label: "X" },
                { value: "y", label: "Y" },
                { value: "offsetX", label: "Offset X" },
                { value: "offsetY", label: "Offset Y" },
                { value: "opacity", label: "Opacity" },
                { value: "visible", label: "Visible" },
            ]),
        });
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION)?.hideInPalette)
            .toBe(true);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT)?.hideInPalette)
            .toBe(true);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION)?.hideInPalette)
            .toBe(true);
        expect(elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT)?.hideInPalette)
            .toBe(true);

        const legacyWidgetVariantNodes = widgetPropertyBlueprintNodes.filter(
            def => def.type.endsWith(".getVariant") || def.type.endsWith(".setVariant"),
        );
        expect(legacyWidgetVariantNodes.length).toBeGreaterThan(0);
        expect(legacyWidgetVariantNodes.every(def => def.hideInPalette === true)).toBe(true);
        expect(legacyWidgetVariantNodes
            .filter(def => def.type.endsWith(".setVariant"))
            .flatMap(def => def.pins)
            .some(pin => pin.id === "variantId")).toBe(false);

        const legacyHostSetVariant = widgetHostBlueprintNodes.find(def => def.type === "blueprint.widget.setVariant");
        expect(legacyHostSetVariant?.hideInPalette).toBe(true);
        expect(legacyHostSetVariant?.pins.map(pin => pin.id)).toEqual(["in", "next"]);
        expect(legacyHostSetVariant?.inspectorParams?.some(param => param.key === "variantId")).toBe(false);

        const animate = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY);
        expect(animate?.inspectorParams?.map(param => param.key)).toEqual([
            "property",
            "from",
            "to",
            "duration",
            "delay",
            "easing",
            "after",
        ]);
        expect(animate?.inspectorParams?.[0]).toMatchObject({
            key: "property",
            kind: "select",
            options: expect.arrayContaining([
                { value: "opacity", label: "Opacity" },
                { value: "offsetX", label: "Offset X" },
                { value: "offsetY", label: "Offset Y" },
                { value: "x", label: "X" },
                { value: "y", label: "Y" },
                { value: "scale", label: "Scale" },
                { value: "rotation", label: "Rotation" },
            ]),
        });
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
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_IS_NULL, params: {} } },
                    edges: [],
                },
                "check",
                "result",
                {},
                undefined,
            ),
        ).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_NOT_NULL, params: { value: "Ada" } } },
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
                    nodes: { check: { type: BLUEPRINT_NODE_TYPE_DATA_NOT_NULL, params: { value: null } } },
                    edges: [],
                },
                "check",
                "result",
                { value: null },
                undefined,
            ),
        ).toBe(false);
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

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                sourcePort: "token",
                targetType: BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
                targetPort: "timer",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                sourcePort: "token",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
                targetPort: "value",
            }),
        ).toBe(false);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                sourcePort: "animation",
                targetType: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
                targetPort: "animation",
            }),
        ).toBe(true);

        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                sourcePort: "animation",
                targetType: BLUEPRINT_NODE_TYPE_STRING_LENGTH,
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
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY)).toBe(false);
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toBe(false);
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)).toBe(false);
        expect(baseEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT)).toBe(false);

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
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE)).toBe(false);
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY)).toBe(true);
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toBe(true);
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)).toBe(true);
        expect(derivedEntries.some(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT)).toBe(true);
        expect(derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)
            ?.category).toBe("Element");
        expect(derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT)
            ?.magicElementRef).toMatchObject({
                sourceNodeId: "element-ref",
                sourcePortId: "element",
                targetPortId: "element",
            });
    });

    it("deduplicates element-derived palette entries when several compatible refs exist", () => {
        registerCoreBlueprintNodes();

        const derivedEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
            magicElementRefs: [
                {
                    sourceNodeId: "poster-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "poster",
                    elementType: "nl.image",
                    label: "Poster",
                },
                {
                    sourceNodeId: "icon-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "icon",
                    elementType: "nl.image",
                    label: "Icon",
                },
            ],
        });
        const entriesOfType = (type: string) => derivedEntries.filter(entry => entry.type === type);

        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET)).toHaveLength(1);
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE)).toHaveLength(1);
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT)).toHaveLength(1);
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)).toHaveLength(1);
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)).toHaveLength(1);
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT)[0]?.category).toBe("Element");
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT)[0]?.magicElementRef)
            .toBeUndefined();
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)[0]?.category).toBe("Element");
        expect(entriesOfType(BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)[0]?.magicElementRef)
            .toBeUndefined();
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
        expect(setPage?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "props"]);
        expect(setPage?.pins.find(pin => pin.id === "props")).toMatchObject({
            label: "Page props",
            valueType: "json",
            optional: true,
        });
        expect(setPage?.inspectorParams).toEqual([
            {
                key: "targetSurfaceId",
                label: "Page",
                kind: "select",
                dynamicOptionsSource: BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE,
                emptyOptionLabel: "None",
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
        expect(imageOwnerEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE)?.pins
            .some(pin => pin.id === "element")).toBe(false);
        expect(imageOwnerEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT)?.pins
            .map(pin => pin.id)).toEqual(["leftPct", "topPct", "widthPct", "heightPct"]);

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
        expect(getImage?.category).toBe("Element");
        expect(getImage?.pins.find(pin => pin.id === "asset")).toMatchObject({
            valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
        });
        const setFitMode = derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE);
        expect(setFitMode?.category).toBe("Element");
        expect(setFitMode?.pins.map(pin => pin.id)).toEqual(["in", "next", "element", "fitMode"]);
        expect(setFitMode?.pins.find(pin => pin.id === "element")).toMatchObject({
            valueType: "element:nl.image",
        });
        const getCropRect = derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT);
        expect(getCropRect?.category).toBe("Element");
        expect(getCropRect?.pins.map(pin => pin.id)).toEqual(["element", "leftPct", "topPct", "widthPct", "heightPct"]);
        expect(derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY)
            ?.category).toBe("Element");
        expect(derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)
            ?.category).toBe("Element");
        expect(derivedEntries.find(entry => entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION)
            ?.category).toBe("Element");

        const imageWidgetDerivedEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "owner-image" },
            widgetElementType: "nl.image",
            magicElementRefs: [
                {
                    sourceNodeId: "other-image-ref",
                    sourcePortId: "element",
                    targetPortId: "element",
                    surfaceId: "surface",
                    elementId: "other-image",
                    elementType: "nl.image",
                    label: "Other Image",
                },
            ],
        });
        expect(imageWidgetDerivedEntries.find(entry =>
            entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY
        )?.category).toBe("Element");
        expect(imageWidgetDerivedEntries.find(entry =>
            entry.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY
        )?.category).toBe("Element");
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
        const switchCatalog = blueprintNodeRegistry.resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING, {
            __switchStringCasePins: ["case_1_value", "case_1_output"],
        });
        expect(switchCatalog.dynamicInputPinAddLabel).toBe("Add Case");
        expect(switchCatalog.pins.map(pin => pin.id)).toEqual([
            "in",
            "value",
            "case0Value",
            "case1Value",
            "case_1_value",
            "case0",
            "case1",
            "case_1_output",
            "default",
        ]);
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
        expect(
            switchNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "switch", port: "in" } } },
                    nodes: {
                        switch: {
                            id: "switch",
                            type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                            params: { value: "legacy", case3Value: "legacy" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "switch", port: "in" } },
                node: {
                    id: "switch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                    params: { value: "legacy", case3Value: "legacy" },
                },
                params: { value: "legacy", case3Value: "legacy" },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "case3" });
        expect(
            switchNode.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "switch", port: "in" } } },
                    nodes: {
                        switch: {
                            id: "switch",
                            type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                            params: {
                                value: "settings",
                                case0Value: "title",
                                case1Value: "menu",
                                __switchStringCasePins: ["case_1_value", "case_1_output"],
                                case_1_value: "settings",
                            },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "switch", port: "in" } },
                node: {
                    id: "switch",
                    type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
                    params: {
                        value: "settings",
                        case0Value: "title",
                        case1Value: "menu",
                        __switchStringCasePins: ["case_1_value", "case_1_output"],
                        case_1_value: "settings",
                    },
                },
                params: {
                    value: "settings",
                    case0Value: "title",
                    case1Value: "menu",
                    __switchStringCasePins: ["case_1_value", "case_1_output"],
                    case_1_value: "settings",
                },
                hostAdapter: { host: "player" },
            }),
        ).toEqual({ nextPort: "case_1_output" });

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
        const skipDelayNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY)!;
        expect(delayNode.pins.find(pin => pin.id === "token")).toMatchObject({
            kind: "output",
            semantic: "data",
            valueType: BLUEPRINT_VALUE_TYPE_TIMER,
            label: "Token",
        });
        expect(skipDelayNode.pins.find(pin => pin.id === "timer")).toMatchObject({
            kind: "input",
            semantic: "data",
            valueType: BLUEPRINT_VALUE_TYPE_TIMER,
            label: "Timer",
        });
        const zeroDelayResult = await Promise.resolve(
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
        );
        expect(zeroDelayResult).toMatchObject({
            nextPort: "completed",
            outputValues: {
                token: {
                    kind: "timer",
                    id: expect.any(String),
                },
            },
        });
    });

    it("treats Delay duration as seconds", async () => {
        vi.useFakeTimers();
        try {
            const delayNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_DELAY)!;
            let resolved = false;
            const execution = Promise.resolve(
                delayNode.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId: "delay", port: "in" } } },
                        nodes: {
                            delay: {
                                id: "delay",
                                type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                                params: { duration: 1 },
                            },
                        },
                        edges: [],
                    },
                    entry: { start: { nodeId: "delay", port: "in" } },
                    node: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 1 },
                    },
                    params: { duration: 1 },
                    hostAdapter: { host: "player" },
                }),
            ).then(result => {
                resolved = true;
                return result;
            });

            await vi.advanceTimersByTimeAsync(999);
            expect(resolved).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await expect(execution).resolves.toMatchObject({
                nextPort: "completed",
                outputValues: {
                    token: {
                        kind: "timer",
                        id: expect.any(String),
                    },
                },
            });
            expect(resolved).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps graph execution suspended while Delay is pending", async () => {
        vi.useFakeTimers();
        try {
            const entered: string[] = [];
            const graph = {
                id: "graph",
                entries: { main: { start: { nodeId: "delay", port: "in" } } },
                nodes: {
                    delay: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 1 },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_FLOW_NOOP,
                        params: {},
                    },
                },
                edges: [
                    { from: { nodeId: "delay", port: "completed" }, to: { nodeId: "after", port: "in" } },
                ],
            };
            const execution = executeGraph({
                graph,
                entry: { start: { nodeId: "delay", port: "in" } },
                hostAdapter: { host: "player" },
                trace: {
                    executionId: "execution",
                    graphId: "graph",
                    emit: event => {
                        if (event.type === "node.enter") {
                            entered.push(event.nodeId);
                        }
                    },
                },
            });

            await Promise.resolve();
            expect(entered).toEqual(["delay"]);
            await vi.advanceTimersByTimeAsync(999);
            expect(entered).toEqual(["delay"]);
            await vi.advanceTimersByTimeAsync(1);
            await expect(execution).resolves.toEqual({ returnValueSet: false, returnValue: undefined });
            expect(entered).toEqual(["delay", "after"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("cancels pending Delay graph execution without entering downstream nodes", async () => {
        vi.useFakeTimers();
        try {
            const entered: string[] = [];
            const controller = new AbortController();
            const graph = {
                id: "graph",
                entries: { main: { start: { nodeId: "delay", port: "in" } } },
                nodes: {
                    delay: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 1 },
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_FLOW_NOOP,
                        params: {},
                    },
                },
                edges: [
                    { from: { nodeId: "delay", port: "completed" }, to: { nodeId: "after", port: "in" } },
                ],
            };
            const execution = executeGraph({
                graph,
                entry: { start: { nodeId: "delay", port: "in" } },
                hostAdapter: { host: "player" },
                signal: controller.signal,
                trace: {
                    executionId: "execution",
                    graphId: "graph",
                    emit: event => {
                        if (event.type === "node.enter") {
                            entered.push(event.nodeId);
                        }
                    },
                },
            });

            await Promise.resolve();
            expect(entered).toEqual(["delay"]);
            controller.abort("Surface unmounted");
            await expect(execution).rejects.toThrow("Surface unmounted");
            await vi.advanceTimersByTimeAsync(1000);
            expect(entered).toEqual(["delay"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("skips a pending Delay through its Timer token", async () => {
        vi.useFakeTimers();
        try {
            const entered: string[] = [];
            const executionOwner = { surfaceId: "surface", elementId: "button", blueprintId: "blueprint" };
            const graph = {
                id: "skipDelayGraph",
                entries: { main: { start: { nodeId: "delay", port: "in" } } },
                nodes: {
                    delay: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 1 },
                    },
                    skip: {
                        id: "skip",
                        type: BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
                        params: {},
                    },
                    after: {
                        id: "after",
                        type: BLUEPRINT_NODE_TYPE_FLOW_NOOP,
                        params: {},
                    },
                },
                edges: [
                    { from: { nodeId: "delay", port: "completed" }, to: { nodeId: "after", port: "in" } },
                    { from: { nodeId: "delay", port: "token" }, to: { nodeId: "skip", port: "timer" } },
                ],
            };
            const delayExecution = executeGraph({
                graph,
                entry: { start: { nodeId: "delay", port: "in" } },
                hostAdapter: { host: "player" },
                executionOwner,
                trace: {
                    executionId: "delay-execution",
                    graphId: "skipDelayGraph",
                    emit: event => {
                        if (event.type === "node.enter") {
                            entered.push(event.nodeId);
                        }
                    },
                },
            });

            await Promise.resolve();
            expect(entered).toEqual(["delay"]);

            await executeGraph({
                graph,
                entry: { start: { nodeId: "skip", port: "in" } },
                hostAdapter: { host: "player" },
                executionOwner,
            });

            await expect(delayExecution).resolves.toEqual({ returnValueSet: false, returnValue: undefined });
            expect(entered).toEqual(["delay", "after"]);
            await vi.advanceTimersByTimeAsync(1000);
            expect(entered).toEqual(["delay", "after"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("treats Skip Delay with non-Delay Timer input as a no-op", () => {
        const skipDelayNode = controlFlowBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY)!;
        const createContext = (timer: unknown) => ({
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "skip", port: "in" } } },
                nodes: {
                    skip: {
                        id: "skip",
                        type: BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
                        params: { timer },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "skip", port: "in" } },
            node: {
                id: "skip",
                type: BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY,
                params: { timer },
            },
            params: { timer },
            hostAdapter: { host: "player" as const },
        });

        expect(skipDelayNode.execute(createContext({ kind: "timer", id: "interval:abc" }))).toEqual({
            nextPort: "next",
        });
        expect(skipDelayNode.execute(createContext({ kind: "timer", id: "delay:missing" }))).toEqual({
            nextPort: "next",
        });
        expect(skipDelayNode.execute(createContext("not-a-timer"))).toEqual({ nextPort: "next" });
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

    it("binds self Displayable nodes to the current widget and keeps Element references for derived nodes", () => {
        registerCoreBlueprintNodes();

        const paletteTypesForWidget = (elementType: string) =>
            new Set(
                blueprintNodeRegistry.listPaletteEntries({
                    graphKind: "event",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "owner" },
                    widgetElementType: elementType,
                }).map(entry => entry.type),
            );

        for (const type of ["nl.container", "nl.text", "nl.image", "nl.button"]) {
            const entries = paletteTypesForWidget(type);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT)).toBe(true);
        }

        const selfDisplayableEntries = blueprintNodeRegistry.listPaletteEntries({
            graphKind: "event",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "owner" },
            widgetElementType: "nl.image",
        });
        const setSelfProperty = selfDisplayableEntries.find(
            entry => entry.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
        );
        expect(setSelfProperty?.category).toBe("Displayable");
        expect(setSelfProperty?.pins.some(pin => pin.id === "element")).toBe(false);

        for (const type of ["nl.slider", "nl.list", "nl.frame"]) {
            const entries = paletteTypesForWidget(type);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)).toBe(true);
            expect(entries.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT)).toBe(false);
        }
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
        expect(valuePaletteTypes.has("blueprint.event.head.flush")).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_REF)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_BOOLEAN_AND)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_COMPARE_EQUAL)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_COMMENT)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_GET)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOCAL_SET)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_QUIT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_NEXT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_SKIP)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PERSISTENT_GET)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_PERSISTENT_SET)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_DELAY)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_LOG)).toBe(false);

        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(widgetPaletteTypes.has(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(false);
    });

    it("registers the Game UI slot nodes with pure/latent gating and slot widget palettes", async () => {
        registerCoreBlueprintNodes();

        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS)?.pins.map(pin => pin.id),
        ).toEqual(["notifications"]);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT)?.pins.map(pin => pin.id),
        ).toEqual(["count"]);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE)?.pins.map(pin => pin.id),
        ).toEqual(["isNvlMode"]);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ)?.pins.map(pin => pin.id),
        ).toEqual(["isRead"]);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ)?.isPure,
        ).toBe(true);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ)?.pins.map(pin => pin.id),
        ).toEqual(["in", "next"]);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ)?.isPure,
        ).toBe(false);
        expect(
            gameBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_GAME_CHOOSE)?.pins.map(pin => pin.id),
        ).toEqual(["in", "next", "index"]);

        const valuePaletteTypes = new Set(
            blueprintNodeRegistry.listPaletteEntries({
                graphKind: "event",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
                widgetElementType: "nl.text",
                isBlueprintValueGraph: true,
            }).map(entry => entry.type),
        );
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ)).toBe(true);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ)).toBe(false);
        expect(valuePaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_CHOOSE)).toBe(false);

        for (const widgetElementType of ["nl.notification.list", "nl.choice.list", "nl.nvl.list"]) {
            const slotPaletteTypes = new Set(
                blueprintNodeRegistry.listPaletteEntries({
                    graphKind: "event",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "slot-list" },
                    widgetElementType,
                }).map(entry => entry.type),
            );
            expect(slotPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
            expect(slotPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER)).toBe(true);
            expect(slotPaletteTypes.has(BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS)).toBe(true);
            expect(slotPaletteTypes.has(BLUEPRINT_NODE_TYPE_GAME_CHOOSE)).toBe(true);
        }

        const chosenIndexes: number[] = [];
        await executeGraph({
            graph: {
                id: "choose",
                entries: { main: { start: { nodeId: "choose", port: "in" } } },
                nodes: {
                    choose: {
                        id: "choose",
                        type: BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
                        params: { index: 2 },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "choose", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ chosenIndexes }),
        });
        expect(chosenIndexes).toEqual([2]);

        const clearTextReadCalls: boolean[] = [];
        await executeGraph({
            graph: {
                id: "clear-text-read",
                entries: { main: { start: { nodeId: "clear", port: "in" } } },
                nodes: {
                    clear: {
                        id: "clear",
                        type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ,
                        params: {},
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "clear", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ clearTextReadCalls }),
        });
        expect(clearTextReadCalls).toEqual([true]);

        await expect(executeGraph({
            graph: {
                id: "choose-invalid",
                entries: { main: { start: { nodeId: "choose", port: "in" } } },
                nodes: {
                    choose: {
                        id: "choose",
                        type: BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
                        params: { index: -1 },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "choose", port: "in" } },
            hostAdapter: createGameSaveHostAdapter({ chosenIndexes }),
        })).rejects.toThrow("Select Choice: index must be a non-negative integer");
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
        expect(byType.get("blueprint.event.head.flush")?.category).toBe("Events");
        expect(byType.get(BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)?.category).toBe("Flow");
        expect(byType.get(BLUEPRINT_NODE_TYPE_ELEMENT_REF)?.category).toBe("Element");
        expect(byType.has(BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR)).toBe(false);
        expect(byType.get(BLUEPRINT_NODE_TYPE_LOCAL_GET)?.category).toBe("Variables");
        expect(byType.get(BLUEPRINT_NODE_TYPE_LOCAL_SET)?.category).toBe("Variables");
        expect(byType.get(BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)?.category).toBe("Game");
        expect(byType.get(BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME)?.category).toBe("Game");
        expect(byType.get(BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY)?.category).toBe("Game");
        expect(byType.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_GAME_QUIT)).toBe(false);
        expect(byType.has(BLUEPRINT_NODE_TYPE_GAME_NEXT)).toBe(false);
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
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(false);
        expect(globalPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);

        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(true);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(false);
        expect(surfacePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);

        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(false);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(true);
        expect(buttonPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);

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
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK)).toBe(false);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(true);
        expect(listPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);

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
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK)).toBe(false);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL)).toBe(false);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(true);
        expect(sliderPaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);

        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(false);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK)).toBe(false);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GO)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_PAGE_QUIT)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM)).toBe(false);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE)).toBe(true);
        expect(framePaletteTypes.has(BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE)).toBe(true);
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

    it("resolves Displayable Get Property against self and element targets without exposing Variant ids", () => {
        const displayableProps = {
            self: {
                position: { x: 11, y: 22 },
                offset: { x: 7, y: -3 },
                size: { width: 100, height: 50 },
                bounds: { x: 11, y: 22, width: 100, height: 50 },
                rotation: 5,
                opacity: 0.75,
                display: true,
                visible: true,
            },
            target: {
                position: { x: 40, y: 80 },
                offset: { x: 12, y: -8 },
                size: { width: 200, height: 90 },
                bounds: { x: 40, y: 80, width: 200, height: 90 },
                rotation: 10,
                opacity: 0.5,
                display: false,
                visible: false,
            },
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: (elementId: keyof typeof displayableProps) => displayableProps[elementId],
                        getCommonProperties: (elementId: string) => ({
                            visible: true,
                            enabled: true,
                            variantId: elementId === "target" ? "variant-target" : "variant-self",
                        }),
                    },
                },
            },
        } as unknown as UIHostAdapter;

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getX: { type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY, params: { property: "x" } },
                    },
                    edges: [],
                },
                "getX",
                "value",
                { property: "x" },
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(11);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getOffsetX: {
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
                            params: { property: "offsetX" },
                        },
                    },
                    edges: [],
                },
                "getOffsetX",
                "value",
                { property: "offsetX" },
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(7);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        ref: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                            params: {
                                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                                [ELEMENT_REF_PARAM_ELEMENT_ID]: "target",
                                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.image",
                            },
                        },
                        getOpacity: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
                            params: { property: "opacity" },
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "getOpacity", port: "element" },
                        },
                    ],
                },
                "getOpacity",
                "value",
                { property: "opacity" },
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(0.5);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        ref: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                            params: {
                                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                                [ELEMENT_REF_PARAM_ELEMENT_ID]: "target",
                                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.image",
                            },
                        },
                        getOffsetY: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
                            params: { property: "offsetY" },
                        },
                    },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "getOffsetY", port: "element" },
                        },
                    ],
                },
                "getOffsetY",
                "value",
                { property: "offsetY" },
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(-8);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getDisplay: { type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY, params: {} },
                    },
                    edges: [],
                },
                "getDisplay",
                "display",
                {},
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(true);

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        ref: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                            params: {
                                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                                [ELEMENT_REF_PARAM_ELEMENT_ID]: "target",
                                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.image",
                            },
                        },
                        getDisplay: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY, params: {} },
                    },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "getDisplay", port: "element" },
                        },
                    ],
                },
                "getDisplay",
                "display",
                {},
                undefined,
                0,
                {
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
                },
            ),
        ).toBe(false);
    });

    it("executes Displayable Set Variant with a wait-for-animation option", async () => {
        let setVariantCall: {
            elementId: string;
            variantId: string | null;
            waitForTransition: boolean | undefined;
        } | null = null;
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        setVariant: async (
                            elementId: string,
                            variantId: string | null,
                            options?: { waitForTransition?: boolean },
                        ) => {
                            setVariantCall = {
                                elementId,
                                variantId,
                                waitForTransition: options?.waitForTransition,
                            };
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;

        const setVariant = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT)!;
        await Promise.resolve(
            setVariant.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setVariant", port: "in" } } },
                    nodes: {
                        setVariant: {
                            id: "setVariant",
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
                            params: { variantId: "variant-visible", waitForTransition: "wait" },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setVariant", port: "in" } },
                node: {
                    id: "setVariant",
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
                    params: { variantId: "variant-visible", waitForTransition: "wait" },
                },
                params: { variantId: "variant-visible", waitForTransition: "wait" },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(setVariantCall).toEqual({
            elementId: "image",
            variantId: "variant-visible",
            waitForTransition: true,
        });
    });

    it("rejects Element Displayable Set Variant targets that do not support Appearance variants", async () => {
        let setVariantCalled = false;
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        setVariant: async () => {
                            setVariantCalled = true;
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const setElementVariant = elementBlueprintNodes.find(def =>
            def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT
        )!;
        const node = {
            id: "setVariant",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
            params: { variantId: "variant-visible", waitForTransition: "wait" },
        };

        await expect(Promise.resolve(
            setElementVariant.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setVariant", port: "in" } } },
                    nodes: {
                        ref: {
                            id: "ref",
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                            params: {
                                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                                [ELEMENT_REF_PARAM_ELEMENT_ID]: "slider",
                                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.slider",
                            },
                        },
                        setVariant: node,
                    },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "setVariant", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "setVariant", port: "in" } },
                node,
                params: node.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        )).rejects.toThrow("cannot target nl.slider");
        expect(setVariantCalled).toBe(false);
    });

    it("executes Displayable opacity writes and animations as editor percentages", async () => {
        let displayablePatch: Record<string, unknown> | undefined;
        const displayablePatchCalls: Record<string, unknown>[] = [];
        let displayableMotion: { target?: Record<string, unknown>; transition?: Record<string, unknown> } | undefined;
        const currentDisplayable = {
            position: { x: 12, y: 0 },
            offset: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            bounds: { x: 12, y: 0, width: 100, height: 100 },
            rotation: 0,
            opacity: 0,
            display: true,
            visible: true,
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: () => currentDisplayable,
                        setDisplayableProperties: async (_elementId: string, patch: Record<string, unknown>) => {
                            displayablePatch = patch;
                            displayablePatchCalls.push(patch);
                        },
                        animateDisplayable: async (_elementId: string, request: { target?: Record<string, unknown>; transition?: Record<string, unknown> }) => {
                            displayableMotion = request;
                            return { id: "motion", ...request };
                        },
                        stopDisplayableAnimation: async () => undefined,
                    },
                },
            },
        } as unknown as UIHostAdapter;

        const setOpacity = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)!;
        await Promise.resolve(
            setOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setOpacity", port: "in" } } },
                    nodes: {
                        setOpacity: {
                            id: "setOpacity",
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                            params: { property: "opacity", value: 50 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setOpacity", port: "in" } },
                node: {
                    id: "setOpacity",
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "opacity", value: 50 },
                },
                params: { property: "opacity", value: 50 },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayablePatch).toEqual({ opacity: 0.5 });

        const setDisplay = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY)!;
        await Promise.resolve(
            setDisplay.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setDisplay", port: "in" } } },
                    nodes: {
                        setDisplay: {
                            id: "setDisplay",
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY,
                            params: { display: false },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setDisplay", port: "in" } },
                node: {
                    id: "setDisplay",
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY,
                    params: { display: false },
                },
                params: { display: false },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayablePatch).toEqual({ display: false });

        const animateOpacity = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)!;
        const animateOpacityResult = await Promise.resolve(
            animateOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateOpacity", port: "in" } } },
                    nodes: {
                        animateOpacity: {
                            id: "animateOpacity",
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                            params: {
                                property: "opacity",
                                from: 0,
                                to: 100,
                                duration: 0.3,
                                delay: 0,
                                easing: "easeOut",
                                after: "hold",
                            },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "animateOpacity", port: "in" } },
                node: {
                    id: "animateOpacity",
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                    params: {
                        property: "opacity",
                        from: 0,
                        to: 100,
                        duration: 0.3,
                        delay: 0,
                        easing: "easeOut",
                        after: "hold",
                    },
                },
                params: {
                    property: "opacity",
                    from: 0,
                    to: 100,
                    duration: 0.3,
                    delay: 0,
                    easing: "easeOut",
                    after: "hold",
                },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(animateOpacityResult).toMatchObject({
            nextPort: "next",
            outputValues: {
                animation: {
                    kind: "animation",
                    id: expect.any(String),
                },
            },
        });
        expect(displayableMotion).toMatchObject({
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 300, delayMs: 0 },
        });

        const animateOpacityFromCurrentNode = {
            id: "animateOpacityFromCurrent",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "opacity",
                to: 100,
                duration: 0.3,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateOpacityFromCurrent", port: "in" } } },
                    nodes: { animateOpacityFromCurrent: animateOpacityFromCurrentNode },
                    edges: [],
                },
                entry: { start: { nodeId: "animateOpacityFromCurrent", port: "in" } },
                node: animateOpacityFromCurrentNode,
                params: animateOpacityFromCurrentNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayableMotion).toMatchObject({
            target: { opacity: { from: "current", to: 1 } },
            transition: { type: "tween", durationMs: 300, delayMs: 0 },
        });

        const animateOpacityOnePercentNode = {
            id: "animateOpacityOnePercent",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "opacity",
                from: 0,
                to: 1,
                duration: 0.3,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateOpacityOnePercent", port: "in" } } },
                    nodes: { animateOpacityOnePercent: animateOpacityOnePercentNode },
                    edges: [],
                },
                entry: { start: { nodeId: "animateOpacityOnePercent", port: "in" } },
                node: animateOpacityOnePercentNode,
                params: animateOpacityOnePercentNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayableMotion).toMatchObject({
            target: { opacity: [0, 0.01] },
            transition: { type: "tween", durationMs: 300, delayMs: 0 },
        });

        const setOffset = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)!;
        await Promise.resolve(
            setOffset.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setOffset", port: "in" } } },
                    nodes: {
                        setOffset: {
                            id: "setOffset",
                            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                            params: { property: "offsetX", value: 24 },
                        },
                    },
                    edges: [],
                },
                entry: { start: { nodeId: "setOffset", port: "in" } },
                node: {
                    id: "setOffset",
                    type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
                    params: { property: "offsetX", value: 24 },
                },
                params: { property: "offsetX", value: 24 },
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayablePatch).toEqual({ offsetX: 24 });

        const animateXNode = {
            id: "animateX",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "x",
                from: 0,
                [BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT]: true,
                to: 64,
                duration: 0.2,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateX", port: "in" } } },
                    nodes: { animateX: animateXNode },
                    edges: [],
                },
                entry: { start: { nodeId: "animateX", port: "in" } },
                node: animateXNode,
                params: animateXNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayablePatch).toEqual({ offsetX: 24 });
        expect(displayableMotion).toMatchObject({
            target: { x: [-12, 52] },
            transition: { type: "tween", durationMs: 200, delayMs: 0 },
            commitLayoutOnComplete: { x: 64 },
        });

        const animateLegacyDefaultXNode = {
            id: "animateLegacyDefaultX",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "x",
                from: 0,
                to: 64,
                duration: 0.2,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        const legacyDefaultPatchCallCount = displayablePatchCalls.length;
        await Promise.resolve(
            animateOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateLegacyDefaultX", port: "in" } } },
                    nodes: { animateLegacyDefaultX: animateLegacyDefaultXNode },
                    edges: [],
                },
                entry: { start: { nodeId: "animateLegacyDefaultX", port: "in" } },
                node: animateLegacyDefaultXNode,
                params: animateLegacyDefaultXNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
            }),
        );

        expect(displayablePatch).toEqual({ offsetX: 24 });
        expect(displayablePatchCalls.slice(legacyDefaultPatchCallCount)).toEqual([]);
        expect(displayableMotion).toMatchObject({
            target: { x: [0, 52] },
            transition: { type: "tween", durationMs: 200, delayMs: 0 },
            commitLayoutOnComplete: { x: 64 },
        });
    });

    it("requests held Displayable x animations without pre-patching layout", async () => {
        vi.useFakeTimers();
        const originalRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
        Object.defineProperty(globalThis, "requestAnimationFrame", {
            configurable: true,
            writable: true,
            value: vi.fn(() => 1),
        });
        const displayablePatchCalls: Record<string, unknown>[] = [];
        const stoppedAnimationIds: string[] = [];
        let displayableMotion: { target?: Record<string, unknown>; transition?: Record<string, unknown> } | undefined;
        const currentDisplayable = {
            position: { x: -500, y: 0 },
            offset: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            bounds: { x: -500, y: 0, width: 100, height: 100 },
            rotation: 0,
            opacity: 1,
            display: true,
            visible: true,
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: () => currentDisplayable,
                        setDisplayableProperties: async (_elementId: string, patch: Record<string, unknown>) => {
                            displayablePatchCalls.push(patch);
                        },
                        animateDisplayable: async (_elementId: string, request: { target?: Record<string, unknown>; transition?: Record<string, unknown> }) => {
                            displayableMotion = request;
                            return { id: "motion", ...request };
                        },
                        stopDisplayableAnimation: async (animationId: string) => {
                            stoppedAnimationIds.push(animationId);
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const animateX = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY)!;
        const animateXNode = {
            id: "animateX",
            type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "x",
                to: 0,
                duration: 0.2,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };

        try {
            const execution = Promise.resolve(
                animateX.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId: "animateX", port: "in" } } },
                        nodes: { animateX: animateXNode },
                        edges: [],
                    },
                    entry: { start: { nodeId: "animateX", port: "in" } },
                    node: animateXNode,
                    params: animateXNode.params,
                    hostAdapter,
                    executionOwner: { surfaceId: "surface", elementId: "image", blueprintId: "bp" },
                }),
            );

            await vi.advanceTimersByTimeAsync(50);
            await expect(execution).resolves.toMatchObject({
                nextPort: "next",
                outputValues: {
                    animation: {
                        kind: "animation",
                        id: expect.stringMatching(/^animation:bp:surface:image:-:-:graph:animateX:\d+$/),
                    },
                },
            });
        } finally {
            vi.useRealTimers();
            if (originalRafDescriptor) {
                Object.defineProperty(globalThis, "requestAnimationFrame", originalRafDescriptor);
            } else {
                delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
            }
        }

        expect(displayablePatchCalls).toEqual([]);
        expect(displayableMotion).toMatchObject({
            target: { x: [0, 500] },
            transition: { type: "tween", durationMs: 200, delayMs: 0 },
            commitLayoutOnComplete: { x: 0 },
        });
        expect(stoppedAnimationIds).toEqual([]);
    });

    it("stops Displayable animations through AnimationToken input", async () => {
        const stopAnimation = elementBlueprintNodes.find(def => def.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION)!;
        const stoppedAnimationIds: string[] = [];
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        stopDisplayableAnimation: async (animationId: string) => {
                            stoppedAnimationIds.push(animationId);
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const createContext = (animation: unknown) => ({
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "stop", port: "in" } } },
                nodes: {
                    stop: {
                        id: "stop",
                        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
                        params: { animation },
                    },
                },
                edges: [],
            },
            entry: { start: { nodeId: "stop", port: "in" } },
            node: {
                id: "stop",
                type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
                params: { animation },
            },
            params: { animation },
            hostAdapter,
        });

        await expect(Promise.resolve(stopAnimation.execute(createContext({ kind: "animation", id: "animation:one" })))).resolves.toEqual({
            nextPort: "next",
        });
        await expect(Promise.resolve(stopAnimation.execute(createContext({ kind: "timer", id: "animation:one" })))).resolves.toEqual({
            nextPort: "next",
        });
        await expect(Promise.resolve(stopAnimation.execute(createContext("not-an-animation")))).resolves.toEqual({ nextPort: "next" });
        expect(stoppedAnimationIds).toEqual(["animation:one"]);
    });

    it("executes Element Displayable property writes and animations through Element refs", async () => {
        let displayablePatchCall: { elementId: string; patch: Record<string, unknown> } | undefined;
        let displayableMotionCall: { elementId: string; target?: Record<string, unknown>; transition?: Record<string, unknown> } | undefined;
        const currentDisplayable = {
            position: { x: 0, y: 0 },
            offset: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            rotation: 0,
            opacity: 0,
            display: true,
            visible: true,
        };
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                hostApi: {
                    widget: {
                        getDisplayableProperties: () => currentDisplayable,
                        setDisplayableProperties: async (elementId: string, patch: Record<string, unknown>) => {
                            displayablePatchCall = { elementId, patch };
                        },
                        animateDisplayable: async (elementId: string, request: { target?: Record<string, unknown>; transition?: Record<string, unknown> }) => {
                            displayableMotionCall = { elementId, target: request.target, transition: request.transition };
                            return { id: "motion", ...request };
                        },
                        stopDisplayableAnimation: async () => undefined,
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const refNode = {
            id: "ref",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
            params: {
                [ELEMENT_REF_PARAM_SURFACE_ID]: "surface",
                [ELEMENT_REF_PARAM_ELEMENT_ID]: "target",
                [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.image",
            },
        };

        const setElementOpacity = elementBlueprintNodes.find(def =>
            def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY
        )!;
        const setNode = {
            id: "setOpacity",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
            params: { property: "opacity", value: 25 },
        };
        await Promise.resolve(
            setElementOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setOpacity", port: "in" } } },
                    nodes: { ref: refNode, setOpacity: setNode },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "setOpacity", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "setOpacity", port: "in" } },
                node: setNode,
                params: setNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        );

        expect(displayablePatchCall).toEqual({ elementId: "target", patch: { opacity: 0.25 } });

        const setElementDisplay = elementBlueprintNodes.find(def =>
            def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY
        )!;
        const setDisplayNode = {
            id: "setDisplay",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY,
            params: { display: false },
        };
        await Promise.resolve(
            setElementDisplay.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "setDisplay", port: "in" } } },
                    nodes: { ref: refNode, setDisplay: setDisplayNode },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "setDisplay", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "setDisplay", port: "in" } },
                node: setDisplayNode,
                params: setDisplayNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        );

        expect(displayablePatchCall).toEqual({ elementId: "target", patch: { display: false } });

        const animateElementOpacity = elementBlueprintNodes.find(def =>
            def.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY
        )!;
        const animateNode = {
            id: "animateOpacity",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "opacity",
                from: 25,
                to: 100,
                duration: 0.3,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateElementOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateOpacity", port: "in" } } },
                    nodes: { ref: refNode, animateOpacity: animateNode },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "animateOpacity", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "animateOpacity", port: "in" } },
                node: animateNode,
                params: animateNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        );

        expect(displayableMotionCall).toMatchObject({
            elementId: "target",
            target: { opacity: [0.25, 1] },
            transition: { type: "tween", durationMs: 300, delayMs: 0 },
        });

        const animateFromCurrentNode = {
            id: "animateFromCurrent",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "opacity",
                to: 50,
                duration: 0.2,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateElementOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateFromCurrent", port: "in" } } },
                    nodes: { ref: refNode, animateFromCurrent: animateFromCurrentNode },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "animateFromCurrent", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "animateFromCurrent", port: "in" } },
                node: animateFromCurrentNode,
                params: animateFromCurrentNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        );

        expect(displayableMotionCall).toMatchObject({
            elementId: "target",
            target: { opacity: { from: "current", to: 0.5 } },
            transition: { type: "tween", durationMs: 200, delayMs: 0 },
        });

        const animateOnePercentNode = {
            id: "animateOnePercent",
            type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
            params: {
                property: "opacity",
                from: 0,
                to: 1,
                duration: 0.2,
                delay: 0,
                easing: "easeOut",
                after: "hold",
            },
        };
        await Promise.resolve(
            animateElementOpacity.execute({
                graph: {
                    id: "graph",
                    entries: { main: { start: { nodeId: "animateOnePercent", port: "in" } } },
                    nodes: { ref: refNode, animateOnePercent: animateOnePercentNode },
                    edges: [
                        {
                            from: { nodeId: "ref", port: "element" },
                            to: { nodeId: "animateOnePercent", port: "element" },
                        },
                    ],
                },
                entry: { start: { nodeId: "animateOnePercent", port: "in" } },
                node: animateOnePercentNode,
                params: animateOnePercentNode.params,
                hostAdapter,
                executionOwner: { surfaceId: "surface", elementId: "self", blueprintId: "bp" },
            }),
        );

        expect(displayableMotionCall).toMatchObject({
            elementId: "target",
            target: { opacity: [0, 0.01] },
            transition: { type: "tween", durationMs: 200, delayMs: 0 },
        });
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

    it("executes Button Set Pointer nodes", async () => {
        registerCoreBlueprintNodes();

        let buttonProps = {
            label: "Go",
            cursor: "pointer" as const,
        };
        let lastButtonPatchElementId: string | null = null;
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
                        getButtonProperties: () => buttonProps,
                        setButtonProperties: async (elementId: string, patch: Partial<typeof buttonProps>) => {
                            lastButtonPatchElementId = elementId;
                            buttonProps = { ...buttonProps, ...patch };
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const owner = { surfaceId: "surface", elementId: "button", blueprintId: "bp" };
        const executeButtonNode = async (
            type: string,
            nodeId: string,
            params: Record<string, unknown>,
            graphPatch?: {
                nodes?: Record<string, { id: string; type: string; params?: Record<string, unknown> }>;
                edges?: { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }[];
            },
        ) => {
            const def = widgetPropertyBlueprintNodes.find(node => node.type === type)!;
            await Promise.resolve(
                def.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId, port: "in" } } },
                        nodes: {
                            ...(graphPatch?.nodes ?? {}),
                            [nodeId]: { id: nodeId, type, params },
                        },
                        edges: graphPatch?.edges ?? [],
                    },
                    entry: { start: { nodeId, port: "in" } },
                    node: { id: nodeId, type, params },
                    params,
                    hostAdapter,
                    executionOwner: owner,
                }),
            );
        };

        await executeButtonNode(BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER, "setPointerDefault", {});
        expect(buttonProps.cursor).toBe("auto");

        await executeButtonNode(BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER, "setPointerCrosshair", { cursor: "crosshair" });
        expect(buttonProps.cursor).toBe("crosshair");

        await executeButtonNode(
            BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER,
            "setElementPointer",
            { cursor: "grab" },
            {
                nodes: {
                    buttonRef: {
                        id: "buttonRef",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                        params: { surfaceId: "surface", elementId: "other-button", elementType: "nl.button" },
                    },
                },
                edges: [
                    {
                        from: { nodeId: "buttonRef", port: "element" },
                        to: { nodeId: "setElementPointer", port: "element" },
                    },
                ],
            },
        );
        expect(lastButtonPatchElementId).toBe("other-button");
        expect(buttonProps.cursor).toBe("grab");
    });

    it("executes Image write nodes and resolves Image reads", async () => {
        registerCoreBlueprintNodes();

        type ImageProps = {
            asset: { kind: "imageAsset"; assetId: string } | null;
            assetId: string | null;
            fitMode: "cover" | "contain" | "stretch" | "crop" | "tile";
            cropRect: { leftPct: number; topPct: number; widthPct: number; heightPct: number };
            flipX: boolean;
            flipY: boolean;
        };
        let imageProps: ImageProps = {
            asset: { kind: "imageAsset" as const, assetId: "old-image" },
            assetId: "old-image",
            fitMode: "cover",
            cropRect: { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 },
            flipX: false,
            flipY: false,
        };
        let lastImagePatchElementId: string | null = null;
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
                        setImageProperties: async (elementId: string, patch: Partial<ImageProps>) => {
                            lastImagePatchElementId = elementId;
                            const hasAssetPatch = Object.prototype.hasOwnProperty.call(patch, "asset");
                            const asset = hasAssetPatch
                                ? patch.asset ?? null
                                : patch.assetId === undefined
                                  ? imageProps.asset
                                  : patch.assetId
                                    ? { kind: "imageAsset" as const, assetId: patch.assetId }
                                    : null;
                            imageProps = {
                                ...imageProps,
                                ...patch,
                                asset,
                                assetId: asset?.assetId ?? null,
                            };
                        },
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const owner = { surfaceId: "surface", elementId: "image", blueprintId: "bp" };
        const executeImageNode = async (
            type: string,
            nodeId: string,
            params: Record<string, unknown>,
            graphPatch?: {
                nodes?: Record<string, { id: string; type: string; params?: Record<string, unknown> }>;
                edges?: { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }[];
            },
        ) => {
            const def = widgetPropertyBlueprintNodes.find(node => node.type === type)!;
            await Promise.resolve(
                def.execute({
                    graph: {
                        id: "graph",
                        entries: { main: { start: { nodeId, port: "in" } } },
                        nodes: {
                            ...(graphPatch?.nodes ?? {}),
                            [nodeId]: { id: nodeId, type, params },
                        },
                        edges: graphPatch?.edges ?? [],
                    },
                    entry: { start: { nodeId, port: "in" } },
                    node: { id: nodeId, type, params },
                    params,
                    hostAdapter,
                    executionOwner: owner,
                }),
            );
        };

        await executeImageNode(
            BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
            "setImage",
            { asset: { kind: "imageAsset", assetId: "new-image" } },
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

        await executeImageNode(
            BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
            "setLegacy",
            {},
            {
                nodes: {
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "legacy-image" },
                    },
                },
                edges: [
                    {
                        from: { nodeId: "literal", port: "value" },
                        to: { nodeId: "setLegacy", port: "assetId" },
                    },
                ],
            },
        );

        expect(imageProps.asset).toEqual({ kind: "imageAsset", assetId: "legacy-image" });

        await executeImageNode(BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE, "setFitMode", { fitMode: "contain" });
        expect(imageProps.fitMode).toBe("contain");
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getFitMode: { type: BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE },
                    },
                    edges: [],
                },
                "getFitMode",
                "fitMode",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe("contain");

        await executeImageNode(BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT, "setCropRect", {
            leftPct: 12,
            topPct: 8,
            widthPct: 64,
            heightPct: 72,
        });
        expect(imageProps.fitMode).toBe("crop");
        expect(imageProps.cropRect).toEqual({ leftPct: 12, topPct: 8, widthPct: 64, heightPct: 72 });
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getCropRect: { type: BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT },
                    },
                    edges: [],
                },
                "getCropRect",
                "leftPct",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(12);

        await executeImageNode(BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X, "setFlipX", { flipX: true });
        await executeImageNode(BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y, "setFlipY", { flipY: true });
        expect(imageProps.flipX).toBe(true);
        expect(imageProps.flipY).toBe(true);
        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        getFlipY: { type: BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y },
                    },
                    edges: [],
                },
                "getFlipY",
                "flipY",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(true);

        await executeImageNode(BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET, "clearImage", {});
        expect(imageProps.asset).toBeNull();

        await executeImageNode(
            BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE,
            "setOtherFitMode",
            { fitMode: "tile" },
            {
                nodes: {
                    otherImageRef: {
                        id: "otherImageRef",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                        params: { surfaceId: "surface", elementId: "other-image", elementType: "nl.image" },
                    },
                },
                edges: [
                    {
                        from: { nodeId: "otherImageRef", port: "element" },
                        to: { nodeId: "setOtherFitMode", port: "element" },
                    },
                ],
            },
        );
        expect(lastImagePatchElementId).toBe("other-image");
        expect(imageProps.fitMode).toBe("tile");

        expect(
            resolveDataPinValue(
                {
                    nodes: {
                        otherImageRef: {
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                            params: { surfaceId: "surface", elementId: "other-image", elementType: "nl.image" },
                        },
                        getOtherCropRect: { type: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT },
                    },
                    edges: [
                        {
                            from: { nodeId: "otherImageRef", port: "element" },
                            to: { nodeId: "getOtherCropRect", port: "element" },
                        },
                    ],
                },
                "getOtherCropRect",
                "widthPct",
                {},
                undefined,
                0,
                { hostAdapter, executionOwner: owner },
            ),
        ).toBe(64);
    });
});

describe("fn blueprint nodes", () => {
    const FN_HEAD_TYPE = "blueprint.fn.head";
    const FN_CALL_TYPE = "blueprint.fn.call";
    const FN_RETURN_TYPE = "blueprint.fn.return";
    const CALL_SNAPSHOT = {
        name: "Echo",
        params: [{ pinId: "param_1_value", name: "input", valueType: "string" }],
        returns: [{ pinId: "ret_1_value", name: "result", valueType: "integer" }],
    };

    it("maps invoke returns to Call Fn output values and forwards caller context", async () => {
        const callDef = fnBlueprintNodes.find(def => def.type === FN_CALL_TYPE)!;
        const invokeBlueprintFn = vi.fn(async () => ({ returns: { ret_1_value: 42 } }));
        const params = {
            fnRef: "fn:bp-a:head",
            __fnSignatureSnapshot: CALL_SNAPSHOT,
            param_1_value: "hello",
        };
        const node = { id: "call", type: FN_CALL_TYPE, params };

        const result = await callDef.execute({
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "call", port: "in" } } },
                nodes: { call: node },
                edges: [],
            },
            entry: { start: { nodeId: "call", port: "in" } },
            node,
            params,
            hostAdapter: {
                host: "player",
                blueprintRuntime: {
                    surfaceId: "s1",
                    setSurfaceState: () => undefined,
                    getSurfaceState: () => undefined,
                    emitDebug: () => undefined,
                    dispatchElementBlueprintEvent: async () => undefined,
                    invokeBlueprintFn,
                },
            },
            executionOwner: { surfaceId: "s1", blueprintId: "bp-caller" },
        });

        expect(result).toEqual({ outputValues: { ret_1_value: 42 }, nextPort: "next" });
        expect(invokeBlueprintFn).toHaveBeenCalledWith(
            expect.objectContaining({
                fnRef: "fn:bp-a:head",
                args: { param_1_value: "hello" },
                callerSurfaceId: "s1",
                depth: 0,
            }),
        );
    });

    it("throws when the fn runtime is unavailable or no fn is picked", async () => {
        const callDef = fnBlueprintNodes.find(def => def.type === FN_CALL_TYPE)!;
        const baseCtx = {
            graph: {
                id: "graph",
                entries: { main: { start: { nodeId: "call", port: "in" } } },
                nodes: { call: { id: "call", type: FN_CALL_TYPE } },
                edges: [],
            },
            entry: { start: { nodeId: "call", port: "in" } },
            node: { id: "call", type: FN_CALL_TYPE },
        };

        await expect(
            callDef.execute({
                ...baseCtx,
                params: { fnRef: "fn:bp-a:head" },
                hostAdapter: { host: "player" },
            }),
        ).rejects.toThrow(/Fn runtime is unavailable/);

        await expect(
            callDef.execute({
                ...baseCtx,
                params: {},
                hostAdapter: {
                    host: "player",
                    blueprintRuntime: {
                        surfaceId: "s1",
                        setSurfaceState: () => undefined,
                        getSurfaceState: () => undefined,
                        emitDebug: () => undefined,
                        dispatchElementBlueprintEvent: async () => undefined,
                        invokeBlueprintFn: async () => ({ returns: {} }),
                    },
                },
            }),
        ).rejects.toThrow(/Pick a function/);
    });

    it("resolves fn head parameter pins with per-pin labels and types", () => {
        const headDef = blueprintNodeRegistry.get(FN_HEAD_TYPE) ?? fnBlueprintNodes.find(def => def.type === FN_HEAD_TYPE)!;
        const pins = resolveEffectiveBlueprintNodePins(headDef, {
            __fnParamPinIds: ["param_1_value", "param_2_value"],
            __fnParamPinLabels: { param_1_value: "count", param_2_value: "flag" },
            __fnParamPinTypes: { param_2_value: "boolean" },
        });

        const first = pins.find(pin => pin.id === "param_1_value");
        const second = pins.find(pin => pin.id === "param_2_value");
        expect(first).toMatchObject({ kind: "output", semantic: "data", label: "count", valueType: "string" });
        expect(second).toMatchObject({ kind: "output", semantic: "data", label: "flag", valueType: "boolean" });

        const entry = resolveEffectiveBlueprintCatalogEntry(headDef, {
            __fnParamPinIds: ["param_1_value"],
        });
        expect(entry.pins.find(pin => pin.id === "param_1_value")?.removable).toBe(true);
        expect(entry.dynamicInputPinTypeParamKey).toBe("__fnParamPinTypes");
    });

    it("synthesizes Call Fn pins from the signature snapshot", () => {
        const callDef = fnBlueprintNodes.find(def => def.type === FN_CALL_TYPE)!;
        const pins = resolveEffectiveBlueprintNodePins(callDef, { __fnSignatureSnapshot: CALL_SNAPSHOT });

        expect(pins.find(pin => pin.id === "param_1_value")).toMatchObject({
            kind: "input",
            semantic: "data",
            valueType: "string",
            label: "input",
            allowInlineLiteral: true,
        });
        expect(pins.find(pin => pin.id === "ret_1_value")).toMatchObject({
            kind: "output",
            semantic: "data",
            valueType: "integer",
            label: "result",
        });
        // Without a snapshot only the exec pins remain.
        expect(resolveEffectiveBlueprintNodePins(callDef, {}).map(pin => pin.id)).toEqual(["in", "next"]);
    });

    it("never offers inline literals on Fn Return result pins", () => {
        const returnDef = fnBlueprintNodes.find(def => def.type === FN_RETURN_TYPE)!;
        const pins = resolveEffectiveBlueprintNodePins(returnDef, {
            __fnReturnPinIds: ["ret_1_value", "ret_2_value"],
            __fnReturnPinTypes: { ret_2_value: "json" },
        });

        expect(pins.find(pin => pin.id === "ret_1_value")?.allowInlineLiteral).toBe(false);
        expect(pins.find(pin => pin.id === "ret_2_value")?.allowInlineLiteral).toBe(false);
    });

    it("allows Call Fn (but not Fn head/return) in Blueprint Value graph palettes", () => {
        registerCoreBlueprintNodes();
        const valuePaletteTypes = new Set(
            blueprintNodeRegistry
                .listPaletteEntries({
                    graphKind: "event",
                    owner: { kind: "widgetValue", surfaceId: "s1", elementId: "text", propPath: "props.text" },
                    widgetElementType: "nl.text",
                    isBlueprintValueGraph: true,
                })
                .map(entry => entry.type),
        );
        expect(valuePaletteTypes.has(FN_CALL_TYPE)).toBe(true);
        expect(valuePaletteTypes.has(FN_HEAD_TYPE)).toBe(false);
        expect(valuePaletteTypes.has(FN_RETURN_TYPE)).toBe(false);
    });
});
