import type { BlueprintDocument, BlueprintOwnerRef } from "../blueprint/document";

export type UIGraphId = string;

/** M2: local instance blueprints live in `blueprintDocument`; `graphs` holds visual IR fragments. */
export const UI_GRAPH_DOCUMENT_SCHEMA_VERSION = 2 as const;

export type UIGraphDocumentVersion = typeof UI_GRAPH_DOCUMENT_SCHEMA_VERSION;

export type UIGraphDocument = {
    schemaVersion: UIGraphDocumentVersion;
    /**
     * Legacy behavior-graph documents (UIGraph IR). Blueprint M2+ event graphs are stored only under
     * {@link BlueprintDocument} at `Blueprint.program.graphs.events[eventId].graph` — do not use this map as the
     * source of truth for blueprint events.
     */
    graphs: Record<UIGraphId, UIGraph>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
        [key: string]: unknown;
    };
    /** Required for M2 on-disk docs: canonical local instance BlueprintDocument (global/surface/widget mains). */
    blueprintDocument: BlueprintDocument;
};

export type UIGraph = {
    id: UIGraphId;
    name?: string;
    entries: Record<string, UIGraphEntry>;
    nodes: Record<string, UIGraphNode>;
    edges: UIGraphEdge[];
    variables?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    /**
     * M2+ optional link: id of a Blueprint in `blueprintDocument.blueprints` that owns this graph IR.
     */
    blueprintId?: string;
    /** M2+ optional owner context for instance main blueprints */
    ownerRef?: BlueprintOwnerRef;
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
