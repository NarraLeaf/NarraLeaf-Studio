import { anchorComponentId, anchorElementId, anchorSurfaceId } from "@shared/blueprint/ownerShape";
import { parseBrandLink } from "@shared/brand/brandLink";
import type { BrandColor } from "@shared/types/brand";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
} from "@shared/types/blueprint/graph";
import {
    getUIComponentLink,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UIElementId,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { isBuiltinWidgetLogicType } from "@shared/types/ui-editor/widgetLogic";
import { REFERENCE_KIND_BY_OPTIONS_SOURCE } from "@/lib/lint/rules/blueprint";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { collectUiClipboardAssetIds } from "@/lib/ui-editor/commands/uiEditorForeignPaste";
import {
    asUiElementSelection,
    buildUiSurfaceClipboardPayload,
    type UISurfaceClipboardPayload,
} from "@/lib/ui-editor/commands/uiSurfaceClipboard";
import type { BlueprintAssetPinResolver } from "@/lib/workspace/services/references/referenceModel";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

/**
 * The title page a project that has no interface yet is offered, taken out of the bundled starter
 * template at the moment it is asked for.
 *
 * Taken rather than kept: the starter template's title page is the one an author who picked it
 * opens on, and it is rewritten as the template is. A copy frozen into Studio's code would be a
 * second title page that drifts from the first, so this reads the template's own documents and
 * lifts the page out of them, the way a page copied from another project is lifted out of that
 * project's - `buildUiSurfaceClipboardPayload` makes the payload and `importTemplateBundle` puts it
 * in. What this module adds is the part a copy between two projects does not need:
 *
 *  - **The page leaves the template's other screens behind, and so does its logic.** Where a graph
 *    opens another of the template's pages, it is cut there, together with whatever only led to or
 *    followed from that step. A control left with no logic at all - a button whose only job was to
 *    open the settings page - is left behind with it. The same holds for a node a plugin provides:
 *    the receiving project may not have the plugin switched on.
 *  - **Library components the page places come with it**, definitions and their blueprints, cut the
 *    same way. A component whose logic is cut away entirely stays behind with its instances.
 *  - **Start begins the receiving project's own story**, and a widget's named translation key
 *    becomes the widget's own translatable text (see {@link keepWordsOnWidgets}).
 *
 * Pure: no service, no file. The workspace reads the template and imports the result.
 */

/** The bundled template the title page is taken from. */
export const STARTER_TITLE_PAGE_TEMPLATE_ID = "skeleton";

/** Where the page's Start Game begins: a story and the scene in it. */
export type StarterStartTarget = {
    storyId: string;
    sceneId: string;
};

export type LiftedTitlePage = {
    /**
     * The page, its elements, the components it places and every blueprint of both, in the shape
     * `importTemplateBundle` reads.
     */
    payload: UISurfaceClipboardPayload;
    /** The library files the page names, in the order they are met. */
    assetIds: string[];
    /** The palette entries the page names by link, including the seeded ones. */
    brandColorIds: string[];
};

type Blueprint = BlueprintDocument["blueprints"][string];

/** Every graph a blueprint holds. Script layers have no nodes and are not graphs here. */
function blueprintGraphs(blueprint: Blueprint): BlueprintGraphIr[] {
    const graphs: BlueprintGraphIr[] = [];
    for (const slots of [blueprint.graphs.events, blueprint.graphs.functions, blueprint.graphs.macros]) {
        for (const slot of Object.values(slots ?? {})) {
            if (slot?.graph) {
                graphs.push(slot.graph);
            }
        }
    }
    return graphs;
}

function blueprintsOfSurface(document: BlueprintDocument, surfaceId: string): Blueprint[] {
    return Object.values(document.blueprints).filter(blueprint => anchorSurfaceId(blueprint.owner) === surfaceId);
}

function graphNodes(graph: BlueprintGraphIr): BlueprintGraphNode[] {
    return Object.values(graph.nodes ?? {});
}

function isWired(graph: BlueprintGraphIr, nodeId: string, port: string): boolean {
    return (graph.edges ?? []).some(edge => edge.to.nodeId === nodeId && edge.to.port === port);
}

/**
 * The template's title page: the page whose own controls both start the story and load a save.
 *
 * Asked of what the page does rather than what it is called or which id it has, because those are
 * the template's to change and this is the one thing a title page is. A Start Game counts only when
 * it names its story itself - a recollection screen also starts the story, at whichever scene a row
 * hands it, and is not a title page.
 */
export function findTemplateTitlePage(document: UIDocument, blueprints: BlueprintDocument): UISurface | null {
    for (const surface of document.surfaces) {
        if (surface.kind !== "appSurface") {
            continue;
        }
        let starts = false;
        let loads = false;
        for (const blueprint of blueprintsOfSurface(blueprints, surface.id)) {
            for (const graph of blueprintGraphs(blueprint)) {
                for (const node of graphNodes(graph)) {
                    if (
                        node.type === BLUEPRINT_NODE_TYPE_GAME_START_STORY
                        && String(node.params?.storyId ?? "").trim()
                        && !isWired(graph, node.id, "storyId")
                    ) {
                        starts = true;
                    }
                    if (node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD) {
                        loads = true;
                    }
                }
            }
        }
        if (starts && loads) {
            return surface;
        }
    }
    return null;
}

/** Node params whose value is a page, by the same table `blueprint/reference-missing` reads. */
function pageParamKeys(node: BlueprintGraphNode): string[] {
    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params);
    return (entry.inspectorParams ?? [])
        .filter(param => param.dynamicOptionsSource && REFERENCE_KIND_BY_OPTIONS_SOURCE[param.dynamicOptionsSource] === "surface")
        .map(param => param.key);
}

