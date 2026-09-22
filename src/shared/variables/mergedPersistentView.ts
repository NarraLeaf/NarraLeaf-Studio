/**
 * The merged project-variable view.
 *
 * Both project-level scopes - `saved` and `persistent` - come from two authoring surfaces: the
 * project-level registry (`editor/variables.json`, created from the variables panel) and story
 * declaration rows (`/save`, `/global`). Every consumer that needs "all saved variables" or "all
 * persistent variables" - the compiler's reference validation, the variable panel, the blueprint
 * member tree - reads this single merged projection instead of unioning the two inline, so they can
 * never disagree about what exists.
 *
 * The merge is a union keyed by `storageKey` (the addressable, rename-stable identity both surfaces
 * share). A display NAME appearing in BOTH surfaces is a genuine ambiguity - the author sees two
 * variables with one name - so it is reported as a collision and surfaced as a compile diagnostic.
 *
 * The merge itself is scope-blind: it unions exactly what it is handed. Selecting the registry
 * entries and the declaration rows of ONE scope is the caller's job, because only the caller knows
 * which scope it is asking about, and a merge that filtered internally would quietly make a
 * mis-scoped call site look like it worked.
 */

import type { StoryDocument, StoryLiteralValue, StorySavedVariableDefinition, StoryVariableValueType } from "../types/story/document";
import { storyPersistentDefs } from "../types/story/declarations";
import type { VariableRegistryEntry } from "../types/variables/registry";

export type MergedPersistentSource = "registry" | "story";

export type MergedPersistentEntry = {
    /** Host-persistence key: the identity persistent refs resolve against, stable across rename. */
    storageKey: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    source: MergedPersistentSource;
    /** Registry entry id (registry) or declaration block id (story) - for jump-to-source. */
    id: string;
};

export type MergedPersistentNameCollision = {
    /** The display name declared in both surfaces. */
    name: string;
    /** The distinct storage keys that share this name. */
    storageKeys: string[];
};

export type MergedPersistentView = {
    entries: MergedPersistentEntry[];
    /** Names declared in both the registry and a story row - ambiguous; each becomes a compile diagnostic. */
    nameCollisions: MergedPersistentNameCollision[];
};

/**
 * The general merge, for either project scope.
 *
 * `registryEntries` are assumed pre-filtered to the scope being asked about (see the file header);
 * `storyDefs` are that scope's declaration rows. Both scopes share the
 * `StorySavedVariableDefinition` shape, which is why one implementation covers them.
 */
export function buildMergedVariableView(
    registryEntries: readonly VariableRegistryEntry[],
    storyDefs: readonly StorySavedVariableDefinition[],
): MergedPersistentView {
    const entries: MergedPersistentEntry[] = [];
    for (const e of registryEntries) {
        entries.push({
            storageKey: e.storageKey,
            name: e.name,
            valueType: e.valueType,
            defaultValue: e.defaultValue,
            source: "registry",
            id: e.id,
        });
    }
    for (const d of storyDefs) {
        entries.push({
            storageKey: d.storageKey,
            name: d.name,
            valueType: d.valueType,
            defaultValue: d.defaultValue,
            source: "story",
            id: d.id,
        });
    }

    const byName = new Map<string, MergedPersistentEntry[]>();
    for (const entry of entries) {
        const list = byName.get(entry.name);
        if (list) {
            list.push(entry);
        } else {
            byName.set(entry.name, [entry]);
        }
    }
    const nameCollisions: MergedPersistentNameCollision[] = [];
    for (const [name, list] of byName) {
        // A collision requires the name to span BOTH surfaces (registry vs declaration row). Two rows
        // of the same source that share a name are that surface's own concern, not a cross-surface clash.
        const sources = new Set(list.map(entry => entry.source));
        if (sources.size > 1) {
            const storageKeys = [...new Set(list.map(entry => entry.storageKey))].sort();
            nameCollisions.push({ name, storageKeys });
        }
    }
    return { entries, nameCollisions };
}

/**
 * The persistent merge. Kept as its own export because every existing persistent call site names it,
 * and because "persistent" is the scope a reader of those call sites expects to see spelled out.
 */
export function buildMergedPersistentView(
    registryEntries: readonly VariableRegistryEntry[],
    storyDefs: readonly StorySavedVariableDefinition[],
): MergedPersistentView {
    return buildMergedVariableView(registryEntries, storyDefs);
}

/** The set of persistent storage keys the compiler validates references against. */
export function mergedPersistentStorageKeys(view: MergedPersistentView): Set<string> {
    return new Set(view.entries.map(entry => entry.storageKey));
}

/**
 * What each declared persistent variable reads as before anything has stored a value for it, keyed
 * by storage key - the table a running game's persistence scope answers unwritten reads from.
 *
 * The registry entry wins where a story row declares the same key, as it does everywhere else the
 * two are joined by key: the row is the older surface, and the declaration migration copies its
 * default into the registry before retiring it, so the two can only differ on a document that
 * migration could not write.
 */
export function persistentDefaultsByStorageKey(view: MergedPersistentView): Record<string, StoryLiteralValue> {
    const defaults: Record<string, StoryLiteralValue> = {};
    for (const entry of view.entries) {
        if (entry.defaultValue !== undefined && !Object.prototype.hasOwnProperty.call(defaults, entry.storageKey)) {
            defaults[entry.storageKey] = entry.defaultValue;
        }
    }
    return defaults;
}

/**
 * {@link persistentDefaultsByStorageKey} for everything one build declares: the registry baked into
 * the bundle, and the persistent declaration rows of every story it carries.
 *
 * Every story rather than the one about to run, because the table outlives any one story: a title
 * screen reads persistent variables before a story has been chosen, and the same scope serves every
 * story the player starts after it.
 */
export function declaredPersistentDefaults(bundle: {
    ui: { persistentVariables?: Readonly<Record<string, VariableRegistryEntry>> };
    storyLibrary?: { documents: Readonly<Record<string, StoryDocument>> };
}): Record<string, StoryLiteralValue> {
    return persistentDefaultsByStorageKey(buildMergedPersistentView(
        Object.values(bundle.ui.persistentVariables ?? {}),
        Object.values(bundle.storyLibrary?.documents ?? {}).flatMap(document => Object.values(storyPersistentDefs(document))),
    ));
}
