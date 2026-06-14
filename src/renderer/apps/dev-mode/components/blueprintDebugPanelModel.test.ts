import { describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import { listBlueprintsForDevTools } from "./blueprintDebugPanelModel";

function visualBlueprint(id: string, name: string): Blueprint {
    return {
        id,
        name,
        owner: { kind: "widgetMain", surfaceId: "surface-a", elementId: "element-a" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {},
                functions: {},
            },
        },
        members: {
            variables: {},
            fields: {},
            functions: {},
        },
        bindings: {},
    };
}

function scriptBlueprint(id: string, name: string): Blueprint {
    return {
        id,
        name,
        owner: { kind: "widgetMain", surfaceId: "surface-a", elementId: "element-a" },
        frontend: "typescript",
        programKind: "scriptModule",
        program: {
            kind: "scriptModule",
            source: {
                language: "typescript",
                code: "",
            },
        },
        members: {
            variables: {},
            fields: {},
            functions: {},
        },
        bindings: {},
    };
}

describe("listBlueprintsForDevTools", () => {
    it("hides empty auto-provisioned visual blueprints", () => {
        const empty = visualBlueprint("empty", "Empty");

        expect(listBlueprintsForDevTools({ empty })).toEqual([]);
    });

    it("shows visual blueprints once they have authored graph content", () => {
        const authored = visualBlueprint("authored", "Authored");
        if (authored.program.kind === "graph") {
            authored.program.graphs.events.click = {
                id: "click",
                name: "Click",
                graph: { nodes: {}, edges: [] },
            };
        }

        expect(listBlueprintsForDevTools({ authored }).map(bp => bp.id)).toEqual(["authored"]);
    });

    it("keeps TypeScript blueprints visible because creating the revision is the authored state", () => {
        const script = scriptBlueprint("script", "Script");

        expect(listBlueprintsForDevTools({ script }).map(bp => bp.id)).toEqual(["script"]);
    });

    it("sorts visible blueprints by name", () => {
        const zed = scriptBlueprint("z", "Zed");
        const alpha = scriptBlueprint("a", "Alpha");

        expect(listBlueprintsForDevTools({ zed, alpha }).map(bp => bp.id)).toEqual(["a", "z"]);
    });
});
