export const UI_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type UIDocumentVersion = number;
export type UIDocumentId = string;
export type UISurfaceId = string;
export type UIElementId = string;
export type UIGraphId = string;

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

export type UISurfaceKind =
    | "appSurface"
    | "playerStageSurface"
    | "playerOverlaySurface";

export type UISurface = {
    id: UISurfaceId;
    name: string;
    host: UIHost;
    kind: UISurfaceKind;
    designSize: UISurfaceDesignSize;
    rootElementId: UIElementId;
    settings?: UISurfaceSettings;
    route?: UISurfaceRoute;
    slots?: Record<string, UISlotDefinition>;
};

export type UISurfaceDesignSize = {
    width: number;
    height: number;
};

export type UISurfaceSettings = {
    backgroundColor?: string;
};

export type UISurfaceRoute = {
    id?: string;
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
    | { kind: "graph"; graphId: UIGraphId; entry: string };

export type UIBehaviorAction =
    | { kind: "noop" };
