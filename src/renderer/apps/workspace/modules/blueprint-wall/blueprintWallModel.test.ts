import { describe, expect, it } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { Blueprint, BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { buildBlueprintWall, countBlueprintWallTiles, measureBlueprint } from "./blueprintWallModel";

const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(",")})` : key;

function blueprint(id: string, owner: BlueprintOwnerRef, nodes: number, name = id): Blueprint {
    const graphNodes = Object.fromEntries(
        Array.from({ length: nodes }, (_, index) => [`n${index}`, { id: `n${index}`, type: "blueprint.test" }]),
    );
    return {
        id,
        name,
        owner,
        graphs: {
            eventIds: nodes > 0 ? ["init"] : [],
            events: nodes > 0 ? { init: { id: "init", graph: { nodes: graphNodes, edges: [] } } } : {},
            functions: {},
        },
    };
}

function document(entries: Array<[BlueprintOwnerRef, Blueprint]>): BlueprintDocument {
    return {
        schemaVersion: 14,
        blueprints: Object.fromEntries(entries.map(([, bp]) => [bp.id, bp])),
        ownerRecords: Object.fromEntries(entries.map(([owner, bp]) => [encodeBlueprintOwnerKey(owner), { blueprintId: bp.id }])),
    } as BlueprintDocument;
}

const element = (id: string, parentId: string | null, childrenIds: string[] = [], name?: string) => ({
    id,
    type: parentId === null ? "nl.root" : "nl.button",
    name,
    parentId,
    childrenIds,
});

const ui = {
    surfaces: [
        { id: "title", name: "Title", kind: "appSurface", host: "app", rootElementId: "rootA" },
        { id: "dialog", name: "Dialog", kind: "stageSurface", host: "player", rootElementId: "rootB", mount: { kind: "slot", slotId: "dialog" } },
    ],
    components: [
        {
            id: "card",
            name: "Card",
            rootElementId: "cRoot",
            elements: { cRoot: element("cRoot", null, ["cBtn"]), cBtn: element("cBtn", "cRoot", [], "Card button") },
        },
        {
            id: "unused",
            name: "Unused",
            rootElementId: "uRoot",
            elements: { uRoot: element("uRoot", null) },
        },
    ],
    elements: {
        rootA: element("rootA", null, ["start", "quit"]),
        start: element("start", "rootA", [], "Start"),
        quit: element("quit", "rootA", [], "Quit"),
        rootB: element("rootB", null),
    },
} as unknown as UIDocument;

const story = {
    id: "main",
    name: "Main story",
    chapters: [{ id: "c1", name: "One", sceneIds: ["s1"] }],
    scenes: {
        s1: {
            id: "s1",
            name: "Opening",
            blocks: [{ action: "blueprint", blueprintId: "storyUsed" }],
        },
    },
} as unknown as StoryDocument;

describe("buildBlueprintWall", () => {
    const blueprints = document([
        [{ kind: "globalMain" }, blueprint("global", { kind: "globalMain" }, 0)],
        [{ kind: "surfaceMain", surfaceId: "title" }, blueprint("titleLogic", { kind: "surfaceMain", surfaceId: "title" }, 2)],
        [{ kind: "widgetMain", surfaceId: "title", elementId: "quit" }, blueprint("quitLogic", { kind: "widgetMain", surfaceId: "title", elementId: "quit" }, 1)],
        [{ kind: "widgetMain", surfaceId: "title", elementId: "start" }, blueprint("startLogic", { kind: "widgetMain", surfaceId: "title", elementId: "start" }, 3)],
        [{ kind: "widgetValue", surfaceId: "title", elementId: "start", propPath: "label" }, blueprint("startValue", { kind: "widgetValue", surfaceId: "title", elementId: "start", propPath: "label" }, 1)],
        // Holds nothing: not a tile.
        [{ kind: "widgetMain", surfaceId: "title", elementId: "rootA" }, blueprint("rootLogic", { kind: "widgetMain", surfaceId: "title", elementId: "rootA" }, 0)],
        // Its control is gone: not a tile.
        [{ kind: "widgetMain", surfaceId: "title", elementId: "deleted" }, blueprint("ghost", { kind: "widgetMain", surfaceId: "title", elementId: "deleted" }, 4)],
        [{ kind: "componentWidgetMain", componentId: "card", elementId: "cBtn" }, blueprint("cardLogic", { kind: "componentWidgetMain", componentId: "card", elementId: "cBtn" }, 1)],
        [{ kind: "storyAction", blueprintId: "storyUsed" }, blueprint("storyUsed", { kind: "storyAction", blueprintId: "storyUsed" }, 1, "Story Action")],
        // No row names it: not a tile.
        [{ kind: "storyAction", blueprintId: "storyOrphan" }, blueprint("storyOrphan", { kind: "storyAction", blueprintId: "storyOrphan" }, 1, "Story Action")],
    ]);

    const groups = buildBlueprintWall({
        blueprints,
        ui,
        stories: [{ id: "main", name: "Main story", document: story }],
        t: t as never,
    });

    it("groups by project, page, Game UI, component and story, in that order", () => {
        expect(groups.map(group => group.key)).toEqual([
            "project",
            "surface:title",
            "surface:dialog",
            "component:card",
            "story:main",
        ]);
    });

    it("always shows App logic, even with nothing in it", () => {
        expect(groups[0].tiles.map(tile => tile.blueprintId)).toEqual(["global"]);
    });

    it("lists a page's logic first, then its controls in outline order, values after their control", () => {
        expect(groups[1].tiles.map(tile => tile.blueprintId)).toEqual([
            "titleLogic",
            "startLogic",
            "startValue",
            "quitLogic",
        ]);
        expect(groups[1].tiles[1].title).toBe("Start");
    });

    it("keeps a page with no blueprints, and drops a component with none", () => {
        expect(groups[2].tiles).toEqual([]);
        expect(groups.some(group => group.key === "component:unused")).toBe(false);
    });

    it("opens a component's logic under its component editor, as the inspector does", () => {
        expect(groups[3].tiles[0].target).toMatchObject({
            ownerKind: "componentWidgetMain",
            componentId: "card",
            elementId: "cBtn",
            surfaceId: "component-editor:card",
        });
    });

    it("lists a story blueprint under the scene that names it, and skips one no row names", () => {
        expect(groups[4].tiles.map(tile => tile.blueprintId)).toEqual(["storyUsed"]);
        expect(groups[4].tiles[0].title).toBe("Opening");
    });

    it("counts only tiles", () => {
        expect(countBlueprintWallTiles(groups)).toBe(1 + 4 + 0 + 1 + 1);
    });
});

describe("measureBlueprint", () => {
    it("counts a script layer as content", () => {
        const scripted: Blueprint = {
            id: "s",
            name: "s",
            owner: { kind: "globalMain" },
            graphs: { eventIds: ["init"], events: { init: { id: "init", script: { scriptRef: "scripts/a.ts" } } }, functions: {} },
        } as unknown as Blueprint;
        expect(measureBlueprint(scripted)).toEqual({ nodeCount: 0, graphCount: 1, scriptCount: 1 });
    });
});
