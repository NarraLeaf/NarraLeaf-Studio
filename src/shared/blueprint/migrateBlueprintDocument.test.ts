import { describe, expect, it } from "vitest";
import { migrateBlueprintDocumentToLatest } from "./migrateBlueprintDocument";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
} from "../types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_PERSISTENT_GET } from "../types/blueprint/graph";

describe("migrateBlueprintDocumentToLatest", () => {
    it("upgrades schema 6 documents and no longer carries persistentVariables (M-VAR)", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 6,
            blueprints: {},
            ownerRecords: {},
        });

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect("persistentVariables" in migrated).toBe(false);
    });

    it("strips persistentVariables on the v8→v9 (M-VAR) migration and keeps matching node params", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 8,
            ownerRecords: {},
            persistentVariables: {
                gold: { id: "gold", name: "Gold", valueType: "number", storageKey: "gold" },
            },
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Main",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                onCall: {
                                    id: "onCall",
                                    graph: {
                                        nodes: {
                                            get: {
                                                id: "get",
                                                type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                                                params: { persistentVariableId: "gold" },
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
        });

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect("persistentVariables" in migrated).toBe(false);
        // id === storageKey, so the node param resolves to the registry entry unchanged.
        const graph = migrated.blueprints.bp?.program.kind === "graph"
            ? migrated.blueprints.bp.program.graphs.events.onCall?.graph
            : undefined;
        expect(graph?.nodes?.get.params?.persistentVariableId).toBe("gold");
    });

    it("remaps persistentVariableId when the old blueprint id differs from the storage key", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 8,
            ownerRecords: {},
            persistentVariables: {
                bp_old_id: { id: "bp_old_id", name: "Gold", valueType: "number", storageKey: "storage_gold" },
            },
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Main",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                onCall: {
                                    id: "onCall",
                                    graph: {
                                        nodes: {
                                            get: {
                                                id: "get",
                                                type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                                                params: { persistentVariableId: "bp_old_id" },
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
        });

        const graph = migrated.blueprints.bp?.program.kind === "graph"
            ? migrated.blueprints.bp.program.graphs.events.onCall?.graph
            : undefined;
        // The registry keys the entry by storageKey; the node param is remapped to match.
        expect(graph?.nodes?.get.params?.persistentVariableId).toBe("storage_gold");
    });

    it("converts legacy blueprint timing node params from milliseconds to seconds", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 7,
            ownerRecords: {},
            persistentVariables: {},
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "image" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                init: {
                                    id: "init",
                                    graph: {
                                        nodes: {
                                            delay: {
                                                id: "delay",
                                                type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                                                params: { duration: 1000 },
                                            },
                                            animate: {
                                                id: "animate",
                                                type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                                                params: {
                                                    property: "opacity",
                                                    durationMs: 300,
                                                    delayMs: 50,
                                                },
                                            },
                                            animateElement: {
                                                id: "animateElement",
                                                type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
                                                params: {
                                                    property: "opacity",
                                                    durationMs: 1500,
                                                    delayMs: 0,
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
        });

        const graph = migrated.blueprints.bp?.program.kind === "graph"
            ? migrated.blueprints.bp.program.graphs.events.init?.graph
            : undefined;
        const delay = graph?.nodes?.delay.params;
        const animate = graph?.nodes?.animate.params;
        const animateElement = graph?.nodes?.animateElement.params;

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect(delay).toMatchObject({ duration: 1 });
        expect(animate).toMatchObject({ property: "opacity", duration: 0.3, delay: 0.05 });
        expect(animate).not.toHaveProperty("durationMs");
        expect(animate).not.toHaveProperty("delayMs");
        expect(animateElement).toMatchObject({ property: "opacity", duration: 1.5, delay: 0 });
        expect(animateElement).not.toHaveProperty("durationMs");
        expect(animateElement).not.toHaveProperty("delayMs");
    });

    it("renames Set Sentence Speed input semantics from speed to cps", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            ownerRecords: {},
            persistentVariables: {},
            blueprints: {
                bp: {
                    id: "bp",
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
                    frontend: "visual",
                    programKind: "graph",
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                init: {
                                    id: "init",
                                    graph: {
                                        nodes: {
                                            literal: {
                                                id: "literal",
                                                type: "blueprint.literal.float",
                                                params: { value: 24 },
                                            },
                                            setSpeed: {
                                                id: "setSpeed",
                                                type: BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
                                                params: { speed: 24 },
                                                ports: {
                                                    speed: { kind: "input", type: "float", label: "Speed" },
                                                },
                                            },
                                        },
                                        edges: [
                                            {
                                                from: { nodeId: "literal", port: "value" },
                                                to: { nodeId: "setSpeed", port: "speed" },
                                            },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                            macros: {},
                        },
                    },
                },
            },
        });

        const graph = migrated.blueprints.bp?.program.kind === "graph"
            ? migrated.blueprints.bp.program.graphs.events.init?.graph
            : undefined;
        const setSpeed = graph?.nodes?.setSpeed;

        expect(setSpeed?.params).toMatchObject({ cps: 24 });
        expect(setSpeed?.params).not.toHaveProperty("speed");
        expect(setSpeed?.ports).toMatchObject({ cps: { kind: "input", type: "float", label: "CPS" } });
        expect(setSpeed?.ports).not.toHaveProperty("speed");
        expect(graph?.edges?.[0]?.to).toEqual({ nodeId: "setSpeed", port: "cps" });
    });
});
