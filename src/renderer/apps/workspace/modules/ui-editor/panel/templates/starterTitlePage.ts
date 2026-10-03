import { anchorElementId, anchorSurfaceId } from "@shared/blueprint/ownerShape";
import { parseBrandLink } from "@shared/brand/brandLink";
import type { BrandColor } from "@shared/types/brand";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
} from "@shared/types/blueprint/graph";
import { getUIComponentLink, type UIDocument, type UIElementId, type UISurface } from "@shared/types/ui-editor/document";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { isBuiltinWidgetLogicType } from "@shared/types/ui-editor/widgetLogic";
import { REFERENCE_KIND_BY_OPTIONS_SOURCE } from "@/lib/lint/rules/blueprint";
import { LOCALIZABLE_TEXT_SITES } from "@/lib/lint/rules/ui";
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
 * in. What this module adds is the part a copy between two projects does not need: the page leaves
 * the template's other screens behind, so whatever on it led to one of them is left behind too, and
 * its Start button is pointed at the receiving project's own story.
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
    /** The page, its elements and its blueprints, in the shape `importTemplateBundle` reads. */
    payload: UISurfaceClipboardPayload;
    /** The library files the page names, in the order they are met. */
    assetIds: string[];
    /** The palette entries the page names by link, including the seeded ones. */
    brandColorIds: string[];
};

/** Every graph a blueprint holds. Script layers have no nodes and are not graphs here. */
function blueprintGraphs(blueprint: BlueprintDocument["blueprints"][string]): BlueprintGraphIr[] {
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

function blueprintsOfSurface(document: BlueprintDocument, surfaceId: string) {
    return Object.values(document.blueprints).filter(blueprint => anchorSurfaceId(blueprint.owner) === surfaceId);
}

function graphNodes(graph: BlueprintGraphIr) {
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
function pageParamKeys(nodeType: string, params: Record<string, unknown> | undefined): string[] {
    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(nodeType, params);
    return (entry.inspectorParams ?? [])
        .filter(param => param.dynamicOptionsSource && REFERENCE_KIND_BY_OPTIONS_SOURCE[param.dynamicOptionsSource] === "surface")
        .map(param => param.key);
}

/**
 * Whether a control's logic reaches past this page: it opens another of the template's pages, or it
 * is built on a node a plugin provides.
 *
 * Another page is not coming along, so a button that leads to one would lead nowhere - the template
 * removes such buttons from its own screens for that reason, and so does this. A plugin node is not
 * carried either: the receiving project may not have the plugin switched on, and a title page that
 * asks for one would greet a new project with a dependency warning.
 */
function leadsOutOfPage(graphs: readonly BlueprintGraphIr[], pageId: string): boolean {
    for (const graph of graphs) {
        for (const node of graphNodes(graph)) {
            if (!blueprintNodeRegistry.isBuiltIn(node.type)) {
                return true;
            }
            for (const key of pageParamKeys(node.type, node.params)) {
                const value = String(node.params?.[key] ?? "").trim();
                if (value && value !== pageId) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * The elements to leave behind, each with everything under it: controls that lead out of the page,
 * Page widgets showing another page, library component instances and plugin widgets.
 *
 * A component instance stays behind because its definition is a second element tree with its own
 * blueprints, which the page alone does not carry - the same trade a page copied between projects
 * makes. A plugin widget for the reason a plugin node does.
 */
function elementsToLeaveBehind(payload: UISurfaceClipboardPayload, page: UISurface): Set<UIElementId> {
    const leave = new Set<UIElementId>();
    const graphsByElement = new Map<UIElementId, BlueprintGraphIr[]>();
    for (const blueprint of Object.values(payload.graphs.blueprintDocument.blueprints)) {
        const elementId = anchorElementId(blueprint.owner);
        if (elementId) {
            graphsByElement.set(elementId, [...(graphsByElement.get(elementId) ?? []), ...blueprintGraphs(blueprint)]);
        }
    }
    for (const element of Object.values(payload.document.elements)) {
        if (element.id === page.rootElementId) {
            continue;
        }
        const framesElsewhere = element.type === UI_FRAME_ELEMENT_TYPE
            && Boolean(getUIFrameWidgetProps(element).targetSurfaceId)
            && getUIFrameWidgetProps(element).targetSurfaceId !== page.id;
        if (
            framesElsewhere
            || getUIComponentLink(element) !== null
            || !isBuiltinWidgetLogicType(element.type)
            || leadsOutOfPage(graphsByElement.get(element.id) ?? [], page.id)
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
    for (const [ownerKey, record] of Object.entries(blueprintDocument.ownerRecords)) {
        const blueprint = blueprintDocument.blueprints[record.blueprintId];
        const elementId = blueprint ? anchorElementId(blueprint.owner) : null;
        if (blueprint && elementId && removed.has(elementId)) {
            delete blueprintDocument.ownerRecords[ownerKey];
            delete blueprintDocument.blueprints[blueprint.id];
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
 * would show a word the inspector cannot change: a keyed widget draws its own text on the canvas
 * and the key's in the game. So the words stay what the template says in the project's language,
 * and they are translated the way a word an author typed is - by the widget's own unit.
 */
function keepWordsOnWidgets(payload: UISurfaceClipboardPayload): void {
    for (const element of Object.values(payload.document.elements)) {
        const site = LOCALIZABLE_TEXT_SITES[element.type];
        const props = element.props as Record<string, unknown> | undefined;
        if (!site || !props || typeof props[site.keyProp] !== "string") {
            continue;
        }
        delete props[site.keyProp];
        if (site.optInProp) {
            props[site.optInProp] = true;
        }
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
    removeElements(payload, elementsToLeaveBehind(payload, page));
    pointStartAt(payload.graphs.blueprintDocument, input.startTarget);
    keepWordsOnWidgets(payload);

    const brandColorIds = new Set<string>();
    collectBrandLinkIds(payload.document.surfaces, brandColorIds);
    collectBrandLinkIds(payload.document.elements, brandColorIds);
    collectBrandLinkIds(payload.graphs.blueprintDocument.blueprints, brandColorIds);

    return {
        payload,
        assetIds: collectUiClipboardAssetIds(asUiElementSelection(payload), input.resolveAssetPins),
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
