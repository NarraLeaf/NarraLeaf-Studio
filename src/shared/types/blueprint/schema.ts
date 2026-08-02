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
 * v10 (H2a): `program.graphs.eventIds` and `.functionIds` carry the graph-slot order that used to be
 * implied by `events` / `functions` key order. Incompatible downward: a v9 Studio has no notion of
 * the arrays, so every slot it adds or deletes leaves one stale, and canonical serialization would
 * then be free to reorder the records underneath them. Refusing to open is the honest outcome;
 * silently degrading the author's order is not.
 */
export const BLUEPRINT_DOCUMENT_SCHEMA_VERSION = 10 as const;

export type BlueprintDocumentSchemaVersion = typeof BLUEPRINT_DOCUMENT_SCHEMA_VERSION;

/**
 * Node semantics in visual graphs: pure nodes are allowed in binding/field evaluation;
 * effectful nodes belong only in event execution graphs.
 */
export type BlueprintNodeSemanticKind = "pure" | "effectful";
