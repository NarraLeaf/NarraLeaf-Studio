import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { dispatchBlueprintUiEvent } from "./BlueprintDispatcher";
import { DebugBridge } from "./DebugBridge";

describe("BlueprintDispatcher", () => {
    it("does not emit output when a supported widget event has no event head", async () => {
        const blueprintId = "bp-widget";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Button Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {},
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "widgetMain:surface:button": {
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: 5,
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
                    mount: { kind: "persistent" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["button"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                button: {
                    id: "button",
                    type: "nl.button",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "button",
            eventName: "init",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(debug.snapshot()).toEqual([]);
    });
});
