import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR } from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    buildAccessibleBlueprintVariableOptions,
    createExplicitBlueprintVariableRef,
} from "./blueprintVariableRefs";

describe("blueprintVariableRefs", () => {
    it("lists page, blueprint, and global variables and disambiguates duplicate names", () => {
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                global: {
                    id: "global",
                    name: "Global",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            globalShared: { id: "globalShared", name: "shared", defaultValue: 1 },
                            globalUnique: { id: "globalUnique", name: "globalOnly", defaultValue: 2 },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
                page: {
                    id: "page",
                    name: "Page",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            pageShared: { id: "pageShared", name: "shared", defaultValue: 3 },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
                widget: {
                    id: "widget",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            widgetShared: { id: "widgetShared", name: "shared", defaultValue: 4 },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                init: {
                                    id: "init",
                                    graph: {
                                        nodes: {
                                            declaredWidget: {
                                                id: "declaredWidget",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                                params: {
                                                    variableId: "declaredWidget",
                                                    name: "declared",
                                                    valueType: "boolean",
                                                    defaultValue: true,
                                                },
                                            },
                                        },
                                        edges: [],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                globalMain: {
                    activeBlueprintId: "global",
                    privateBlueprintIds: ["global"],
                    initializedFrontend: "visual",
                },
                "surfaceMain:surface": {
                    activeBlueprintId: "page",
                    privateBlueprintIds: ["page"],
                    initializedFrontend: "visual",
                },
                "widgetMain:surface:button": {
                    activeBlueprintId: "widget",
                    privateBlueprintIds: ["widget"],
                    initializedFrontend: "visual",
                },
            },
        };

        const options = buildAccessibleBlueprintVariableOptions({
            doc,
            currentBlueprintId: "widget",
            surfaceId: "surface",
        });

        expect(options.map(option => option.value)).toEqual([
            createExplicitBlueprintVariableRef("page", "pageShared"),
            "declaredWidget",
            "widgetShared",
            createExplicitBlueprintVariableRef("global", "globalUnique"),
            createExplicitBlueprintVariableRef("global", "globalShared"),
        ]);
        expect(options.find(option => option.value === "declaredWidget")).toMatchObject({
            name: "declared",
            scopeLabel: "Blueprint",
            valueType: "boolean",
        });
        expect(options.filter(option => option.name === "shared").map(option => option.disambiguationLabel)).toEqual([
            "Page",
            "Blueprint",
            "Global",
        ]);
        expect(options.find(option => option.name === "globalOnly")?.disambiguationLabel).toBeUndefined();
    });
});
