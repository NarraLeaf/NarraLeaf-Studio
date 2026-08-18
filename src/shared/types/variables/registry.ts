/**
 * Project-level variable registry (M-VAR).
 *
 * Holds the project-scoped variable definitions: everything whose lifetime is wider than one scene.
 * That is the `saved` scope (per-playthrough state, carried in the save file) and the `persistent`
 * scope (app-level state, carried in host persistence). The story document owns only `scene`
 * variables - a scene variable is created, read and discarded inside a single scene, so its
 * declaration belongs where it is used and there is nothing project-level to register.
 *
 * Both project scopes ALSO have a legacy authoring surface: `/save` and `/global` declaration rows
 * in a story document, which keep working unchanged. Consumers that need "every saved variable" or
 * "every persistent variable" therefore read a MERGED view of this registry plus the story-row scan
 * (`mergedPersistentView.ts`) rather than either surface alone.
 *
 * The entry shape is deliberately the story-variable shape (`{ id, name, valueType, defaultValue,
 * storageKey }`) so the merge is a union of like records rather than a translation. `valueType` is
 * the same 4-value closed set the story scopes use.
 *
 * Definitions are authoring assets; the VALUES live in the save file / host-managed persistence,
 * keyed by `storageKey`. The registry travels to the runtime baked into the Dev Mode bundle / game
 * pack, not as a live service - the runtime never mutates it.
 */

import type { StoryLiteralValue, StoryVariableValueType } from "../story/document";

/**
 * Persisted registry file version. Independent of the story/blueprint document versions.
 *
 * v2 added `scope`, when the registry stopped being persistent-only. Every v1 entry was persistent
 * by construction, so the migration back-fills that rather than asking.
 */
export const VARIABLE_REGISTRY_SCHEMA_VERSION = 2 as const;

export type VariableRegistrySchemaVersion = typeof VARIABLE_REGISTRY_SCHEMA_VERSION;

/**
 * The scopes a registry entry may declare. `scene` is deliberately absent: a scene variable is
 * bound to one scene and is authored as a declaration row in it, so it never reaches the registry.
 */
export type VariableRegistryScope = "saved" | "persistent";

/**
 * One project-level variable definition.
 *
 * `id` is the stable identity refs point at; `storageKey` is the save-file / host-persistence key
 * (defaults to `id`, never changed by rename so saves stay valid). The migration off
 * `BlueprintDocument` seeds `id` from the old `storageKey` so every stored `StoryVariableRef`
 * persistent arm keeps resolving (that arm is still keyed by `storageKey` rather than by
 * `variableId`).
 */
export type VariableRegistryEntry = {
  id: string;
  /** Author-facing, proper-case label. Displayed to users; the id/storageKey are never shown. */
  name: string;
  /**
   * Which project scope this definition belongs to. Decides which runtime table it lands in and
   * which channel reads it - the two never mix, so no consumer may treat the registry as one flat
   * list of persistent variables.
   */
  scope: VariableRegistryScope;
  valueType: StoryVariableValueType;
  defaultValue?: StoryLiteralValue;
  /** Stable save-file / host-persistence key; defaults to `id`, unchanged on rename. */
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
 *
 * Holds the `persistent` entries only - see {@link SavedVariableRuntimeTable}.
 */
export type PersistentVariableRuntimeTable = Record<string, VariableRegistryEntry>;

/**
 * The runtime-facing saved table: the same projection for the `saved` scope, keyed by the node param
 * `savedVariableId` (= entry id). A separate table rather than a `scope` filter at each read site,
 * because the two scopes are backed by different stores - saved values live in the playthrough's
 * save file, persistent values in app-level host persistence - and a lookup that could silently
 * cross from one to the other would write player progress into the wrong lifetime.
 */
export type SavedVariableRuntimeTable = Record<string, VariableRegistryEntry>;
