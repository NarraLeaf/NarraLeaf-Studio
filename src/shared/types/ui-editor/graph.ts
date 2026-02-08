export type UIGraphId = string;

export type UIGraphDocumentVersion = number;

export type UIGraphDocument = {
    schemaVersion: UIGraphDocumentVersion;
    graphs: Record<UIGraphId, UIGraph>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    };
};

export type UIGraph = {
    id: UIGraphId;
    name?: string;
    entries: Record<string, UIGraphEntry>;
    nodes: Record<string, UIGraphNode>;
    edges: UIGraphEdge[];
    variables?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type UIGraphEntry = {
    start: {
        nodeId: string;
        port: string;
    };
    inputs?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type UIGraphNode = {
    id: string;
    type: string;
    params?: Record<string, unknown>;
    ports?: Record<string, UIGraphPort>;
    meta?: Record<string, unknown>;
};

export type UIGraphPort = {
    kind: "input" | "output";
    type?: string;
    label?: string;
};

export type UIGraphEdge = {
    from: {
        nodeId: string;
        port: string;
    };
    to: {
        nodeId: string;
        port: string;
    };
};
