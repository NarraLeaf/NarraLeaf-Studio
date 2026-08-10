/**
 * The runtime half of component params: what an instance supplies has to survive the trip from the
 * element tree, through a dispatch, into the graph that reads it.
 *
 * The assertions go through `Log`, not through the node in isolation, because the failure this
 * guards against is not "the resolver returns the wrong string" - it is a value that never arrives.
 * A data output that nothing registered in `graphParamResolvers` reads as `undefined` and the graph
 * still runs to completion, so a test that only checked the execution trace would pass on a node
 * that ships broken.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { DebugBridge } from "./DebugBridge";
import { dispatchBlueprintUiEvent } from "./BlueprintDispatcher";

const COMPONENT_ID = "component";
const ELEMENT_ID = "component-container";
const BLUEPRINT_ID = "bp-component-param";

/** A component blueprint whose init logs one param, so the logged value is the resolved value. */
function createBlueprintDocument(paramId: string): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [BLUEPRINT_ID]: {
                id: BLUEPRINT_ID,
                name: "Component Logic",
                owner: { kind: "componentWidgetMain", componentId: COMPONENT_ID, elementId: ELEMENT_ID },
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            init: {
                                id: "init",
                                graph: {
                                    nodes: {
                                        head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                                        param: {
                                            id: "param",
                                            type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
                                            params: { paramId },
                                        },
                                        log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG },
                                    },
                                    edges: [
                                        { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                                        { from: { nodeId: "param", port: "value" }, to: { nodeId: "log", port: "value" } },
                                    ],
                                },
                            },
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {
            [`componentWidgetMain:${COMPONENT_ID}:${ELEMENT_ID}`]: {
                activeBlueprintId: BLUEPRINT_ID,
                privateBlueprintIds: [BLUEPRINT_ID],
                initializedFrontend: "visual",
            },
        },
    };
}

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        components: [
            {
                id: COMPONENT_ID,
                name: "Component",
                rootElementId: ELEMENT_ID,
                params: [
                    { id: "saveId", name: "Save id", type: "string", defaultValue: "1" },
                    { id: "label", name: "Label", type: "string", defaultValue: "Empty" },
                ],
                elements: {
                    [ELEMENT_ID]: {
                        id: ELEMENT_ID,
                        type: "nl.container",
                        parentId: null,
                        childrenIds: [],
                        layout: { x: 0, y: 0, width: 160, height: 80 },
                    },
                },
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
        },
    };
}

/** Runs the component's init and returns what the graph logged. */
async function dispatchAndReadLoggedParam(input: {
    paramId: string;
    componentParams?: Record<string, string>;
}): Promise<unknown> {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const hostAdapter: UIHostAdapter = { host: "player" };
    try {
        await dispatchBlueprintUiEvent({
            document: createDocument(),
            blueprintDocument: createBlueprintDocument(input.paramId),
            persistentVariables: {},
            surfaceId: "surface",
            elementId: ELEMENT_ID,
            componentId: COMPONENT_ID,
            componentParams: input.componentParams,
            eventName: "init",
            hostAdapter,
            debug: new DebugBridge(),
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        expect(log).toHaveBeenCalledTimes(1);
        return log.mock.calls[0]?.[1];
    } finally {
        log.mockRestore();
    }
}

describe("Get Component Param", () => {
    it("reads the value this instance supplied", async () => {
        expect(
            await dispatchAndReadLoggedParam({
                paramId: "saveId",
                componentParams: { saveId: "7", label: "Chapter 2" },
            }),
        ).toBe("7");
    });

    // Resolution happens in the element tree, so what arrives here is already the default for a
    // param the instance left alone; the node must not second-guess it.
    it("reads the declared default when the instance supplied nothing", async () => {
        expect(
            await dispatchAndReadLoggedParam({
                paramId: "saveId",
                componentParams: { saveId: "1", label: "Empty" },
            }),
        ).toBe("1");
    });

    // An author can mean "blank"; falling back to the default here would make that unsayable.
    it("keeps an empty value empty rather than falling back", async () => {
        expect(
            await dispatchAndReadLoggedParam({
                paramId: "label",
                componentParams: { saveId: "1", label: "" },
            }),
        ).toBe("");
    });

    // Three ways to have no value at all, one answer: blueprints have a single empty value, and
    // undefined escaping into a graph would surface as a crash somewhere downstream instead.
    it("reads as empty with no instance, no chosen param, or a param that no longer exists", async () => {
        expect(await dispatchAndReadLoggedParam({ paramId: "saveId" })).toBe("");
        expect(await dispatchAndReadLoggedParam({ paramId: "", componentParams: { saveId: "7" } })).toBe("");
        expect(await dispatchAndReadLoggedParam({ paramId: "removed", componentParams: { saveId: "7" } })).toBe("");
    });
});
