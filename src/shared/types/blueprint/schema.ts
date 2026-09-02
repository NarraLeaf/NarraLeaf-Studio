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
 * v11: every part of an owner key is percent-encoded, so the separator can no longer occur inside
 * one. The migration rewrites `ownerRecords` keys into the escaped spelling. See
 * `@shared/blueprint/ownerKey`.
 * v12: the `sharedAsset` owner kind is gone, and with it the second place a blueprint could be
 * stored - a `.nlbp` asset file under `assets/content/`, outside this document and so outside its
 * version, its `ownerRecords` and this ladder. The migration drops any blueprint left carrying that
 * owner. It is a version rather than a silent read because a leftover is not inert: every owner
 * switch in the codebase is exhaustive over `BlueprintOwnerRef`, so one that no longer has an arm
 * falls off the end of the key encoder and reaches the document validator as `[object Object]`.
 * v13: a script blueprint holds the PATH of the author's file under `scripts/` rather than its
 * text. The text was never Studio's to hold - a document service that keeps a copy writes it back
 * over an edit made in the author's own editor - and the inline form never ran: nothing mounted
 * those modules, so the shipped "New TypeScript" button produced a blueprint that did nothing. The
 * migration writes each one's text out to a file and points the blueprint at it, so no typing is
 * lost even though none of it ever executed.
 *
 * The ladder that reads these stops at `BLUEPRINT_DOCUMENT_MIN_SUPPORTED_VERSION`. The versions
 * named above it are kept as the record of what each one changed; the ones below are history only,
 * and a document at one of them is refused. See `@shared/blueprint/migrateBlueprintDocument`.
 */
export const BLUEPRINT_DOCUMENT_SCHEMA_VERSION = 13 as const;

export type BlueprintDocumentSchemaVersion = typeof BLUEPRINT_DOCUMENT_SCHEMA_VERSION;

/**
 * Node semantics in visual graphs: pure nodes are allowed in binding/field evaluation;
 * effectful nodes belong only in event execution graphs.
 */
export type BlueprintNodeSemanticKind = "pure" | "effectful";
