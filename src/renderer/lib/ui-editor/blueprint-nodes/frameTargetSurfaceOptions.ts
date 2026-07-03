import type { BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";
import {
    getUIFrameTargetInvalidReason,
    UI_FRAME_ELEMENT_TYPE,
} from "@shared/types/ui-editor/frame";
import {
    readBlueprintElementRefParams,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import type { BlueprintInspectorParamSelectOption } from "./types";

export const BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE = "frameTargetSurfaces";

type FrameTargetContext = {
    sourceSurfaceId: UISurfaceId;
    frameElementId: UIElementId;
};

function readElementInputRef(input: {
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
    return {
        sourceSurfaceId: ref.surfaceId,
        frameElementId: ref.elementId,
    };
}

export function resolveBlueprintSetFramePageTargetContext(input: {
    document: UIDocument;
    owner: BlueprintOwnerRef;
    ir: BlueprintGraphIr;
    nodeId: string;
    nodeType: string;
}): FrameTargetContext | null {
    if (input.nodeType === BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE && input.owner.kind === "widgetMain") {
        const element = input.document.elements[input.owner.elementId];
        if (element?.type === UI_FRAME_ELEMENT_TYPE) {
            return {
                sourceSurfaceId: input.owner.surfaceId,
                frameElementId: input.owner.elementId,
            };
        }
    }
    if (input.nodeType === BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE) {
        const ref = readElementInputRef(input);
        const element = ref ? input.document.elements[ref.frameElementId] : undefined;
        if (ref && element?.type === UI_FRAME_ELEMENT_TYPE) {
            return ref;
        }
    }
    return null;
}

export function listBlueprintSetFramePageTargetOptions(input: {
    document: UIDocument;
    owner: BlueprintOwnerRef;
    ir: BlueprintGraphIr;
    nodeId: string;
    nodeType: string;
}): BlueprintInspectorParamSelectOption[] {
    const targetContext = resolveBlueprintSetFramePageTargetContext(input);
    return input.document.surfaces
        .filter(surface => surface.kind === "appSurface")
        .filter(surface => {
            if (!targetContext) {
                return true;
            }
            return getUIFrameTargetInvalidReason({
                document: input.document,
                sourceSurfaceId: targetContext.sourceSurfaceId,
                frameElementId: targetContext.frameElementId,
                targetSurfaceId: surface.id,
            }) === null;
        })
        .map(surface => ({ value: surface.id, label: surface.name || surface.id }));
}

