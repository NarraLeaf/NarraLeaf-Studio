/**
 * Helpers for inline text interpolation (phase 2): resolving variable/blueprint refs to display
 * names for chips and pickers. Never exposes internal ids to users. Comments in English per convention.
 */

import type {
    StoryDocument,
    StoryInterpolationRef,
    StorySceneId,
    StoryVariableRef,
    StoryVariableValueType,
} from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs } from "@shared/types/story";

export type PersistentVariableOption = { storageKey: string; name: string; valueType: StoryVariableValueType };

/**
 * A registry-declared `saved` variable, addressed by entry id.
 *
 * By id and not by storage key, unlike its persistent sibling: a `StoryVariableRef`'s saved arm
 * carries `variableId`, and the registry mints an entry's id from the declaration row's block id so
 * refs authored before the registry existed keep resolving. Changing the key here would break every
 * stored ref and every scene snapshot at once.
 */
export type SavedVariableOption = { id: string; name: string; valueType: StoryVariableValueType };

export type StoryVariableOption = { id: string; name: string; valueType: StoryVariableValueType };

/**
 * Session memory of the last interpolation kind (variable vs blueprint) the author picked, so a fresh
 * "insert value" defaults to it instead of always starting on "variable". Module-level (per renderer
 * session); intentionally not persisted to disk.
 */
let lastInterpolationKind: StoryInterpolationRef["kind"] = "variable";

export function getLastInterpolationKind(): StoryInterpolationRef["kind"] {
    return lastInterpolationKind;
}

export function rememberInterpolationKind(kind: StoryInterpolationRef["kind"]): void {
    lastInterpolationKind = kind;
}

/** Default (empty) interpolation ref for a kind - used when inserting a fresh inline value. */
export function defaultInterpolationForKind(kind: StoryInterpolationRef["kind"]): StoryInterpolationRef {
    return kind === "blueprint"
        ? { kind: "blueprint", blueprintId: "" }
        : { kind: "variable", target: { scope: "scene", variableId: "" } };
}

/**
 * The three scopes' pickable variables.
 *
 * `savedRegistry` is a trailing optional rather than a second required list so the two callers that
 * legitimately have no project services to read it from (the read-only row projections) keep
 * compiling and keep behaving exactly as before. Where it IS passed, saved variables declared only in
 * the project registry become selectable; without it they are invisible in the picker even though a
 * typed `/set` resolves them.
 */
export function collectStoryVariableOptions(
    document: StoryDocument,
    sceneId: StorySceneId,
    persistent: PersistentVariableOption[],
    savedRegistry: readonly SavedVariableOption[] = [],
): { scene: StoryVariableOption[]; saved: StoryVariableOption[]; persistent: StoryVariableOption[] } {
    const sceneDoc = document.scenes[sceneId];
    const scene = Object.values(sceneDoc ? sceneVariableDefs(sceneDoc) : {}).map(v => ({
        id: v.id,
        name: v.name,
        valueType: v.valueType,
    }));
    const saved = [
        ...savedRegistry.map(v => ({ id: v.id, name: v.name, valueType: v.valueType })),
        ...Object.values(savedVariableDefs(document)).map(v => ({
            id: v.id,
            name: v.name,
            valueType: v.valueType,
        })),
    ];
    return {
        scene,
        saved,
        persistent: persistent.map(v => ({ id: v.storageKey, name: v.name, valueType: v.valueType })),
    };
}

export function resolveVariableRefName(
    document: StoryDocument,
    sceneId: StorySceneId,
    persistent: PersistentVariableOption[],
    ref: StoryVariableRef,
    savedRegistry: readonly SavedVariableOption[] = [],
): string {
    if (ref.scope === "scene") {
        const sceneDoc = document.scenes[sceneId];
        return (sceneDoc ? sceneVariableDefs(sceneDoc) : {})[ref.variableId]?.name ?? "variable";
    }
    if (ref.scope === "saved") {
        return savedVariableDefs(document)[ref.variableId]?.name
            ?? savedRegistry.find(option => option.id === ref.variableId)?.name
            ?? "variable";
    }
    return persistent.find(option => option.storageKey === ref.variableId)?.name ?? "persistent";
}

export function resolveInterpolationName(
    document: StoryDocument,
    sceneId: StorySceneId,
    persistent: PersistentVariableOption[],
    interp: StoryInterpolationRef,
    savedRegistry: readonly SavedVariableOption[] = [],
): string {
    if (interp.kind === "variable") {
        return resolveVariableRefName(document, sceneId, persistent, interp.target, savedRegistry);
    }
    return "blueprint";
}
