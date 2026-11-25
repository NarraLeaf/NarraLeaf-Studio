import { describe, expect, it } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { Blueprint, BlueprintDocument, BlueprintGraphEdge, BlueprintGraphNode, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_PAGE_BACK,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
    BLUEPRINT_NODE_TYPE_PAGE_REPLACE,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { buildPageOverview, type PageOverviewNodeReader } from "./pageOverviewModel";

const BRANCH = "test.branch";
const GET_TEXT = "test.getText";

/** Heads start runs and leave by `then`; a branch leaves by both arms; actions continue by `next`. */
const read: PageOverviewNodeReader = node => {
    if (node.type.startsWith("blueprint.event.head.")) {
        return { head: true, execOutputs: ["then"] };
    }
    if (node.type === BRANCH) {
        return { head: false, execOutputs: ["true", "false"] };
    }
    if (node.type === GET_TEXT) {
        return { head: false, execOutputs: [] };
    }
    if (node.type === "plugin.unloaded") {
        return null;
    }
    return { head: false, execOutputs: ["next", "dismissed"] };
};

const node = (id: string, type: string, params?: Record<string, unknown>): BlueprintGraphNode => ({ id, type, ...(params ? { params } : {}) });
const exec = (from: string, to: string, port = "then"): BlueprintGraphEdge => ({ from: { nodeId: from, port }, to: { nodeId: to, port: "in" } });
const data = (from: string, to: string, port: string): BlueprintGraphEdge => ({ from: { nodeId: from, port: "value" }, to: { nodeId: to, port } });

type Layer = { nodes: BlueprintGraphNode[]; edges: BlueprintGraphEdge[] } | { script: string };

function blueprint(id: string, owner: BlueprintOwnerRef, layers: Layer[]): Blueprint {
    const events = Object.fromEntries(layers.map((layer, index) => {
        const layerId = `${id}-L${index}`;
        return [layerId, "script" in layer
            ? { id: layerId, script: { scriptRef: layer.script } }
            : { id: layerId, graph: { nodes: Object.fromEntries(layer.nodes.map(n => [n.id, n])), edges: layer.edges } }];
    }));
    return { id, name: id, owner, graphs: { eventIds: Object.keys(events), events, functions: {} } };
}

function document(...entries: Blueprint[]): BlueprintDocument {
    return {
        schemaVersion: 14,
        blueprints: Object.fromEntries(entries.map(bp => [bp.id, bp])),
        ownerRecords: Object.fromEntries(entries.map(bp => [encodeBlueprintOwnerKey(bp.owner), { blueprintId: bp.id }])),
    } as BlueprintDocument;
}

const widget = (elementId: string): BlueprintOwnerRef => ({ kind: "widgetMain", surfaceId: "title", elementId });

const element = (id: string, type: string, parentId: string | null, childrenIds: string[] = [], name?: string, extra?: Record<string, unknown>) => ({
    id, type, name, parentId, childrenIds, layout: {}, ...(extra ? { extra } : {}),
});

const ui = {
    surfaces: [
        { id: "title", name: "Title", kind: "appSurface", host: "app", rootElementId: "root" },
        { id: "settings", name: "Settings", kind: "appSurface", host: "app", rootElementId: "settingsRoot" },
        { id: "dialog", name: "Dialog", kind: "stageSurface", host: "player", rootElementId: "dialogRoot", mount: { kind: "slot", slotId: "dialog" } },
    ],
    components: [],
    elements: {
        root: element("root", "nl.root", null, ["logo", "menu", "card"]),
        logo: element("logo", "nl.text", "root", [], "Logo"),
        menu: element("menu", "nl.container", "root", ["start", "load", "quit"], "Menu"),
        start: element("start", "nl.button", "menu", [], "Start"),
        load: element("load", "nl.button", "menu", [], "Load"),
        quit: element("quit", "nl.button", "menu", [], "Quit"),
        card: element("card", "nl.container", "root", [], "Card", { componentLink: { linked: true, componentId: "card" } }),
        settingsRoot: element("settingsRoot", "nl.root", null),
        dialogRoot: element("dialogRoot", "nl.root", null),
    },
} as unknown as UIDocument;

function overview(blueprints: BlueprintDocument, extra: { showAll?: boolean; surfaceId?: string } = {}) {
    return buildPageOverview({ ui, blueprints, surfaceId: extra.surfaceId ?? "title", read, showAll: extra.showAll });
}

function exitsOf(blueprints: BlueprintDocument, elementId: string) {
    return overview(blueprints)!.groups.find(group => group.elementId === elementId)!.exits.map(({ verb, target }) => ({ verb, target }));
}

describe("buildPageOverview: which controls get a group", () => {
    it("lists interactive controls in layer-outline order, leaving out the root and plain layers", () => {
        const result = overview(document())!;
        expect(result.groups.map(group => group.elementId)).toEqual(["start", "load", "quit"]);
        // Logo, Menu and Card are not interactive and hold no logic.
        expect(result.hiddenCount).toBe(3);
    });

    it("lists every element when asked", () => {
        const result = overview(document(), { showAll: true })!;
        expect(result.groups.map(group => group.elementId)).toEqual(["logo", "menu", "start", "load", "quit", "card"]);
        expect(result.hiddenCount).toBe(0);
    });

    it("lists a plain layer once something is written into its blueprint", () => {
        const bp = blueprint("logoLogic", widget("logo"), [{ nodes: [node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)], edges: [] }]);
        const groups = overview(document(bp))!.groups;
        expect(groups.map(group => group.elementId)).toEqual(["logo", "start", "load", "quit"]);
        expect(groups[0].blueprintId).toBe("logoLogic");
    });

    it("does not count an empty blueprint as written", () => {
        const bp = blueprint("logoLogic", widget("logo"), [{ nodes: [], edges: [] }]);
        expect(overview(document(bp))!.groups.map(group => group.elementId)).not.toContain("logo");
        const empty = blueprint("startLogic", widget("start"), [{ nodes: [], edges: [] }]);
        expect(overview(document(empty))!.groups[0].blueprintId).toBeUndefined();
    });

    it("marks a component instance", () => {
        const card = overview(document(), { showAll: true })!.groups.find(group => group.elementId === "card")!;
        expect(card.linkedComponent).toBe(true);
    });

    it("answers null for a Game UI or an id that names no page", () => {
        expect(overview(document(), { surfaceId: "dialog" })).toBeNull();
        expect(overview(document(), { surfaceId: "gone" })).toBeNull();
    });
});

