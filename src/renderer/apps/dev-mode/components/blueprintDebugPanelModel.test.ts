import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { listBlueprintsForDevTools } from "./blueprintDebugPanelModel";

function visualBlueprint(
    id: string,
    name: string,
    owner: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "surface-a", elementId: "element-a" },
): Blueprint {
    return {
        id,
        name,
        owner,
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

function authoredBlueprint(id: string, name: string, owner: BlueprintOwnerRef): Blueprint {
    const bp = visualBlueprint(id, name, owner);
    if (bp.program.kind === "graph") {
        bp.program.graphs.events.click = {
            id: "click",
            name: "Click",
            graph: { nodes: {}, edges: [] },
        };
    }
    return bp;
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

function element(id: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: "nl.container",
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 100 },
    };
}

function scopedUiDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "app",
                name: "App",
                host: "app",
                kind: "appSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "app-root",
            },
            {
                id: "mounted-stage",
                name: "Mounted Stage",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "mounted-stage-root",
                mount: { kind: "slot", slotId: "onStage" },
            },
            {
                id: "unmounted-stage",
                name: "Unmounted Stage",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "unmounted-stage-root",
                mount: { kind: "slot", slotId: "dialog" },
            },
            {
                id: "other",
                name: "Other",
                host: "app",
                kind: "appSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "other-root",
            },
        ],
        elements: {
            "app-root": element("app-root", null, ["app-button"]),
            "app-button": element("app-button", "app-root"),
            "mounted-stage-root": element("mounted-stage-root", null, ["mounted-stage-text"]),
            "mounted-stage-text": element("mounted-stage-text", "mounted-stage-root"),
            "unmounted-stage-root": element("unmounted-stage-root", null, ["unmounted-stage-text"]),
            "unmounted-stage-text": element("unmounted-stage-text", "unmounted-stage-root"),
            "other-root": element("other-root", null, ["other-button"]),
            "other-button": element("other-button", "other-root"),
        },
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

    it("scopes the blueprints tab to global and the current interface", () => {
        const document = scopedUiDocument();
        const blueprints = {
            global: authoredBlueprint("global", "Global", { kind: "globalMain" }),
            appSurface: authoredBlueprint("app-surface", "App Surface", {
                kind: "surfaceMain",
                surfaceId: "app",
            }),
            appWidget: authoredBlueprint("app-widget", "App Widget", {
                kind: "widgetMain",
                surfaceId: "app",
                elementId: "app-button",
            }),
            stageSurface: authoredBlueprint("stage-surface", "Mounted Stage Surface", {
                kind: "surfaceMain",
                surfaceId: "mounted-stage",
            }),
            stageWidget: authoredBlueprint("stage-widget", "Mounted Stage Widget", {
                kind: "widgetMain",
                surfaceId: "mounted-stage",
                elementId: "mounted-stage-text",
            }),
            unmountedStage: authoredBlueprint("unmounted-stage", "Unmounted Stage Surface", {
                kind: "surfaceMain",
                surfaceId: "unmounted-stage",
            }),
            unmountedStageWidget: authoredBlueprint("unmounted-stage-widget", "Unmounted Stage Widget", {
                kind: "widgetMain",
                surfaceId: "unmounted-stage",
                elementId: "unmounted-stage-text",
            }),
            otherSurface: authoredBlueprint("other-surface", "Other Surface", {
                kind: "surfaceMain",
                surfaceId: "other",
            }),
            otherWidget: authoredBlueprint("other-widget", "Other Widget", {
                kind: "widgetMain",
                surfaceId: "other",
                elementId: "other-button",
            }),
            shared: authoredBlueprint("shared", "Shared", { kind: "sharedAsset", assetId: "asset" }),
        };

        expect(listBlueprintsForDevTools(blueprints, { document, activeSurfaceId: "app" }).map(bp => bp.id)).toEqual([
            "app-surface",
            "app-widget",
            "global",
        ]);
    });

    it("scopes a Game UI to its own nodes", () => {
        const document = scopedUiDocument();
        const blueprints = {
            appSurface: authoredBlueprint("app-surface", "App Surface", {
                kind: "surfaceMain",
                surfaceId: "app",
            }),
            appWidget: authoredBlueprint("app-widget", "App Widget", {
                kind: "widgetMain",
                surfaceId: "app",
                elementId: "app-button",
            }),
            linkedAppWidgetInStage: authoredBlueprint("linked-app-widget-in-stage", "Linked App Widget In Stage", {
                kind: "widgetMain",
                surfaceId: "mounted-stage",
                elementId: "app-button",
            }),
            stageSurface: authoredBlueprint("stage-surface", "Mounted Stage Surface", {
                kind: "surfaceMain",
                surfaceId: "mounted-stage",
            }),
            stageWidget: authoredBlueprint("stage-widget", "Mounted Stage Widget", {
                kind: "widgetMain",
                surfaceId: "mounted-stage",
                elementId: "mounted-stage-text",
            }),
            otherSurface: authoredBlueprint("other-surface", "Other Surface", {
                kind: "surfaceMain",
                surfaceId: "other",
            }),
        };

        expect(
            listBlueprintsForDevTools(blueprints, { document, activeSurfaceId: "mounted-stage" }).map(bp => bp.id),
        ).toEqual(["stage-surface", "stage-widget"]);
    });
});
