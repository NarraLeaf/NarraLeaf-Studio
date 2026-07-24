/**
 * The merged persistent-variable view (M-VAR WI-3).
 *
 * Persistent variables come from two authoring surfaces: the project-level registry (blueprint-
 * declared, the one class not authored as a story row) and story `/persis` declaration rows. Every
 * consumer that needs "all persistent variables" - the compiler's reference validation, the variable
 * panel, the blueprint member tree - reads this single merged projection instead of unioning the two
 * inline, so they can never disagree about what exists.
 *
 * The merge is a union keyed by `storageKey` (the addressable, rename-stable identity both surfaces
 * share). A display NAME appearing in BOTH surfaces is a genuine ambiguity - the author sees two
 * variables with one name - so it is reported as a collision and surfaced as a compile diagnostic.
 */

import type { StoryLiteralValue, StorySavedVariableDefinition, StoryVariableValueType } from "../types/story/document";
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

export function buildMergedPersistentView(
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

/** The set of persistent storage keys the compiler validates references against. */
export function mergedPersistentStorageKeys(view: MergedPersistentView): Set<string> {
    return new Set(view.entries.map(entry => entry.storageKey));
}
