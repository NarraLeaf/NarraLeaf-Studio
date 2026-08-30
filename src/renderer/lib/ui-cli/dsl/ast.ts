/**
 * What a `.ui` file says, before any of it has been checked against the widget catalogue.
 *
 * The parser produces this and nothing else, so a syntax error and a "no such widget type" error
 * come from two different places and read differently. The compiler turns it into the records a
 * `uidoc.json` holds.
 *
 * Comments in English per project convention.
 */

/** Where a value lands on an element record. */
export type UiAssignTarget = "props" | "layout" | "style" | "extra" | "element";

export type UiAssignment = {
    line: number;
    target: UiAssignTarget;
    /** Dotted path under the target, so `imageFill.assetId = x` writes one key of one object. */
    path: string[];
    value: unknown;
};

export type UiBindingLine = {
    line: number;
    /** The key the binding is stored under, which is also the prop it drives. */
    propPath: string;
    source:
        | { kind: "blueprintValue"; blueprintId: string; valueType?: string }
        | { kind: "listItemField"; fieldId: string };
};

export type UiComponentLinkLine = {
    line: number;
    componentId: string;
    params: Record<string, string>;
};

export type UiElementNode = {
    line: number;
    /** Author-facing name; absent when the header carried only a type. */
    name?: string;
    type: string;
    id?: string;
    assignments: UiAssignment[];
    bindings: UiBindingLine[];
    componentLink?: UiComponentLinkLine;
    children: UiElementNode[];
};

export type UiSurfaceStatement = {
    kind: "surface";
    line: number;
    name: string;
    id?: string;
    surfaceKind: "appSurface" | "stageSurface";
    /** Only for a stage surface: which player slot it mounts into. */
    slotId?: string;
    designSize?: { width: number; height: number };
    settings: UiAssignment[];
    answers: { line: number; actionId: string; consume?: boolean }[];
    slots: { line: number; id: string; name: string; rootElementId?: string }[];
    root: UiElementNode | null;
};

export type UiComponentStatement = {
    kind: "component";
    line: number;
    name: string;
    id?: string;
    params: { line: number; id: string; name: string; defaultValue: string }[];
    previewMeta?: { width: number; height: number };
    root: UiElementNode | null;
};

export type UiStructStatement = {
    kind: "struct";
    line: number;
    id: string;
    fields: { line: number; id: string; key: string; label?: string; type: string }[];
};

export type UiActionStatement = {
    kind: "action";
    line: number;
    id: string;
    name: string;
    bindings: ({ kind: "pointer"; gesture: string } | { kind: "key"; key: string })[];
};

export type UiDocumentStatement = {
    kind: "document";
    line: number;
    name: string;
    id?: string;
};

export type UiStatement =
    | UiDocumentStatement
    | UiSurfaceStatement
    | UiComponentStatement
    | UiStructStatement
    | UiActionStatement;

export type UiFile = {
    statements: UiStatement[];
};
