import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { listBlueprintEventIds } from "@shared/blueprint/blueprintEventOrder";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_GAME_QUIT,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_PAGE_BACK,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
    BLUEPRINT_NODE_TYPE_PAGE_QUIT,
    BLUEPRINT_NODE_TYPE_PAGE_REPLACE,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isLinkedUIComponentElement } from "@shared/types/ui-editor/document";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import { findBlueprintFnByRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";

/**
 * What the Page Overview draws for one page: the page, one group per control on it, and for each
 * group the places its logic can send the player.
 *
 * Read from the two documents and nothing else. The overview is a way of looking at blueprints the
 * author already has, not a new place to keep anything, so there is no state here to fall out of
 * step: change a `Go Page` target in the blueprint editor and the next call answers with the new
 * line. Pure, so the rules can be tested without a workspace.
 *
 * Only what a graph says on its face is read. A target that arrives on a wire is reported as
 * dynamic rather than chased, and a `Call Fn` is reported as itself rather than followed into the
 * function: both would need the graph to be run to answer honestly, and a line drawn to a guess is
 * worse than a line marked "decided at runtime".
 */

/** What the walk needs to know about one node: where a run continues, and whether a run starts here. */
export type PageOverviewNodeFacts = {
    /** The exec output pins a run leaves the node through. */
    execOutputs: readonly string[];
    /** An event head: where a run starts. */
    head: boolean;
};

/** Reads one node. Null for a node nothing is known about (a plugin's that is not loaded). */
export type PageOverviewNodeReader = (node: BlueprintGraphNode) => PageOverviewNodeFacts | null;

/** Where an exit leads. */
export type PageOverviewTarget =
    /** A page of this project. `missing` when the page it names has since been deleted. */
    | { kind: "page"; surfaceId: string; missing: boolean }
    /** `Go Page` with no page named: the page stack is emptied back to the page the game started on. */
    | { kind: "stackRoot" }
    | { kind: "story"; storyId: string; sceneId: string | null }
    /** Leaves for somewhere only known when it runs: the target pin is wired. */
    | { kind: "dynamic" }
    /** A node that needs a target and names none - the author has not picked one yet. */
    | { kind: "unset" }
    /** Back, close and quit: the node is the whole answer, there is nothing to point at. */
    | { kind: "none" }
    /** Hands the run to a function; where it goes from there is the function's business. */
    | { kind: "function"; fnRef: unknown; name: string | null };

/** What kind of step leaves the page, in the words of the node that takes it. */
export type PageOverviewExitVerb =
    | "goPage"
    | "replacePage"
    | "showLayer"
    | "showConfirm"
    | "startGame"
    | "quitGame"
    | "goBack"
    | "closeLayer"
    | "quitApp"
    | "callFunction";

export type PageOverviewExit = {
    verb: PageOverviewExitVerb;
    target: PageOverviewTarget;
    /** The event layer the node sits in, so the overview can open the blueprint on it. */
    layerId: string;
    nodeId: string;
    /** The event the run starts from - a click, a key, the page opening. */
    headType: string;
};

export type PageOverviewGroup = {
    elementId: string;
    /** As the layer outline names the control. */
    name: string;
    widgetType: string;
    /** Absent when nothing has been written into the control's own blueprint yet. */
    blueprintId?: string;
    exits: PageOverviewExit[];
    /** True when one of the blueprint's layers is a script, whose exits a graph walk cannot see. */
    hasScriptLayer: boolean;
    /** A component instance: its own controls live on the definition and are not listed here. */
    linkedComponent: boolean;
};

export type PageOverview = {
    surfaceId: string;
    name: string;
    /** In layer-outline order, top to bottom. */
    groups: PageOverviewGroup[];
    /** Exits the page's own blueprint takes - Escape for back, a splash moving on by itself. */
    pageExits: PageOverviewExit[];
    pageBlueprintId?: string;
    /** How many controls the page holds that {@link groups} left out because they are not interactive. */
    hiddenCount: number;
};

export type PageOverviewInput = {
    ui: UIDocument;
    blueprints: BlueprintDocument;
    surfaceId: string;
    read: PageOverviewNodeReader;
    /** List every element, not only the ones a player can act on. */
    showAll?: boolean;
};

/**
 * The controls a player acts on, and so the ones worth a group of their own even before any logic
 * is written into them. Everything else is listed only once it has a blueprint, or when the author
 * asks for every element: a page of forty text and image layers would otherwise bury its five
 * buttons.
 */
export const PAGE_OVERVIEW_INTERACTIVE_WIDGET_TYPES: ReadonlySet<string> = new Set([
    "nl.button",
    "nl.slider",
    "nl.switch",
    "nl.textInput",
    "nl.list",
]);

/** Depth first from the root, children in order: the order the layer outline lists them. */
function elementsInLayerOrder(rootId: string, elements: Record<string, UIElement>): UIElement[] {
    const ordered: UIElement[] = [];
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        const element = elements[id];
        if (!element || seen.has(id)) {
            continue;
        }
        seen.add(id);
        ordered.push(element);
        for (let index = element.childrenIds.length - 1; index >= 0; index -= 1) {
            stack.push(element.childrenIds[index]);
        }
    }
    return ordered;
}