/**
 * Whether a node takes the game somewhere that is not coming along: it opens a page other than
 * `pageId` (or any page, with no `pageId`), or it is a node a plugin provides.
 */
function leavesPage(node: BlueprintGraphNode, pageId: string | null): boolean {
    if (node.type === BLUEPRINT_NODE_TYPE_FLOW_COMMENT) {
        return false;
    }
    if (!blueprintNodeRegistry.isBuiltIn(node.type)) {
        return true;
    }
    return pageParamKeys(node).some(key => {
        const value = String(node.params?.[key] ?? "").trim();
        return value !== "" && value !== pageId;
    });
}

/** The input pins of a node that carry execution, as its catalogue entry declares them. */
function execInputPorts(node: BlueprintGraphNode): Set<string> {
    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params);
    return new Set(entry.pins.filter(pin => pin.kind === "input" && pin.semantic === "exec").map(pin => pin.id));
}

/**
 * Cut a graph where it leaves the page. Returns whether anything was cut.
 *
 * The nodes that leave go, and so does everything that exists only for them: a node every one of
 * whose wires leads into what was cut (the check that decided to go there, the words a dialog was
 * about to show), and a node only ever reached by way of it (what ran after the dialog answered).
 * Repeated until nothing more falls away, so a graph that did nothing but leave ends up empty.
 *
 * A note on a cut graph goes too: it was written about the graph as it was.
 */
