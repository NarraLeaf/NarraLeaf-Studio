import { isContainerFlowLayoutParent } from "./container";
import { getUIListChildSlot, isUIListScrollbarSlot } from "./list";
import type { UIPageAnimationSettings } from "./pageAnimation";
import { getUISliderChildSlot } from "./slider";

export const UI_DOCUMENT_SCHEMA_VERSION = 9 as const;

export type UIDocumentVersion = number;
export type UIDocumentId = string;
export type UISurfaceId = string;
export type UIElementId = string;

export type UIDocument = {
    schemaVersion: UIDocumentVersion;
    id: UIDocumentId;
    name: string;
    surfaces: UISurface[];
    components?: UIComponentDefinition[];
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
    pageAnimation?: UIPageAnimationSettings;
};

export type UISlotDefinition = {
    id: string; 
    name: string;
    rootElementId?: UIElementId;
};

export type UIComponentId = string;

export type UIComponentDefinition = {
    id: UIComponentId;
    name: string;
    rootElementId: UIElementId;
    elements: Record<UIElementId, UIElement>;
    previewMeta?: {
        width?: number;
        height?: number;
    };
    createdAt?: string;
    updatedAt?: string;
};

export type UIComponentLink = {
    componentId: UIComponentId;
    linked: true;
};

export type UIElementExtraComponentLink = {
    componentLink?: UIComponentLink;
};

/** Types that may own `childrenIds` (structural parents). Leaf widgets must stay childless. */
const UI_PARENT_CAPABLE_ELEMENT_TYPES = new Set<string>(["nl.root", "nl.container", "nl.list", "nl.button", "nl.slider"]);
/** Types that accept ordinary user-inserted children. Structural part parents can be narrower. */
const UI_USER_CHILD_PARENT_ELEMENT_TYPES = new Set<string>(["nl.root", "nl.container", "nl.list", "nl.button"]);

export function uiElementTypeAcceptsChildren(elementType: string): boolean {
    return UI_PARENT_CAPABLE_ELEMENT_TYPES.has(elementType);
}

export function uiElementTypeAcceptsUserChildren(elementType: string): boolean {
    return UI_USER_CHILD_PARENT_ELEMENT_TYPES.has(elementType);
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
    valueBindings?: Record<string, UIElementValueBinding>;
    extra?: Record<string, unknown>;
};

export function getUIComponentLink(element: Pick<UIElement, "extra"> | null | undefined): UIComponentLink | null {
    const raw = element?.extra?.componentLink;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const link = raw as Partial<UIComponentLink>;
    if (link.linked !== true || typeof link.componentId !== "string" || link.componentId.trim().length === 0) {
        return null;
    }
    return {
        componentId: link.componentId,
        linked: true,
    };
}

export function isLinkedUIComponentElement(element: Pick<UIElement, "extra"> | null | undefined): boolean {
    return getUIComponentLink(element) != null;
}

export type UIElementValueBindingValueType = "string" | "json" | "float";

export type UIElementValueBinding =
    | {
          kind: "blueprintValue";
          blueprintId: string;
          valueType: UIElementValueBindingValueType;
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
    if (parent?.type === "nl.slider" && getUISliderChildSlot(element.extra) != null) {
        return false;
    }
    return parent != null && isUIFlowLayoutParentElement(parent);
}