function stringParam(node: BlueprintGraphNode, key: string): string {
    const value = node.params?.[key];
    return typeof value === "string" ? value.trim() : "";
}

function pinIsWired(ir: BlueprintGraphIr, nodeId: string, pinId: string): boolean {
    return (ir.edges ?? []).some(edge => edge.to.nodeId === nodeId && edge.to.port === pinId);
}

type ExitContext = {
    ir: BlueprintGraphIr;
    surfaceIds: ReadonlySet<string>;
    blueprints: BlueprintDocument;
};

/** A picked page, the wired pin winning over the picker as every page node resolves it at runtime. */
function pageTarget(context: ExitContext, node: BlueprintGraphNode, pinId: string | null, emptyMeans: PageOverviewTarget): PageOverviewTarget {
    if (pinId && pinIsWired(context.ir, node.id, pinId)) {
        return { kind: "dynamic" };
    }
    const surfaceId = stringParam(node, "surfaceId");
    if (!surfaceId) {
        return emptyMeans;
    }
    return { kind: "page", surfaceId, missing: !context.surfaceIds.has(surfaceId) };
}

/** The exit one node takes, or null for a node that does not leave the page. */
function exitOf(context: ExitContext, node: BlueprintGraphNode): { verb: PageOverviewExitVerb; target: PageOverviewTarget } | null {
    switch (node.type) {
        case BLUEPRINT_NODE_TYPE_PAGE_GO:
            return { verb: "goPage", target: pageTarget(context, node, "surfaceId", { kind: "stackRoot" }) };
        case BLUEPRINT_NODE_TYPE_PAGE_REPLACE:
            return { verb: "replacePage", target: pageTarget(context, node, "surfaceId", { kind: "unset" }) };
        case BLUEPRINT_NODE_TYPE_LAYER_SHOW:
            // Show Layer has no page pin: the page is only ever picked.
            return { verb: "showLayer", target: pageTarget(context, node, null, { kind: "unset" }) };
        case BLUEPRINT_NODE_TYPE_LAYER_CONFIRM:
            // The question is put up on one of the project's pages; there is no built-in dialog to
            // fall back on, so a confirm with no page picked is one the author has not finished.
            // The run carries on through whichever button closed it, so the walk does too.
            return { verb: "showConfirm", target: pageTarget(context, node, null, { kind: "unset" }) };
        case BLUEPRINT_NODE_TYPE_GAME_START_STORY: {
            if (pinIsWired(context.ir, node.id, "storyId") || pinIsWired(context.ir, node.id, "sceneId")) {
                return { verb: "startGame", target: { kind: "dynamic" } };
            }
            const storyId = stringParam(node, "storyId");
            if (!storyId) {
                return { verb: "startGame", target: { kind: "unset" } };
            }
            return { verb: "startGame", target: { kind: "story", storyId, sceneId: stringParam(node, "sceneId") || null } };
        }
        case BLUEPRINT_NODE_TYPE_GAME_QUIT:
            // Quit Game leaves the story for a page, so its line ends on that page.
            return { verb: "quitGame", target: pageTarget(context, node, "surfaceId", { kind: "unset" }) };
        case BLUEPRINT_NODE_TYPE_PAGE_BACK:
            return { verb: "goBack", target: { kind: "none" } };
        case BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF:
            return { verb: "closeLayer", target: { kind: "none" } };
        case BLUEPRINT_NODE_TYPE_PAGE_QUIT:
            return { verb: "quitApp", target: { kind: "none" } };
        case BLUEPRINT_NODE_TYPE_FN_CALL: {
            const fnRef = node.params?.[BLUEPRINT_NODE_PARAM_FN_REF];
            const name = findBlueprintFnByRef(context.blueprints, fnRef)?.name?.trim() || null;
            return { verb: "callFunction", target: { kind: "function", fnRef, name } };
        }
        default:
            return null;
    }
}

/**
 * Every exit a graph layer takes: from each event head along exec wires, breadth first, each node
 * once. Both arms of a branch are walked, so a control whose click goes one of two ways shows both.
 */
function exitsOfLayer(context: Omit<ExitContext, "ir">, layerId: string, ir: BlueprintGraphIr, read: PageOverviewNodeReader): PageOverviewExit[] {
    const nodes = ir.nodes ?? {};
    const facts = new Map<string, PageOverviewNodeFacts | null>();
    const factsOf = (nodeId: string): PageOverviewNodeFacts | null => {
        if (!facts.has(nodeId)) {
            const node = nodes[nodeId];
            facts.set(nodeId, node ? read(node) : null);
        }
        return facts.get(nodeId) ?? null;
    };
    const exitContext: ExitContext = { ...context, ir };
    const exits: PageOverviewExit[] = [];
    const reached = new Set<string>();
    for (const head of Object.values(nodes)) {
        if (!factsOf(head.id)?.head) {
            continue;
        }
        const queue = [head.id];
        const seen = new Set<string>([head.id]);
        while (queue.length > 0) {
            const nodeId = queue.shift() as string;
            const outputs = new Set(factsOf(nodeId)?.execOutputs ?? []);
            for (const edge of ir.edges ?? []) {
                if (edge.from.nodeId !== nodeId || !outputs.has(edge.from.port) || seen.has(edge.to.nodeId)) {
                    continue;
                }
                seen.add(edge.to.nodeId);
                queue.push(edge.to.nodeId);
                const node = nodes[edge.to.nodeId];
                // Two heads that reach the same node lead to one exit, credited to the first.
                if (!node || reached.has(node.id)) {
                    continue;
                }
                const exit = exitOf(exitContext, node);
                if (exit) {
                    reached.add(node.id);
                    exits.push({ ...exit, layerId, nodeId: node.id, headType: head.type });
                }
            }
        }
    }
    return exits;
}

