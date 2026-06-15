/**
 * Blueprint System — schema version constants and cross-cutting semantic tags.
 * M2 persists BlueprintDocument inside `uigraphs.json` under `blueprintDocument`.
 */

/** Canonical schema for persisted BlueprintDocument (ownerRecords + blueprints). Bumped on incompatible changes. */
export const BLUEPRINT_DOCUMENT_SCHEMA_VERSION = 5 as const;

export type BlueprintDocumentSchemaVersion = typeof BLUEPRINT_DOCUMENT_SCHEMA_VERSION;

/**
 * Node semantics in visual graphs: pure nodes are allowed in binding/field evaluation;
 * effectful nodes belong only in event execution graphs.
 */
export type BlueprintNodeSemanticKind = "pure" | "effectful";
