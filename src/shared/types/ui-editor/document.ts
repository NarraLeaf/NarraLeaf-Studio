import { isContainerFlowLayoutParent } from "./container";
import { getUIListChildSlot, isListLikeWidgetType, isUIListScrollbarSlot, UI_LIST_LIKE_WIDGET_TYPES } from "./list";
import type { UIPageAnimationSettings } from "./pageAnimation";
import { getUISliderChildSlot } from "./slider";
import type { UISurfaceBackgroundImage } from "./surfaceBackgroundImage";
import { getUISwitchChildSlot } from "./switch";

export const UI_DOCUMENT_SCHEMA_VERSION = 11 as const;

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

export type UIStageSlotId = "onStage" | "dialog" | "notification" | "choice" | "nvl";

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
    /**
     * Painted over {@link backgroundColor}, inside the design area only - the letterbox bars around
     * a scaled Surface keep showing the colour, so the two settings are not alternatives.
     */
    backgroundImage?: UISurfaceBackgroundImage;
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
const UI_PARENT_CAPABLE_ELEMENT_TYPES = new Set<string>(["nl.root", "nl.container", "nl.button", "nl.slider", "nl.switch", ...UI_LIST_LIKE_WIDGET_TYPES]);
/** Types that accept ordinary user-inserted children. Structural part parents can be narrower. */
const UI_USER_CHILD_PARENT_ELEMENT_TYPES = new Set<string>(["nl.root", "nl.container", "nl.button", ...UI_LIST_LIKE_WIDGET_TYPES]);

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

export type UIElementValueBindingValueType = "string" | "json" | "float" | "boolean";

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
    if (isListLikeWidgetType(element.type)) {
        return true;
    }
    return isContainerFlowLayoutParent(element);
}

/**
 * Widgets that build and place their own children, and how to read the slot marker off one.
 *
 * A table rather than a chain of `parent.type === "nl.x" && getUIXChildSlot(...)` tests, because
 * every such chain that misses a row fails silently. The switch had to be added to four of them by
 * hand and a fifth - the tree-move planner - was missed, which is how a thumb could be dragged out
 * of its own switch. A new part-owning widget is one row here.
 */
// The type argument goes on `new Map`, not on the const: inference from the entries alone widens to
// the FIRST reader's return type and then rejects the second.
const UI_STRUCTURAL_SLOT_READERS = new Map<string, (extra: Record<string, unknown> | undefined) => string | null>([
    ["nl.slider", getUISliderChildSlot],
    ["nl.switch", getUISwitchChildSlot],
]);

/** The structural slot `extra` claims inside `parentType`, or null when that pairing has no slots. */
export function getUIStructuralChildSlot(
    parentType: string | undefined,
    extra: Record<string, unknown> | undefined,
): string | null {
    const read = parentType != null ? UI_STRUCTURAL_SLOT_READERS.get(parentType) : undefined;
    return read ? read(extra) : null;
}

/**
 * True when `element` is a part its parent widget built, rather than something an author put there.
 *
 * Both halves matter. The parent has to be a widget that takes no user children, because that is
 * what makes moving the part out irreversible: `planMoveElementsInSurface` refuses to move anything
 * back *in*, so a part dragged onto the canvas can never be dragged home. And the child has to carry
 * that widget's slot marker, so a stray element that somehow ended up under one is still rescuable
 * instead of sealed in forever.
 *
 * A list is deliberately not covered: it does accept user children, so lifting an item template out
 * is reversible by the same gesture that did it.
 */
export function isUIStructuralWidgetPart(document: UIDocument, element: UIElement): boolean {
    if (element.parentId == null) {
        return false;
    }
    const parent = document.elements[element.parentId];
    if (!parent || uiElementTypeAcceptsUserChildren(parent.type)) {
        return false;
    }
    return getUIStructuralChildSlot(parent.type, element.extra) != null;
}

/** True when this element is a direct child of a flow-layout parent (Container stack/scroll or List). */
export function isUIElementFlowLayoutChild(document: UIDocument, element: UIElement): boolean {
    if (element.parentId == null) {
        return false;
    }
    const parent = document.elements[element.parentId];
    if (isListLikeWidgetType(parent?.type) && isUIListScrollbarSlot(getUIListChildSlot(element.extra))) {
        return false;
    }
    if (getUIStructuralChildSlot(parent?.type, element.extra) != null) {
        return false;
    }
    return parent != null && isUIFlowLayoutParentElement(parent);
}
