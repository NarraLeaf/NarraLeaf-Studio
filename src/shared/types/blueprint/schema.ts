/**
 * Blueprint System - schema version constants and cross-cutting semantic tags.
 * M2 persists BlueprintDocument inside `uigraphs.json` under `blueprintDocument`.
 */

/**
 * Canonical schema for persisted BlueprintDocument (ownerRecords + blueprints). Bumped on incompatible changes.
 * v9 (M-VAR): `persistentVariables` left the document for the project-level variable registry
 * (`editor/variables.json`). The migration strips the field and remaps `persistentVariableId` node
 * params from the old blueprint id to the storage-key-derived registry id; the seed into the registry
 * happens where a service/bundle can write that file (UIGraphService / bundleAssembler).
 */
export const BLUEPRINT_DOCUMENT_SCHEMA_VERSION = 9 as const;

export type BlueprintDocumentSchemaVersion = typeof BLUEPRINT_DOCUMENT_SCHEMA_VERSION;

/**
 * Node semantics in visual graphs: pure nodes are allowed in binding/field evaluation;
 * effectful nodes belong only in event execution graphs.
 */
export type BlueprintNodeSemanticKind = "pure" | "effectful";
