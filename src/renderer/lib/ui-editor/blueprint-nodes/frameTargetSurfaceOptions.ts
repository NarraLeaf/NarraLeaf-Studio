import type { BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import {
    buildUIFrameGraph,
    findUIFrameHost,
    UI_FRAME_ELEMENT_TYPE,
    type UIFrameHost,
} from "@shared/types/ui-editor/frame";
import {
    readBlueprintElementRefParams,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import type { BlueprintInspectorParamSelectOption } from "./types";

export const BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE = "frameTargetSurfaces";

type FrameTargetContext = {
    host: UIFrameHost;
    frameElementId: UIElementId;
};

function isFrame(element: UIElement | undefined): boolean {
    return element?.type === UI_FRAME_ELEMENT_TYPE;
}

function readElementInputRef(input: {
    document: UIDocument;
    ir: BlueprintGraphIr;
    nodeId: string;
}): FrameTargetContext | null {
    const edge = input.ir.edges?.find(item =>
        item.to.nodeId === input.nodeId &&
        item.to.port === "element" &&
        item.from.port === "element"
    );
    const sourceNode = edge ? input.ir.nodes?.[edge.from.nodeId] : undefined;
    const ref = readBlueprintElementRefParams(sourceNode?.params);
    if (!ref || ref.elementType !== UI_FRAME_ELEMENT_TYPE) {
        return null;
    }
    // Found in the document rather than read off the reference's surface: a reference written inside
    // a component definition names the definition's own virtual surface, which is no page at all.
    const host = findUIFrameHost(input.document, ref.elementId);
    return host ? { host, frameElementId: ref.elementId } : null;
}

/**
 * The Page widget a Set Frame Page node changes, and where that widget sits - or null when the node
 * cannot say which widget it is.
 *
 * `document` is the project's document, pages and component definitions alike: a node on a
 * component's own graph changes a Page widget inside the definition.
 */
export function resolveBlueprintSetFramePageTargetContext(input: {
    document: UIDocument;
    owner: BlueprintOwnerRef;
    ir: BlueprintGraphIr;
    nodeId: string;
    nodeType: string;
}): FrameTargetContext | null {
    if (input.nodeType === BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE) {
        if (input.owner.kind === "widgetMain" && isFrame(input.document.elements[input.owner.elementId])) {
            return {
                host: { kind: "surface", surfaceId: input.owner.surfaceId },
                frameElementId: input.owner.elementId,
            };
        }
        if (input.owner.kind === "componentWidgetMain") {
            const { componentId, elementId } = input.owner;
            const component = (input.document.components ?? []).find(item => item.id === componentId);
            if (isFrame(component?.elements[elementId])) {
                return { host: { kind: "component", componentId }, frameElementId: elementId };
            }
        }
    }
    if (input.nodeType === BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE) {
        return readElementInputRef(input);
    }
    return null;
}

/**
 * The pages a Set Frame Page node may name: every page, less the ones that would draw the Page widget
 * inside itself - its own page, and any page that leads back to it, including through a component
 * it is placed in or that it sits inside.
 */
export function listBlueprintSetFramePageTargetOptions(input: {
    document: UIDocument;
    owner: BlueprintOwnerRef;
    ir: BlueprintGraphIr;
    nodeId: string;
    nodeType: string;
}): BlueprintInspectorParamSelectOption[] {
    const targetContext = resolveBlueprintSetFramePageTargetContext(input);
    const graph = targetContext ? buildUIFrameGraph(input.document) : null;
    return input.document.surfaces
        .filter(surface => surface.kind === "appSurface")
        .filter(surface => {
            if (!targetContext || !graph) {
                return true;
            }
            return graph.targetInvalidReason({
                host: targetContext.host,
                frameElementId: targetContext.frameElementId,
                targetSurfaceId: surface.id,
            }) === null;
        })
        .map(surface => ({ value: surface.id, label: surface.name || "Untitled surface" }));
}
