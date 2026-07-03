export type UITool =
    | { kind: "select" }
    | { kind: "pan" }
    | { kind: "insert"; nodeType: string; componentId?: string };
