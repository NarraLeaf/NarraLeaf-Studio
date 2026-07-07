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

export type PersistentVariableOption = { storageKey: string; name: string; valueType: StoryVariableValueType };

export type StoryVariableOption = { id: string; name: string; valueType: StoryVariableValueType };

export function collectStoryVariableOptions(
    document: StoryDocument,
    sceneId: StorySceneId,
    persistent: PersistentVariableOption[],
): { scene: StoryVariableOption[]; saved: StoryVariableOption[]; persistent: StoryVariableOption[] } {
    const scene = Object.values(document.scenes[sceneId]?.sceneVariables ?? {}).map(v => ({
        id: v.id,
        name: v.name,
        valueType: v.valueType,
    }));
    const saved = Object.values(document.savedVariables ?? {}).map(v => ({
        id: v.id,
        name: v.name,
        valueType: v.valueType,
    }));
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
): string {
    if (ref.scope === "scene") {
        return document.scenes[sceneId]?.sceneVariables?.[ref.variableId]?.name ?? "variable";
    }
    if (ref.scope === "saved") {
        return document.savedVariables?.[ref.variableId]?.name ?? "variable";
    }
    return persistent.find(option => option.storageKey === ref.storageKey)?.name ?? "persistent";
}

export function resolveInterpolationName(
    document: StoryDocument,
    sceneId: StorySceneId,
    persistent: PersistentVariableOption[],
    interp: StoryInterpolationRef,
): string {
    if (interp.kind === "variable") {
        return resolveVariableRefName(document, sceneId, persistent, interp.target);
    }
    return "blueprint";
}
