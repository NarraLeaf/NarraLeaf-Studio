
export const UI_DOCUMENT_SCHEMA_VERSION = 3 as const;

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

export type UIStageSlotId = "dialog" | "menu" | "notification" | "none";

export type UIStageSurfaceMount =
    | {
          kind: "slot";
          slotId: UIStageSlotId;
      }
    | {
          kind: "persistent";
      }
    | {
          kind: "layer";
      };

export type UIStageSurfaceLink = {
    kind: "appSurface";
    surfaceId: UISurfaceId;
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
    link?: UIStageSurfaceLink;
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
 * Parent element types whose direct children participate in **flow layout** in the editor
 * (flex inside the parent) instead of canvas absolute positioning.
 * Keep in sync with builtin widget modules: Stack, Scroll, List / Repeater.
 */
export const UI_FLOW_LAYOUT_PARENT_ELEMENT_TYPES = ["nl.stack", "nl.scroll", "nl.listRepeater"] as const;

export type UIFlowLayoutParentElementType = (typeof UI_FLOW_LAYOUT_PARENT_ELEMENT_TYPES)[number];

export function isUIFlowLayoutParentElementType(type: string): type is UIFlowLayoutParentElementType {
    return (UI_FLOW_LAYOUT_PARENT_ELEMENT_TYPES as readonly string[]).includes(type);
}

/** True when this element is a direct child of a flow-layout container (Stack / Scroll / ListRepeater). */
export function isUIElementFlowLayoutChild(document: UIDocument, element: UIElement): boolean {
    if (element.parentId == null) {
        return false;
    }
    const parent = document.elements[element.parentId];
    return parent != null && isUIFlowLayoutParentElementType(parent.type);
}

