import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR } from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    buildAccessibleBlueprintVariableOptions,
    createExplicitBlueprintVariableRef,
    listEffectiveBlueprintVariables,
} from "./blueprintVariableRefs";

describe("blueprintVariableRefs", () => {
    it("lists page, blueprint, and global variables and disambiguates duplicate names", () => {
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
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

    it("uses Var declarations for owner blueprints except Blueprint Value", () => {
        const globalBlueprint: Blueprint = {
            id: "global",
            name: "Global",
            owner: { kind: "globalMain" },
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
                                    declaredGlobal: {
                                        id: "declaredGlobal",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: {
                                            variableId: "declaredGlobal",
                                            name: "globalDeclared",
                                            valueType: "integer",
                                            defaultValue: 1,
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
        };
        const surfaceBlueprint: Blueprint = {
            id: "surface",
            name: "Surface",
            owner: { kind: "surfaceMain", surfaceId: "surface" },
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
                                    declaredSurface: {
                                        id: "declaredSurface",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: {
                                            variableId: "declaredSurface",
                                            name: "surfaceDeclared",
                                            valueType: "string",
                                            defaultValue: "ready",
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
        };
        const valueBlueprint: Blueprint = {
            id: "value",
            name: "Value",
            owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "props.text" },
            frontend: "visual",
            programKind: "graph",
            members: {
                variables: {
                    legacyValue: { id: "legacyValue", name: "legacyValue", defaultValue: "legacy" },
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
                                    declaredValue: {
                                        id: "declaredValue",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: {
                                            variableId: "declaredValue",
                                            name: "valueDeclared",
                                            valueType: "string",
                                            defaultValue: "ignored",
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
        };
        const doc: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                global: globalBlueprint,
                surface: surfaceBlueprint,
                value: valueBlueprint,
            },
            ownerRecords: {
                globalMain: {
                    activeBlueprintId: "global",
                    privateBlueprintIds: ["global"],
                    initializedFrontend: "visual",
                },
                "surfaceMain:surface": {
                    activeBlueprintId: "surface",
                    privateBlueprintIds: ["surface"],
                    initializedFrontend: "visual",
                },
            },
        };

        expect(listEffectiveBlueprintVariables(globalBlueprint)).toEqual([
            expect.objectContaining({ id: "declaredGlobal", name: "globalDeclared", defaultValue: 1 }),
        ]);
        expect(listEffectiveBlueprintVariables(surfaceBlueprint)).toEqual([
            expect.objectContaining({ id: "declaredSurface", name: "surfaceDeclared", defaultValue: "ready" }),
        ]);
        expect(listEffectiveBlueprintVariables(valueBlueprint).map(variable => variable.id)).toEqual(["legacyValue"]);

        const surfaceOptions = buildAccessibleBlueprintVariableOptions({
            doc,
            currentBlueprintId: "surface",
            surfaceId: "surface",
        });
        expect(surfaceOptions.map(option => option.value)).toEqual([
            "declaredSurface",
            createExplicitBlueprintVariableRef("global", "declaredGlobal"),
        ]);

        const valueOptions = buildAccessibleBlueprintVariableOptions({
            doc,
            currentBlueprintId: "value",
            surfaceId: "surface",
        });
        expect(valueOptions.map(option => option.value)).toContain("legacyValue");
        expect(valueOptions.map(option => option.value)).not.toContain("declaredValue");
    });

    it("normalizes Any Var declaration defaults to null", () => {
        const blueprint: Blueprint = {
            id: "widget",
            name: "Widget",
            owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
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
                                    anyVar: {
                                        id: "anyVar",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: {
                                            variableId: "anyVar",
                                            name: "token",
                                            valueType: "any",
                                            defaultValue: { stale: true },
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
        };

        expect(listEffectiveBlueprintVariables(blueprint)).toEqual([
            expect.objectContaining({
                id: "anyVar",
                name: "token",
                valueType: "any",
                defaultValue: null,
            }),
        ]);
    });
});