describe("buildPageOverview: exits", () => {
    it("reads a picked page, and flags one that has been deleted", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("a", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" }),
            ],
            edges: [exec("h", "a")],
        }]);
        const bp2 = blueprint("loadLogic", widget("load"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("a", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "removed" }),
            ],
            edges: [exec("h", "a")],
        }]);
        const blueprints = document(bp, bp2);
        expect(exitsOf(blueprints, "start")).toEqual([{ verb: "goPage", target: { kind: "page", surfaceId: "settings", missing: false } }]);
        expect(exitsOf(blueprints, "load")).toEqual([{ verb: "goPage", target: { kind: "page", surfaceId: "removed", missing: true } }]);
    });

    it("tells Go Page with no page (back to the first page) from a node left unfinished", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("go", BLUEPRINT_NODE_TYPE_PAGE_GO),
                node("h2", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                node("replace", BLUEPRINT_NODE_TYPE_PAGE_REPLACE, { surfaceId: "  " }),
            ],
            edges: [exec("h", "go"), exec("h2", "replace")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([
            { verb: "goPage", target: { kind: "stackRoot" } },
            { verb: "replacePage", target: { kind: "unset" } },
        ]);
    });

    it("reports a target that arrives on a wire as dynamic, even with a page also picked", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("text", GET_TEXT),
                node("go", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" }),
            ],
            edges: [exec("h", "go"), data("text", "go", "surfaceId")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([{ verb: "goPage", target: { kind: "dynamic" } }]);
    });

    it("walks both arms of a branch", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("if", BRANCH),
                node("yes", BLUEPRINT_NODE_TYPE_GAME_START_STORY, { storyId: "main", sceneId: "opening" }),
                node("no", BLUEPRINT_NODE_TYPE_LAYER_SHOW, { surfaceId: "settings" }),
            ],
            edges: [exec("h", "if"), exec("if", "yes", "true"), exec("if", "no", "false")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([
            { verb: "startGame", target: { kind: "story", storyId: "main", sceneId: "opening" } },
            { verb: "showLayer", target: { kind: "page", surfaceId: "settings", missing: false } },
        ]);
    });

    it("reads Start Game, wired or picked or empty", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h1", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("picked", BLUEPRINT_NODE_TYPE_GAME_START_STORY, { storyId: "main" }),
                node("h2", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                node("scene", GET_TEXT),
                node("wired", BLUEPRINT_NODE_TYPE_GAME_START_STORY, { storyId: "main" }),
                node("h3", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                node("empty", BLUEPRINT_NODE_TYPE_GAME_START_STORY),
            ],
            edges: [exec("h1", "picked"), exec("h2", "wired"), data("scene", "wired", "sceneId"), exec("h3", "empty")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([
            { verb: "startGame", target: { kind: "story", storyId: "main", sceneId: null } },
            { verb: "startGame", target: { kind: "dynamic" } },
            { verb: "startGame", target: { kind: "unset" } },
        ]);
    });

    it("reads the steps that point nowhere, and Quit Game's landing page", () => {
        const bp = blueprint("quitLogic", widget("quit"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("if", BRANCH),
                node("back", BLUEPRINT_NODE_TYPE_PAGE_BACK),
                node("app", BLUEPRINT_NODE_TYPE_PAGE_QUIT),
                node("h2", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                node("game", BLUEPRINT_NODE_TYPE_GAME_QUIT, { surfaceId: "title" }),
            ],
            edges: [exec("h", "if"), exec("if", "back", "true"), exec("if", "app", "false"), exec("h2", "game")],
        }]);
        expect(exitsOf(document(bp), "quit")).toEqual([
            { verb: "goBack", target: { kind: "none" } },
            { verb: "quitApp", target: { kind: "none" } },
            { verb: "quitGame", target: { kind: "page", surfaceId: "title", missing: false } },
        ]);
    });

    it("leaves a confirm with no page as unfinished and keeps walking through its buttons", () => {
        const bp = blueprint("quitLogic", widget("quit"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("ask", BLUEPRINT_NODE_TYPE_LAYER_CONFIRM),
                node("app", BLUEPRINT_NODE_TYPE_PAGE_QUIT),
            ],
            edges: [exec("h", "ask"), exec("ask", "app", "dismissed")],
        }]);
        expect(exitsOf(document(bp), "quit")).toEqual([
            { verb: "showConfirm", target: { kind: "unset" } },
            { verb: "quitApp", target: { kind: "none" } },
        ]);
    });

    it("reports a function call as itself and walks on past it", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("call", BLUEPRINT_NODE_TYPE_FN_CALL, { fnRef: "not-a-ref" }),
                node("go", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" }),
            ],
            edges: [exec("h", "call"), exec("call", "go", "next")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([
            { verb: "callFunction", target: { kind: "function", fnRef: "not-a-ref", name: null } },
            { verb: "goPage", target: { kind: "page", surfaceId: "settings", missing: false } },
        ]);
    });

    it("ignores nodes no event reaches, nodes an unknown node would lead to, and data wires", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("mystery", "plugin.unloaded"),
                node("after", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" }),
                node("orphan", BLUEPRINT_NODE_TYPE_PAGE_QUIT),
            ],
            edges: [exec("h", "mystery"), exec("mystery", "after", "next")],
        }]);
        expect(exitsOf(document(bp), "start")).toEqual([]);
    });

    it("credits a node two events reach to the first, once", () => {
        const bp = blueprint("startLogic", widget("start"), [{
            nodes: [
                node("click", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK),
                node("key", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN),
                node("go", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" }),
            ],
            edges: [exec("click", "go"), exec("key", "go")],
        }]);
        const exits = overview(document(bp))!.groups[0].exits;
        expect(exits).toHaveLength(1);
        expect(exits[0]).toMatchObject({ nodeId: "go", layerId: "startLogic-L0" });
        expect([BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN]).toContain(exits[0].headType);
    });

    it("reads every graph layer in order and says when a script layer could not be read", () => {
        const bp = blueprint("startLogic", widget("start"), [
            { script: "scripts/start.ts" },
            {
                nodes: [node("h", BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK), node("go", BLUEPRINT_NODE_TYPE_PAGE_GO, { surfaceId: "settings" })],
                edges: [exec("h", "go")],
            },
        ]);
        const group = overview(document(bp))!.groups[0];
        expect(group.hasScriptLayer).toBe(true);
        expect(group.exits).toEqual([expect.objectContaining({ verb: "goPage", layerId: "startLogic-L1", nodeId: "go" })]);
    });

    it("reads the page's own blueprint into the page's exits", () => {
        const page = blueprint("titleLogic", { kind: "surfaceMain", surfaceId: "title" }, [{
            nodes: [node("esc", BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN), node("back", BLUEPRINT_NODE_TYPE_PAGE_BACK)],
            edges: [exec("esc", "back")],
        }]);
        const result = overview(document(page))!;
        expect(result.pageBlueprintId).toBe("titleLogic");
        expect(result.pageExits).toEqual([expect.objectContaining({ verb: "goBack", headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN })]);
        expect(overview(document())!.pageExits).toEqual([]);
    });
});
