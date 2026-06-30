import { describe, expect, it } from "vitest";
import { migrateBlueprintDocumentToLatest } from "./migrateBlueprintDocument";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
} from "../types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";

describe("migrateBlueprintDocumentToLatest", () => {
    it("upgrades schema 6 documents with empty persistent variables", () => {
        const migrated = migrateBlueprintDocumentToLatest({
            schemaVersion: 6,
            blueprints: {},
            ownerRecords: {},
        });

        expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
        expect(migrated.persistentVariables).toEqual({});
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
});
