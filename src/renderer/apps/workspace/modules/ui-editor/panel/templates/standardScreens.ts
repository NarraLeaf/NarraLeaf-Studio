import { anchorComponentId, anchorElementId, anchorSurfaceId } from "@shared/blueprint/ownerShape";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    getUIComponentLink,
    type UIDocument,
    type UIElement,
    type UIStageSlotId,
} from "@shared/types/ui-editor/document";
import { resolveEntrySurfaceId } from "@shared/types/ui-editor/entrySurface";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { collectUiClipboardAssetIds } from "@/lib/ui-editor/commands/uiEditorForeignPaste";
import { asUiElementSelection, UI_SURFACE_CLIPBOARD_KIND, UI_SURFACE_CLIPBOARD_VERSION } from "@/lib/ui-editor/commands/uiSurfaceClipboard";
import type { BlueprintAssetPinResolver } from "@/lib/workspace/services/references/referenceModel";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import {
    blueprintGraphs,
    collectBrandLinkIds,
    cutBlueprint,
    dropBlueprint,
    findTemplateTitlePage,
    pointStartAt,
    type StarterStartTarget,
} from "./starterTitlePage";

/**
 * The starter template's whole interface - every page, every Game UI, every component and every
 * blueprint behind them - made ready to be brought into a project that already exists.
 *
 * The title page alone has its own flow (`starterTitlePage`), which cuts the page loose from the
 * template's other screens. Bringing them all keeps every link between them - Load opens the load
 * page, a save slot opens the confirm dialog - so what this adds is the part that cannot come along:
 *
 *  - **A page whose logic needs what the project lacks is left out** - a node or a widget a plugin
 *    provides that this project does not run (the Gallery's Extra page). So is a page placing a
 *    component that is left out for the same reason.
 *  - **Logic elsewhere that opens a page left out is cut there**, by the rule the title page uses:
 *    a control whose every layer led there goes too, with its element. A Page widget showing one
 *    goes as well.
 *  - **Start begins the receiving project's own story.**
 *
 * Pure: the workspace reads the template, decides what the project can run, and imports the plan.
 * Nothing in `input` is changed.
 */

export type StandardScreensInput = {
    /** The template's interface document, migrated to this Studio's schema. */
    document: UIDocument;
    /** Its blueprints, migrated. */
    blueprints: BlueprintDocument;
    startTarget: StarterStartTarget | null;
    /** Whether the receiving project can run a node of this type (its plugins included). */
    knowsNode(nodeType: string): boolean;
    /** Whether the receiving project can draw a widget of this type (its plugins included). */
    knowsWidget(widgetType: string): boolean;
    resolveAssetPins?: BlueprintAssetPinResolver;
};

export type StandardScreensPlan = {
    /** What to import: the surfaces and components that come, with their elements. */
    document: UIDocument;
    /** Their blueprints, cut where they led to something left out. */
    blueprints: BlueprintDocument;
    /** Pages and Game UIs left out, each with the node and widget types it needs. */
    leftOut: { id: string; name: string; needs: string[] }[];
    /** Elements removed because all they did was open something left out. */
    cutControls: { surface: string; element: string }[];
    /** The library files the arriving interface names. */
    assetIds: string[];
    /** The palette entries it names by link. */
    brandColorIds: string[];
    /** The Game UI slots the arriving Game UIs fill. */
    stageSlots: UIStageSlotId[];
    /** The template's entry page, by its id in the template, when it comes along. */
    entrySurfaceId: string | null;
    /** The template's title page, by its id in the template, when it comes along. */
    titleSurfaceId: string | null;
};

type Blueprint = BlueprintDocument["blueprints"][string];

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The node types in these blueprints that the project cannot run, and the widget types it cannot draw. */
function unknownTypes(
    blueprints: readonly Blueprint[],
    elements: Iterable<UIElement>,
    input: Pick<StandardScreensInput, "knowsNode" | "knowsWidget">,
): string[] {
    const needs = new Set<string>();
    for (const blueprint of blueprints) {
        for (const graph of blueprintGraphs(blueprint)) {
            for (const node of Object.values(graph.nodes ?? {})) {
                if (!input.knowsNode(node.type)) {
                    needs.add(node.type);
                }
            }
        }
    }
    for (const element of elements) {
        if (!input.knowsWidget(element.type)) {
            needs.add(element.type);
        }
    }
    return [...needs].sort();
}