/** Every exit a blueprint's event layers take, in the order the author arranged the layers. */
function exitsOfBlueprint(context: Omit<ExitContext, "ir">, blueprint: Blueprint, read: PageOverviewNodeReader): { exits: PageOverviewExit[]; hasScriptLayer: boolean } {
    const exits: PageOverviewExit[] = [];
    let hasScriptLayer = false;
    for (const layerId of listBlueprintEventIds(blueprint.graphs)) {
        const layer = blueprint.graphs.events[layerId];
        if (!layer) {
            continue;
        }
        if (layer.script) {
            hasScriptLayer = true;
            continue;
        }
        if (layer.graph) {
            exits.push(...exitsOfLayer(context, layerId, layer.graph, read));
        }
    }
    return { exits, hasScriptLayer };
}

function blueprintFor(document: BlueprintDocument, ownerKey: string): Blueprint | undefined {
    const blueprintId = document.ownerRecords[ownerKey]?.blueprintId;
    return blueprintId ? document.blueprints[blueprintId] : undefined;
}

/** A blueprint with no node in any layer is a slot nothing has been written into. */
function holdsSomething(blueprint: Blueprint | undefined): blueprint is Blueprint {
    if (!blueprint) {
        return false;
    }
    return Object.values(blueprint.graphs.events ?? {}).some(layer =>
        Boolean(layer.script) || Object.keys(layer.graph?.nodes ?? {}).length > 0);
}

/**
 * The overview of one page, or null when the id names no page.
 *
 * Pages only: a Game UI hangs its controls in slots on the stage, and a component's controls belong
 * to its definition, so neither has a single tree to lay out beside one preview.
 */
export function buildPageOverview({ ui, blueprints, surfaceId, read, showAll = false }: PageOverviewInput): PageOverview | null {
    const surface = ui.surfaces.find(candidate => candidate.id === surfaceId);
    if (!surface || surface.kind !== "appSurface") {
        return null;
    }
    const context = {
        surfaceIds: new Set(ui.surfaces.map(candidate => candidate.id)),
        blueprints,
    };

    const groups: PageOverviewGroup[] = [];
    let hiddenCount = 0;
    for (const element of elementsInLayerOrder(surface.rootElementId, ui.elements)) {
        if (element.id === surface.rootElementId) {
            continue;
        }
        const blueprint = blueprintFor(blueprints, encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId, elementId: element.id }));
        const written = holdsSomething(blueprint);
        if (!showAll && !written && !PAGE_OVERVIEW_INTERACTIVE_WIDGET_TYPES.has(element.type)) {
            hiddenCount += 1;
            continue;
        }
        const { exits, hasScriptLayer } = written
            ? exitsOfBlueprint(context, blueprint, read)
            : { exits: [], hasScriptLayer: false };
        groups.push({
            elementId: element.id,
            name: element.name ?? element.type,
            widgetType: element.type,
            ...(written ? { blueprintId: blueprint.id } : {}),
            exits,
            hasScriptLayer,
            linkedComponent: isLinkedUIComponentElement(element),
        });
    }

    const pageBlueprint = blueprintFor(blueprints, encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId }));
    const pageWritten = holdsSomething(pageBlueprint);
    return {
        surfaceId,
        name: surface.name,
        groups,
        pageExits: pageWritten ? exitsOfBlueprint(context, pageBlueprint, read).exits : [],
        ...(pageWritten ? { pageBlueprintId: pageBlueprint.id } : {}),
        hiddenCount,
    };
}

/** The slice of the node catalogue a reader needs. */
export type PageOverviewNodeCatalog = {
    resolveCatalogEntryForNode(type: string, params?: Record<string, unknown>): BlueprintNodeEditorCatalogEntry;
};

/** A reader that knows each node's pins the way the blueprint editor draws them. */
export function catalogPageOverviewNodeReader(catalog: PageOverviewNodeCatalog): PageOverviewNodeReader {
    return node => {
        let entry: BlueprintNodeEditorCatalogEntry;
        try {
            entry = catalog.resolveCatalogEntryForNode(node.type, node.params ?? {});
        } catch {
            return null;
        }
        return {
            execOutputs: entry.pins.filter(pin => pin.kind === "output" && pin.semantic === "exec").map(pin => pin.id),
            head: entry.role === "eventHead" || entry.role === "elementEventHead",
        };
    };
}