function cutWhereLogicLeaves(graph: BlueprintGraphIr, pageId: string | null): boolean {
    const nodes = graph.nodes ?? {};
    const edges = graph.edges ?? [];
    const removed = new Set(Object.values(nodes).filter(node => leavesPage(node, pageId)).map(node => node.id));
    if (removed.size === 0) {
        return false;
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of Object.values(nodes)) {
            if (removed.has(node.id) || node.type === BLUEPRINT_NODE_TYPE_FLOW_COMMENT) {
                continue;
            }
            const outgoing = edges.filter(edge => edge.from.nodeId === node.id);
            const execPorts = execInputPorts(node);
            const execIncoming = edges.filter(edge => edge.to.nodeId === node.id && execPorts.has(edge.to.port));
            const leadsOnlyAway = outgoing.length > 0 && outgoing.every(edge => removed.has(edge.to.nodeId));
            const reachedOnlyFromAway = execIncoming.length > 0 && execIncoming.every(edge => removed.has(edge.from.nodeId));
            if (leadsOnlyAway || reachedOnlyFromAway) {
                removed.add(node.id);
                changed = true;
            }
        }
    }
    for (const node of Object.values(nodes)) {
        if (node.type === BLUEPRINT_NODE_TYPE_FLOW_COMMENT) {
            removed.add(node.id);
        }
    }
    graph.nodes = Object.fromEntries(Object.entries(nodes).filter(([id]) => !removed.has(id)));
    graph.edges = edges.filter(edge => !removed.has(edge.from.nodeId) && !removed.has(edge.to.nodeId));
    return true;
}

/**
 * Cut every layer of a blueprint where it leaves the page, dropping the layers that end up empty.
 *
 * `emptied` is a blueprint that had layers and has none left: everything it did led away.
 */
function cutBlueprint(blueprint: Blueprint, pageId: string | null): "untouched" | "trimmed" | "emptied" {
    let cut = false;
    const index = blueprint.graphs;
    const dropFrom = (ids: string[] | undefined, id: string) => ids?.filter(entry => entry !== id);
    for (const [id, layer] of Object.entries(index.events ?? {})) {
        if (layer?.graph && cutWhereLogicLeaves(layer.graph, pageId)) {
            cut = true;
            if (graphNodes(layer.graph).length === 0) {
                delete index.events[id];
                index.eventIds = dropFrom(index.eventIds, id);
            }
        }
    }
    for (const [id, fn] of Object.entries(index.functions ?? {})) {
        if (fn?.graph && cutWhereLogicLeaves(fn.graph, pageId)) {
            cut = true;
            if (graphNodes(fn.graph).length === 0) {
                delete index.functions[id];
                index.functionIds = dropFrom(index.functionIds, id);
            }
        }
    }
    for (const [id, macro] of Object.entries(index.macros ?? {})) {
        if (macro?.graph && cutWhereLogicLeaves(macro.graph, pageId) && graphNodes(macro.graph).length === 0) {
            cut = true;
            delete (index.macros as Record<string, unknown>)[id];
        }
    }
    if (!cut) {
        return "untouched";
    }
    const remaining = Object.keys(index.events ?? {}).length
        + Object.keys(index.functions ?? {}).length
        + Object.keys(index.macros ?? {}).length;
    return remaining === 0 ? "emptied" : "trimmed";
}

/** Drop a blueprint and the owner record that files it. */
function dropBlueprint(document: BlueprintDocument, blueprintId: string): void {
    delete document.blueprints[blueprintId];
    for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
        if (record.blueprintId === blueprintId) {
            delete document.ownerRecords[ownerKey];
        }
    }
}

