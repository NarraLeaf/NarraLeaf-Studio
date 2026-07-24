/**
 * Project-level variable registry (M-VAR).
 *
 * Holds the persistent variables that blueprints declare - the one persistent class the bible does
 * NOT author as a story `/persis` row (see the 2026-07-23 §10 adjudication in the story-editor
 * overhaul plan). Story `/persis` declarations stay as declaration rows in the story document
 * (`declarations.ts`); consumers that need "every persistent variable" read a MERGED view of this
 * registry plus the story-row scan (`mergedPersistentView.ts`).
 *
 * The entry shape is deliberately the story-variable shape (`{ id, name, valueType, defaultValue,
 * storageKey }`) so the merge is a union of like records rather than a translation. `valueType` is
 * the same 4-value closed set the story scopes use.
 *
 * Definitions are authoring assets; the VALUES live in host-managed persistence, keyed by
 * `storageKey`. The registry travels to the runtime baked into the Dev Mode bundle / game pack, not
 * as a live service - the runtime never mutates it.
 */

import type { StoryLiteralValue, StoryVariableValueType } from "../story/document";

/** Persisted registry file version. Independent of the story/blueprint document versions. */
export const VARIABLE_REGISTRY_SCHEMA_VERSION = 1 as const;

export type VariableRegistrySchemaVersion = typeof VARIABLE_REGISTRY_SCHEMA_VERSION;

/**
 * One project-level persistent variable, blueprint-declared.
 *
 * `id` is the stable identity refs point at; `storageKey` is the host-persistence key (defaults to
 * `id`, never changed by rename so saves stay valid). The migration off `BlueprintDocument`
 * seeds `id` from the old `storageKey` so every stored `StoryVariableRef` persistent arm keeps
 * resolving (its arm is keyed by `storageKey` until WI-4 symmetrizes it to `variableId`).
 */
export type VariableRegistryEntry = {
    id: string;
    /** Author-facing, proper-case label. Displayed to users; the id/storageKey are never shown. */
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Stable host-persistence key; defaults to `id`, unchanged on rename. */
    storageKey: string;
    description?: string;
};

export type VariableRegistry = {
    schemaVersion: VariableRegistrySchemaVersion;
    /** Keyed by entry id. */
    entries: Record<string, VariableRegistryEntry>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/**
 * The runtime-facing persistent table, baked into a bundle/pack from the registry. The blueprint
 * runtime reads only `storageKey` (for host persistence) and `defaultValue` (fallback), keyed by the
 * node param `persistentVariableId` (= entry id). Kept as the full entry so a single value can feed
 * both the runtime read and any display need without a second projection.
 */
export type PersistentVariableRuntimeTable = Record<string, VariableRegistryEntry>;
