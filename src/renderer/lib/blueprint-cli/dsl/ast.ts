/**
 * Parsed form of the blueprint text format (`.bp`).
 *
 * The parser answers "what did the author write", never "is it valid" - every name here is kept as
 * written, with the line it came from, so the compiler can report an unknown node type or a missing
 * pin against the author's own line rather than against a generated graph nobody wrote.
 *
 * Comments in English per project convention.
 */

export type BpValue =
    | { kind: "string"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "null" }
    | { kind: "json"; value: unknown };

export type BpEndpointAst = {
    /**
     * Written form, e.g. `sfx.click.next`. Not split here: node ids may contain dots and pin ids may
     * contain colons (a save-schema pin is `field:<id>`), so where the boundary falls is only
     * decidable once the graph's declared node ids are known.
     */
    raw: string;
    line: number;
};

export type BpParamAst = {
    key: string;
    value: BpValue;
    line: number;
};

export type BpNodeAst = {
    id: string;
    type: string;
    params: BpParamAst[];
    /** `pin <- source` lines written inside the node body. */
    inputs: { pin: string; source: BpEndpointAst; line: number }[];
    layout?: { x: number; y: number };
    line: number;
};

export type BpEdgeAst = {
    from: BpEndpointAst;
    to: BpEndpointAst;
    line: number;
};

export type BpGraphAst = {
    kind: "event" | "function";
    name: string;
    id?: string;
    nodes: BpNodeAst[];
    edges: BpEdgeAst[];
    /** Raw `graphMeta = {...}` escape hatch; merged over the generated meta. */
    meta?: unknown;
    line: number;
};

export type BpVariableAst = {
    name: string;
    id?: string;
    valueType?: string;
    defaultValue?: BpValue;
    line: number;
};

export type BpBlueprintAst = {
    name: string;
    id?: string;
    ownerKind: string;
    /** Owner fields as written (surfaceId / elementId / propPath / componentId / assetId / mode). */
    ownerFields: Record<string, string>;
    variables: BpVariableAst[];
    graphs: BpGraphAst[];
    /** Raw escape hatches for shapes the format has no syntax for. */
    meta?: unknown;
    bindings?: unknown;
    fields?: unknown;
    functions?: unknown;
    line: number;
};

export type BpDocumentAst = {
    blueprints: BpBlueprintAst[];
};

export type BpDiagnostic = {
    severity: "error" | "warning" | "info";
    /** Stable machine code, e.g. `dsl.unknown_node_type`. */
    code: string;
    message: string;
    line?: number;
    /** Suggestions the reader can act on without opening another file. */
    hint?: string;
};