export function planStandardScreens(input: StandardScreensInput): StandardScreensPlan {
    registerCoreBlueprintNodes();
    const document = cloneJson(input.document);
    const blueprints = cloneJson(input.blueprints);
    const all = () => Object.values(blueprints.blueprints);

    // What cannot come: components first, since a page placing one cannot come either.
    const leftOutComponents = new Set<string>();
    for (const component of document.components ?? []) {
        const needs = unknownTypes(
            all().filter(blueprint => anchorComponentId(blueprint.owner) === component.id),
            Object.values(component.elements ?? {}),
            input,
        );
        if (needs.length > 0) {
            leftOutComponents.add(component.id);
        }
    }
    const leftOut = new Map<string, string[]>();
    for (const surface of document.surfaces) {
        const subtree = [...collectSubtreeElementIds(document, surface.rootElementId)]
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        const needs = unknownTypes(all().filter(blueprint => anchorSurfaceId(blueprint.owner) === surface.id), subtree, input);
        const placesLeftOut = subtree.some(element => {
            const componentId = getUIComponentLink(element)?.componentId;
            return componentId !== undefined && leftOutComponents.has(componentId);
        });
        if (needs.length > 0 || placesLeftOut) {
            leftOut.set(surface.id, needs);
        }
    }
    const leftOutRecords = document.surfaces
        .filter(surface => leftOut.has(surface.id))
        .map(surface => ({ id: surface.id, name: surface.name, needs: leftOut.get(surface.id) ?? [] }));

    // Take them out, with their trees and their blueprints.
    for (const surface of document.surfaces.filter(item => leftOut.has(item.id))) {
        for (const id of collectSubtreeElementIds(document, surface.rootElementId)) {
            delete document.elements[id];
        }
    }
    document.surfaces = document.surfaces.filter(surface => !leftOut.has(surface.id));
    document.components = (document.components ?? []).filter(component => !leftOutComponents.has(component.id));
    for (const blueprint of all()) {
        const surfaceId = anchorSurfaceId(blueprint.owner);
        const componentId = anchorComponentId(blueprint.owner);
        if ((surfaceId && leftOut.has(surfaceId)) || (componentId && leftOutComponents.has(componentId))) {
            dropBlueprint(blueprints, blueprint.id);
        }
    }

    // Cut what is left where it opens a page that did not come, or runs a node the project lacks.
    const rule = { pageStays: (pageId: string) => !leftOut.has(pageId), nodeStays: input.knowsNode };
    const emptiedElements = new Set<string>();
    for (const blueprint of all()) {
        if (cutBlueprint(blueprint, rule) !== "emptied") {
            continue;
        }
        const elementId = anchorElementId(blueprint.owner);
        if (elementId && anchorComponentId(blueprint.owner) === null) {
            emptiedElements.add(elementId);
        }
        dropBlueprint(blueprints, blueprint.id);
    }
    for (const element of Object.values(document.elements)) {
        if (element.type !== UI_FRAME_ELEMENT_TYPE) {
            continue;
        }
        const target = getUIFrameWidgetProps(element).targetSurfaceId;
        if (target && leftOut.has(target)) {
            emptiedElements.add(element.id);
        }
    }

    // A control whose only job was to go there goes with its logic, and so does what is inside it.
    const cutControls: StandardScreensPlan["cutControls"] = [];
    const removed = new Set<string>();
    for (const surface of document.surfaces) {
        for (const id of collectSubtreeElementIds(document, surface.rootElementId)) {
            if (!emptiedElements.has(id) || id === surface.rootElementId) {
                continue;
            }
            cutControls.push({ surface: surface.name, element: document.elements[id]?.name ?? id });
            for (const inner of collectSubtreeElementIds(document, id)) {
                removed.add(inner);
            }
        }
    }
    for (const id of removed) {
        delete document.elements[id];
    }
    for (const element of Object.values(document.elements)) {
        element.childrenIds = element.childrenIds.filter(childId => !removed.has(childId));
    }
    for (const blueprint of all()) {
        const elementId = anchorElementId(blueprint.owner);
        if (elementId && anchorComponentId(blueprint.owner) === null && removed.has(elementId)) {
            dropBlueprint(blueprints, blueprint.id);
        }
    }

    pointStartAt(blueprints, input.startTarget);

    const brandColorIds = new Set<string>();
    collectBrandLinkIds(document.surfaces, brandColorIds);
    collectBrandLinkIds(document.elements, brandColorIds);
    collectBrandLinkIds(document.components, brandColorIds);
    collectBrandLinkIds(blueprints.blueprints, brandColorIds);

    const selection = asUiElementSelection({
        v: UI_SURFACE_CLIPBOARD_VERSION,
        kind: UI_SURFACE_CLIPBOARD_KIND,
        document,
        graphs: { blueprintDocument: blueprints },
    });
    const componentElements = (document.components ?? []).flatMap(component => Object.values(component.elements ?? {}));
    const assetIds = collectUiClipboardAssetIds(
        { ...selection, elements: { ...selection.elements, ...Object.fromEntries(componentElements.map(element => [element.id, element])) } },
        input.resolveAssetPins,
    );

    const entry = resolveEntrySurfaceId(input.document);
    const title = findTemplateTitlePage(document, blueprints);
    return {
        document,
        blueprints,
        leftOut: leftOutRecords,
        cutControls,
        assetIds,
        brandColorIds: [...brandColorIds],
        stageSlots: document.surfaces
            .map(surface => (surface.kind === "stageSurface" ? surface.mount.slotId : null))
            .filter((slot): slot is UIStageSlotId => Boolean(slot)),
        entrySurfaceId: entry && document.surfaces.some(surface => surface.id === entry) ? entry : null,
        titleSurfaceId: title?.id ?? null,
    };
}
