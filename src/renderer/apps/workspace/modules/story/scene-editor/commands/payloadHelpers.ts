import type { StoryTransformRef, StoryTransitionRef } from "@shared/types/story";
import type { StoryCommandContext, StoryCommandStageObjectKind, StoryCommandValue } from "../storyCommandValues";
import { asDurationMs, asEnum } from "./spec";
import { transformPresetFor, transitionKindFor } from "./transitions";

/**
 * Shared "modifier args → payload fragment" writers.
 *
 * Every spec that takes `t=` / `d=` / `at=` folds them through here, so the vocabulary table
 * (bible §1.2) has exactly one implementation per key. All writers return the current value
 * untouched when no relevant arg is present - a spec's build only ever *narrows* the default block.
 */

/**
 * Fold `t=` / `d=` into a `StoryTransitionRef` for a whole-screen or character command.
 *
 * A duration with no word still means "animate", so it implies a transition rather than being
 * dropped on the floor - the house default is the context's own `fade`.
 */
export function withTransitionRef(
    current: StoryTransitionRef | undefined,
    context: "scene" | "character",
    t: StoryCommandValue | undefined,
    d: StoryCommandValue | undefined,
): StoryTransitionRef | undefined {
    const word = asEnum(t);
    const kind = word === undefined ? undefined : transitionKindFor(context, word);
    const durationMs = asDurationMs(d);
    if (kind === undefined && durationMs === undefined) {
        return current;
    }
    return {
        ...(current ?? { kind: transitionKindFor(context, "fade") ?? "fadeIn" }),
        ...(kind !== undefined ? { kind } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
}

/** Fold `at=` / `d=` into a transform - placement presets, for character and create commands. */
export function withPlacementTransform(
    current: StoryTransformRef | undefined,
    at: StoryCommandValue | undefined,
    d: StoryCommandValue | undefined,
): StoryTransformRef | undefined {
    const preset = asEnum(at) as StoryTransformRef["preset"] | undefined;
    const durationMs = asDurationMs(d);
    if (preset === undefined && durationMs === undefined) {
        return current;
    }
    return {
        ...(current ?? {}),
        ...(preset !== undefined ? { preset } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
}

/**
 * The auto-name pass for a `create` command (`deriveArgs`): fill in the object name the author left
 * blank, so `/image forest.png` lands an image called `forest` - the same "no name needed" feel as
 * `/bg`. Derived from the asset's filename when `assetParam` names one, else a deduped `base`, so two
 * `/text` lines become `text` and `text2` rather than colliding. Skipped when the author named it -
 * their choice wins.
 */
export function deriveObjectName(stageKind: StoryCommandStageObjectKind, assetParam: string | null, base: string) {
    return (args: Readonly<Record<string, StoryCommandValue | undefined>>, context: StoryCommandContext): Record<string, StoryCommandValue> => {
        if (args.name) {
            return {};
        }
        const asset = assetParam ? args[assetParam] : undefined;
        const seed = asset?.kind === "asset" ? assetBaseName(context, stageKind, asset.assetId) ?? base : base;
        return { name: { kind: "text", value: dedupeObjectName(seed, context.stageObjects[stageKind] ?? []) } };
    };
}

/** The asset's display name without its extension - `forest.png` → `forest` - or null when unknown. */
function assetBaseName(context: StoryCommandContext, stageKind: StoryCommandStageObjectKind, assetId: string): string | null {
    const list = stageKind === "video" ? context.videos : stageKind === "audio" ? context.audio : context.images;
    const found = list.find(entry => entry.id === assetId);
    const stripped = found?.name.replace(/\.[^./\\]+$/, "").trim();
    return stripped ? stripped : null;
}

/** `base`, or `base2`, `base3`… - the first not already taken (case-insensitive) by an object on stage. */
function dedupeObjectName(base: string, existing: readonly string[]): string {
    const taken = new Set(existing.map(name => name.trim().toLowerCase()));
    if (!taken.has(base.trim().toLowerCase())) {
        return base;
    }
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${base}${suffix}`;
        if (!taken.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
}

/**
 * Fold `t=` / `d=` into a stage object's transform - the reveal/conceal presets a show/hide (or the
 * NVL panel) animates through. Images and texts have no separate `StoryTransitionRef`; the direction
 * comes from the verb, which is why the caller names the context.
 */
export function withRevealTransform(
    current: StoryTransformRef | undefined,
    context: "reveal" | "conceal" | "nvl",
    t: StoryCommandValue | undefined,
    d: StoryCommandValue | undefined,
): StoryTransformRef | undefined {
    const word = asEnum(t);
    const preset = word === undefined ? undefined : transformPresetFor(context, word);
    const durationMs = asDurationMs(d);
    if (preset === undefined && durationMs === undefined) {
        return current;
    }
    return {
        ...(current ?? {}),
        ...(preset !== undefined ? { preset } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
}