/** Whether an element itself cannot come along: a plugin widget, or a Page widget showing another page. */
function cannotComeAlong(element: UIElement, pageId: string | null): boolean {
    if (!isBuiltinWidgetLogicType(element.type)) {
        return true;
    }
    if (element.type !== UI_FRAME_ELEMENT_TYPE) {
        return false;
    }
    const target = getUIFrameWidgetProps(element).targetSurfaceId;
    return Boolean(target) && target !== pageId;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The library components the page needs, cut the way the page is, with their blueprints filed in
 * `into`. Followed through definitions that place other components. Returns the definitions that
 * can come along; a definition that cannot is simply not in the list, and its instances are then
 * left behind by the caller.
 */
function liftComponents(
    template: UIDocument,
    templateBlueprints: BlueprintDocument,
    elements: Iterable<UIElement>,
    into: BlueprintDocument,
): UIComponentDefinition[] {
    const byId = new Map((template.components ?? []).map(component => [component.id, component]));
    const lifted = new Map<string, UIComponentDefinition>();
    const refused = new Set<string>();
    const pending = [...elements].map(element => getUIComponentLink(element)?.componentId).filter((id): id is string => Boolean(id));
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (lifted.has(id) || refused.has(id)) {
            continue;
        }
        const source = byId.get(id);
        if (!source || Object.values(source.elements ?? {}).some(element => cannotComeAlong(element, null))) {
            refused.add(id);
            continue;
        }
        const blueprints = Object.values(templateBlueprints.blueprints)
            .filter(blueprint => anchorComponentId(blueprint.owner) === id)
            .map(blueprint => cloneJson(blueprint));
        // A component's own logic may name no page at all: it does not know which page it is on.
        const outcomes = blueprints.map(blueprint => cutBlueprint(blueprint, null));
        if (outcomes.includes("emptied")) {
            refused.add(id);
            continue;
        }
        lifted.set(id, cloneJson(source));
        for (const blueprint of blueprints) {
            into.blueprints[blueprint.id] = blueprint;
            for (const [ownerKey, record] of Object.entries(templateBlueprints.ownerRecords)) {
                if (record.blueprintId === blueprint.id) {
                    into.ownerRecords[ownerKey] = { blueprintId: blueprint.id };
                }
            }
        }
        for (const element of Object.values(source.elements ?? {})) {
            const nested = getUIComponentLink(element)?.componentId;
            if (nested) {
                pending.push(nested);
            }
        }
    }
    // A definition that places one which could not come is no more complete than that one.
    let shrinking = true;
    while (shrinking) {
        shrinking = false;
        for (const [id, component] of lifted) {
            const places = Object.values(component.elements ?? {})
                .map(element => getUIComponentLink(element)?.componentId)
                .filter((nested): nested is string => Boolean(nested));
            if (places.some(nested => !lifted.has(nested))) {
                lifted.delete(id);
                for (const blueprintId of Object.keys(into.blueprints)) {
                    if (anchorComponentId(into.blueprints[blueprintId].owner) === id) {
                        dropBlueprint(into, blueprintId);
                    }
                }
                shrinking = true;
            }
        }
    }
    return [...lifted.values()];
}

/**
 * The page's elements to leave behind, each with everything under it.
 *
 * A control whose logic was cut away entirely, an element that cannot come along, and an instance
 * of a component that could not come along.
 */
function elementsToLeaveBehind(
    payload: UISurfaceClipboardPayload,
    page: UISurface,
    emptiedElements: ReadonlySet<UIElementId>,
    components: ReadonlySet<string>,
): Set<UIElementId> {
    const leave = new Set<UIElementId>();
    for (const element of Object.values(payload.document.elements)) {
        if (element.id === page.rootElementId) {
            continue;
        }
        const componentId = getUIComponentLink(element)?.componentId;
        if (
            emptiedElements.has(element.id)
            || cannotComeAlong(element, page.id)
            || (componentId !== undefined && !components.has(componentId))
        ) {
            leave.add(element.id);
        }
    }
    const subtrees = new Set<UIElementId>();
    for (const elementId of leave) {
        for (const id of collectSubtreeElementIds(payload.document, elementId)) {
            subtrees.add(id);
        }
    }
    return subtrees;
}

function removeElements(payload: UISurfaceClipboardPayload, removed: ReadonlySet<UIElementId>): void {
    const elements = payload.document.elements;
    for (const id of removed) {
        delete elements[id];
    }
    for (const element of Object.values(elements)) {
        element.childrenIds = element.childrenIds.filter(childId => !removed.has(childId));
    }
    const blueprintDocument = payload.graphs.blueprintDocument;
    for (const blueprint of Object.values(blueprintDocument.blueprints)) {
        const elementId = anchorElementId(blueprint.owner);
        if (elementId && anchorComponentId(blueprint.owner) === null && removed.has(elementId)) {
            dropBlueprint(blueprintDocument, blueprint.id);
        }
    }
}

