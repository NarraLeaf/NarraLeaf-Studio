import { isContainerFlowLayoutParent } from "./container";
import { getUIListChildSlot, isUIListScrollbarSlot } from "./list";

export const UI_DOCUMENT_SCHEMA_VERSION = 6 as const;

export type UIDocumentVersion = number;
export type UIDocumentId = string;
export type UISurfaceId = string;
export type UIElementId = string;

export type UIDocument = {
    schemaVersion: UIDocumentVersion;
    id: UIDocumentId;
    name: string;
    surfaces: UISurface[];
    elements: Record<UIElementId, UIElement>;
    meta?: UIDocumentMeta;
};

export type UIDocumentMeta = {
    createdAt?: string;
    updatedAt?: string;
};

export type UIHost = "app" | "player";

export type UISurfaceKind = "appSurface" | "stageSurface";

export type UIStageSlotId = "onStage" | "dialog" | "notification" | "choice";

export type UIStageSurfaceMount = {
    kind: "slot";
    slotId: UIStageSlotId;
};

export type UIAppSurface = {
    id: UISurfaceId;
    name: string;
    host: "app";
    kind: "appSurface";
    designSize: UISurfaceDesignSize;
    rootElementId: UIElementId;
    settings?: UISurfaceSettings;
};

export type UIStageSurface = {
    id: UISurfaceId;
    name: string;
    host: "player";
    kind: "stageSurface";
    designSize: UISurfaceDesignSize;
    rootElementId: UIElementId;
    settings?: UISurfaceSettings;
    mount: UIStageSurfaceMount;
    slots?: Record<string, UISlotDefinition>;
};

export type UISurface = UIAppSurface | UIStageSurface;

export type UISurfaceDesignSize = {
    width: number;
    height: number;
};

export type UISurfaceSettings = {
    backgroundColor?: string;
};

export type UISlotDefinition = {
    id: string; 
    name: string;
    rootElementId?: UIElementId;
};

/** Types that may own `childrenIds` (structural parents). Leaf widgets must stay childless. */
const UI_PARENT_CAPABLE_ELEMENT_TYPES = new Set<string>(["nl.root", "nl.container", "nl.list", "nl.button"]);

export function uiElementTypeAcceptsChildren(elementType: string): boolean {
    return UI_PARENT_CAPABLE_ELEMENT_TYPES.has(elementType);
}

export type UIElement = {
    id: UIElementId;
    type: string;
    name?: string;
    parentId: UIElementId | null;
    childrenIds: UIElementId[];
    layout: UILayout;
    style?: UIStyle;
    props?: Record<string, unknown>;
    behavior?: UIBehavior;
    extra?: Record<string, unknown>;
};

export type UILayout = {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    opacity?: number;
    visible?: boolean;
    /** When true, width and height stay proportional in the inspector and on-canvas resize. */
    lockAspectRatio?: boolean;
};

export type UIStyle = Record<string, unknown>;

export type UIBehavior = {
    events?: Record<string, UIBehaviorBinding>;
};

export type UIBehaviorBinding =
    | { kind: "noop" }
    | { kind: "actions"; actions: UIBehaviorAction[] }
    /** M2: event handler targets an event graph entry on an instance main blueprint. */
    | { kind: "blueprintEvent"; blueprintId: string; eventId: string };

export type UIBehaviorAction =
    | { kind: "noop" };

/**
 * True when this element acts as a flow-layout parent: direct children use flex inside the parent
 * instead of canvas absolute positioning (`nl.list`, or `nl.container` with stack/scroll layout).
 *
 * This is the **child layout** axis (`getContainerChildLayoutParticipation` for containers), not
 * `clipContent`: clipping can still hide overflow without changing flex vs absolute rules.
 */
export function isUIFlowLayoutParentElement(element: UIElement): boolean {
    if (element.type === "nl.list") {
        return true;
    }
    return isContainerFlowLayoutParent(element);
}

/** True when this element is a direct child of a flow-layout parent (Container stack/scroll or List). */
export function isUIElementFlowLayoutChild(document: UIDocument, element: UIElement): boolean {
    if (element.parentId == null) {
        return false;
    }
    const parent = document.elements[element.parentId];
    if (parent?.type === "nl.list" && isUIListScrollbarSlot(getUIListChildSlot(element.extra))) {
        return false;
    }
    return parent != null && isUIFlowLayoutParentElement(parent);
}

