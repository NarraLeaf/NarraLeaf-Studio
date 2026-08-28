import type { AssetVariantMap } from "../assetSet";
import type { BlueprintDocument, BlueprintOwnerRef } from "../blueprint/document";

export type UIGraphId = string;

/** Local instance blueprints live in `blueprintDocument`. */
export const UI_GRAPH_DOCUMENT_SCHEMA_VERSION = 2 as const;

export type UIGraphDocumentVersion = typeof UI_GRAPH_DOCUMENT_SCHEMA_VERSION;

export type UIGraphDocument = {
    schemaVersion: UIGraphDocumentVersion;
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
    /**
     * What each asset set this node's stored params name resolves to, per locale.
     *
     * The same field `BlueprintGraphNode` declares, and the same object: `adaptBlueprintGraphIr`
     * hands the executor the bundle's own nodes rather than copies, so a node running here is
     * carrying whatever the package wrote onto it. Declared on both because a node reads it from
     * whichever of the two types its caller happens to hold.
     *
     * Never authored and never on disk under `editor/`.
     */
    assetVariants?: AssetVariantMap;
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