/**
 * Point every Start Game that names its story itself at the receiving project's story.
 *
 * A Start Game whose story arrives on a wire keeps its wire: where it starts is the graph's answer,
 * not this one. With no target the fields are cleared rather than left naming a story the receiving
 * project does not have, which the node reports in its own words when it runs.
 */
function pointStartAt(blueprints: BlueprintDocument, target: StarterStartTarget | null): void {
    for (const blueprint of Object.values(blueprints.blueprints)) {
        for (const graph of blueprintGraphs(blueprint)) {
            for (const node of graphNodes(graph)) {
                if (node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY || isWired(graph, node.id, "storyId")) {
                    continue;
                }
                const params = { ...(node.params ?? {}) };
                if (target) {
                    params.storyId = target.storyId;
                    params.sceneId = target.sceneId;
                } else {
                    delete params.storyId;
                    delete params.sceneId;
                }
                node.params = params;
            }
        }
    }
}

/**
 * Turn a widget's named translation key into the widget's own translatable text.
 *
 * The template names its menu words by key because several of its screens say the same word, and a
 * key is how a project says one word once. One page brought into a project that has no such key
 * would name a key the project does not have: the inspector would offer a translation key missing
 * from its own list, and nothing short of creating the key could change the words. So the words stay
 * what the template says in the project's language - the template keeps them on the widget, equal to
 * its key's text - and they are translated the way a word an author typed is: by the widget's own
 * unit. Which widgets carry a key, and in which prop, is the shared text-site table's answer.
 *
 * Exported for the text-site consistency test.
 */
export function keepWordsOnWidgets(elements: Iterable<UIElement>): void {
    for (const element of elements) {
        const site = uiTextSiteOf(element.type);
        const props = element.props as Record<string, unknown> | undefined;
        if (!site || site.role !== "words" || !site.keyProp || !props || typeof props[site.keyProp] !== "string") {
            continue;
        }
        delete props[site.keyProp];
    }
}

/** Every palette entry a value names by link, wherever in the value it sits. */
function collectBrandLinkIds(value: unknown, into: Set<string>): void {
    if (typeof value === "string") {
        const link = parseBrandLink(value);
        if (link) {
            into.add(link.id);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectBrandLinkIds(item, into));
        return;
    }
    if (value && typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(item => collectBrandLinkIds(item, into));
    }
}

/**
 * The template's title page, ready to be imported into a project, or null when the template has none.
 *
 * `document` and `blueprints` are the template's, already migrated to this Studio's schema. They are
 * not changed: the page is copied out of them first.
 */
