import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
} from "@shared/types/blueprint/graph";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
} from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { listBlueprintSetFramePageTargetOptions } from "./frameTargetSurfaceOptions";

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "home",
                name: "Home",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-home",
            },
            {
                id: "details",
                name: "Details",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-details",
            },
            {
                id: "settings",
                name: "Settings",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-settings",
            },
        ],
        elements: {
            "root-home": {
                id: "root-home",
                type: "nl.root",
                parentId: null,
                childrenIds: ["frame-home"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            "frame-home": {
                id: "frame-home",
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "root-home",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 120, height: 80 },
                props: { targetSurfaceId: null, params: {}, navigationMode: "static" },
            },
            "root-details": {
                id: "root-details",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            "root-settings": {
                id: "root-settings",
                type: "nl.root",
                parentId: null,
                childrenIds: ["frame-settings"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            "frame-settings": {
                id: "frame-settings",
                type: UI_FRAME_ELEMENT_TYPE,
                parentId: "root-settings",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 120, height: 80 },
                props: { targetSurfaceId: "home", params: {}, navigationMode: "static" },
            },
        },
    };
}

function values(options: ReturnType<typeof listBlueprintSetFramePageTargetOptions>): string[] {
    return options.map(option => option.value);
}

describe("listBlueprintSetFramePageTargetOptions", () => {
    it("omits the owning Page and cycle targets for self Set Frame Page nodes", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                set: {
                    id: "set",
                    type: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
                    params: {},
                },
            },
            edges: [],
        };

        expect(values(listBlueprintSetFramePageTargetOptions({
            document: createDocument(),
            owner: { kind: "widgetMain", surfaceId: "home", elementId: "frame-home" },
            ir,
            nodeId: "set",
            nodeType: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
        }))).toEqual(["details"]);
    });

    it("omits the Element Ref Frame's owning Page for element Set Frame Page nodes", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                ref: {
                    id: "ref",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                    params: {
                        [ELEMENT_REF_PARAM_SURFACE_ID]: "home",
                        [ELEMENT_REF_PARAM_ELEMENT_ID]: "frame-home",
                        [ELEMENT_REF_PARAM_ELEMENT_TYPE]: UI_FRAME_ELEMENT_TYPE,
                    },
                },
                set: {
                    id: "set",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
                    params: {},
                },
            },
            edges: [
                { from: { nodeId: "ref", port: "element" }, to: { nodeId: "set", port: "element" } },
            ],
        };

        expect(values(listBlueprintSetFramePageTargetOptions({
            document: createDocument(),
            owner: { kind: "surfaceMain", surfaceId: "home" },
            ir,
            nodeId: "set",
            nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
        }))).toEqual(["details"]);
    });

    it("keeps all Page options when the target Frame cannot be inferred", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                set: {
                    id: "set",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
                    params: {},
                },
            },
            edges: [],
        };

        expect(values(listBlueprintSetFramePageTargetOptions({
            document: createDocument(),
            owner: { kind: "surfaceMain", surfaceId: "home" },
            ir,
            nodeId: "set",
            nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
        }))).toEqual(["home", "details", "settings"]);
    });
});

/**
 * A Set Frame Page node on a component's own graph changes a Page widget inside the definition, and
 * the page the component is placed on leads back to that widget.
 */
describe("listBlueprintSetFramePageTargetOptions inside a component", () => {
    /** The shared document, with "home" placing a card whose Page widget is `window`. */
    function withCard(): UIDocument {
        const document = createDocument();
        document.elements["root-home"]!.childrenIds.push("slot");
        document.elements.slot = {
            id: "slot",
            type: "nl.container",
            parentId: "root-home",
            childrenIds: [],
            layout: { x: 0, y: 0, width: 120, height: 80 },
            extra: { componentLink: { componentId: "card", linked: true } },
        };
        document.components = [
            {
                id: "card",
                name: "Card",
                rootElementId: "card-root",
                elements: {
                    "card-root": {
                        id: "card-root",
                        type: "nl.container",
                        parentId: null,
                        childrenIds: ["window"],
                        layout: { x: 0, y: 0, width: 120, height: 80 },
                    },
                    window: {
                        id: "window",
                        type: UI_FRAME_ELEMENT_TYPE,
                        parentId: "card-root",
                        childrenIds: [],
                        layout: { x: 0, y: 0, width: 120, height: 80 },
                        props: { targetSurfaceId: null, params: {}, navigationMode: "static" },
                    },
                },
            },
        ];
        return document;
    }

    it("omits the page the component is placed on for the widget's own Set Frame Page", () => {
        const ir: BlueprintGraphIr = {
            nodes: { set: { id: "set", type: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE, params: {} } },
            edges: [],
        };

        // home places the card; settings shows home, so it leads back to the card too.
        expect(values(listBlueprintSetFramePageTargetOptions({
            document: withCard(),
            owner: { kind: "componentWidgetMain", componentId: "card", elementId: "window" },
            ir,
            nodeId: "set",
            nodeType: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
        }))).toEqual(["details"]);
    });

    it("omits it for an element Set Frame Page aimed at the widget from the definition's graph", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                ref: {
                    id: "ref",
                    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                    params: {
                        // What a reference written inside a definition names: its virtual surface.
                        [ELEMENT_REF_PARAM_SURFACE_ID]: "component:card",
                        [ELEMENT_REF_PARAM_ELEMENT_ID]: "window",
                        [ELEMENT_REF_PARAM_ELEMENT_TYPE]: UI_FRAME_ELEMENT_TYPE,
                    },
                },
                set: { id: "set", type: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE, params: {} },
            },
            edges: [{ from: { nodeId: "ref", port: "element" }, to: { nodeId: "set", port: "element" } }],
        };

        expect(values(listBlueprintSetFramePageTargetOptions({
            document: withCard(),
            owner: { kind: "componentWidgetMain", componentId: "card", elementId: "card-root" },
            ir,
            nodeId: "set",
            nodeType: BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
        }))).toEqual(["details"]);
    });
});