export function liftStarterTitlePage(input: {
    document: UIDocument;
    blueprints: BlueprintDocument;
    startTarget: StarterStartTarget | null;
    resolveAssetPins?: BlueprintAssetPinResolver;
}): LiftedTitlePage | null {
    registerCoreBlueprintNodes();
    const page = findTemplateTitlePage(input.document, input.blueprints);
    if (!page) {
        return null;
    }
    const payload = buildUiSurfaceClipboardPayload({
        document: input.document,
        surfaceId: page.id,
        blueprintDocument: input.blueprints,
    });
    if (!payload) {
        return null;
    }
    const blueprintDocument = payload.graphs.blueprintDocument;

    // The page's own logic first: a control whose every layer led away has nothing left to do.
    const emptiedElements = new Set<UIElementId>();
    for (const blueprint of Object.values(blueprintDocument.blueprints)) {
        if (cutBlueprint(blueprint, page.id) !== "emptied") {
            continue;
        }
        const elementId = anchorElementId(blueprint.owner);
        if (elementId) {
            emptiedElements.add(elementId);
        }
        dropBlueprint(blueprintDocument, blueprint.id);
    }

    const components = liftComponents(input.document, input.blueprints, Object.values(payload.document.elements), blueprintDocument);
    removeElements(payload, elementsToLeaveBehind(payload, page, emptiedElements, new Set(components.map(component => component.id))));
    // Only what a kept element still places: an instance left behind may have been the only one.
    const placed = new Set<string>();
    const visit = (elements: Iterable<UIElement>) => {
        for (const element of elements) {
            const id = getUIComponentLink(element)?.componentId;
            if (id && !placed.has(id)) {
                placed.add(id);
                const component = components.find(candidate => candidate.id === id);
                if (component) {
                    visit(Object.values(component.elements ?? {}));
                }
            }
        }
    };
    visit(Object.values(payload.document.elements));
    payload.document.components = components.filter(component => placed.has(component.id));
    for (const blueprint of Object.values(blueprintDocument.blueprints)) {
        const componentId = anchorComponentId(blueprint.owner);
        if (componentId && !placed.has(componentId)) {
            dropBlueprint(blueprintDocument, blueprint.id);
        }
    }

    const componentElements = payload.document.components.flatMap(component => Object.values(component.elements ?? {}));
    pointStartAt(blueprintDocument, input.startTarget);
    keepWordsOnWidgets([...Object.values(payload.document.elements), ...componentElements]);

    const brandColorIds = new Set<string>();
    collectBrandLinkIds(payload.document.surfaces, brandColorIds);
    collectBrandLinkIds(payload.document.elements, brandColorIds);
    collectBrandLinkIds(payload.document.components, brandColorIds);
    collectBrandLinkIds(blueprintDocument.blueprints, brandColorIds);

    const selection = asUiElementSelection(payload);
    return {
        payload,
        assetIds: collectUiClipboardAssetIds(
            { ...selection, elements: { ...selection.elements, ...Object.fromEntries(componentElements.map(element => [element.id, element])) } },
            input.resolveAssetPins,
        ),
        brandColorIds: [...brandColorIds],
    };
}

/**
 * The template's palette entries a page needs that the receiving project does not have, in the
 * template's order.
 *
 * An entry may itself be a link to another entry, and that one comes too: an entry the project took
 * whose value names nothing would paint the fallback colour, which is the failure taking it was for.
 * Entries the project already has are its own and are never replaced, whatever they hold.
 */
export function brandColorsToAdopt(
    neededIds: readonly string[],
    templateColors: readonly BrandColor[],
    projectHas: (id: string) => boolean,
): BrandColor[] {
    const byId = new Map(templateColors.map(color => [color.id, color]));
    const adopted = new Set<string>();
    const pending = [...neededIds];
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (adopted.has(id) || projectHas(id)) {
            continue;
        }
        const color = byId.get(id);
        if (!color) {
            continue;
        }
        adopted.add(id);
        const linked = parseBrandLink(color.value);
        if (linked) {
            pending.push(linked.id);
        }
    }
    return templateColors
        .filter(color => adopted.has(color.id))
        .map(color => ({ id: color.id, ...(color.name ? { name: color.name } : {}), value: color.value }));
}

/**
 * Whether a project has no interface yet: no page and no Game UI has anything on it.
 *
 * A page counts as having something once its root holds an element or any blueprint belonging to it
 * holds a node or a script. A new project made from the blank template has one page with neither,
 * and that is the state the title page is offered in.
 */
export function hasNoInterfaceYet(document: UIDocument, blueprints: BlueprintDocument | null): boolean {
    return document.surfaces.every(surface => isBlankSurface(document, blueprints, surface));
}

/** See {@link hasNoInterfaceYet}. */
export function isBlankSurface(
    document: UIDocument,
    blueprints: BlueprintDocument | null,
    surface: UISurface,
): boolean {
    const root = document.elements[surface.rootElementId];
    if (root && root.childrenIds.length > 0) {
        return false;
    }
    for (const blueprint of Object.values(blueprints?.blueprints ?? {})) {
        if (anchorSurfaceId(blueprint.owner) !== surface.id) {
            continue;
        }
        if (Object.values(blueprint.graphs.events ?? {}).some(layer => Boolean(layer?.script))) {
            return false;
        }
        if (blueprintGraphs(blueprint).some(graph => graphNodes(graph).length > 0)) {
            return false;
        }
    }
    return true;
}
