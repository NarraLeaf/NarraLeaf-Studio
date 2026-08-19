import type {
    StoryActionableTargetRef,
    StoryActionPayload,
    StoryBlock,
    StoryDisplayableTargetRef,
    StoryTransformRef,
    StoryTransitionRef,
} from "@shared/types/story";
import { ACTIONABLE_BUILTIN_META, BGM_STAGE_OBJECT_NAME, characterStageName, DISPLAYABLE_BUILTIN_META } from "@shared/types/story";
import type { StoryCommandContext, StoryCommandStageObjectKind, StoryCommandTargetValue, StoryCommandValue } from "../storyCommandValues";
import { asDurationMs, asEnum, asTarget } from "./spec";
import { applyPlacementToTransform, applyTransitionWordToTransform, transitionKindFor } from "./transitions";

/**
 * Shared "modifier args → payload fragment" writers.
 *
 * Every spec that takes `t=` / `d=` / `at=` folds them through here, so the vocabulary table
 * has exactly one implementation per key. All writers return the current value
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

/** Fold `at=` / `d=` into a transform - the three placements, for character and create commands. */
export function withPlacementTransform(
    current: StoryTransformRef | undefined,
    at: StoryCommandValue | undefined,
    d: StoryCommandValue | undefined,
): StoryTransformRef | undefined {
    const placement = asEnum(at);
    const durationMs = asDurationMs(d);
    if (placement === undefined && durationMs === undefined) {
        return current;
    }
    const placed = placement === undefined ? current : applyPlacementToTransform(current, placement);
    if (durationMs === undefined) {
        return placed;
    }
    return { ...(placed ?? {}), durationMs };
}

/**
 * A non-create `vfx` row, built wherever a generic verb resolved its target to an ambience overlay.
 *
 * Shared because three files reach it - `/show` `/hide` from the character family, `/pause` `/resume`
 * `/rate` from the sound family - and a Vfx's verbs are its own: it is an `Actionable`, so none of the
 * displayable or audio payloads can carry them.
 */
export function vfxOperationBlock(
    operation: Exclude<Extract<StoryActionPayload, { action: "vfx" }>["operation"], "create">,
    objectName: string,
    generateId: () => string,
    extra?: Partial<Extract<StoryActionPayload, { action: "vfx" }>>,
): StoryBlock {
    return {
        id: generateId(),
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload: { action: "vfx", operation, objectName, ...extra },
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
    // An ambience overlay's clip comes out of the video library, so it names itself off the same list.
    const list = stageKind === "video" || stageKind === "vfx"
        ? context.videos
        : stageKind === "audio" ? context.audio : context.images;
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
    const durationMs = asDurationMs(d);
    if (word === undefined && durationMs === undefined) {
        return current;
    }
    const posed = word === undefined ? current : applyTransitionWordToTransform(current, context, word);
    if (durationMs === undefined) {
        return posed;
    }
    return { ...(posed ?? {}), durationMs };
}

/**
 * The displayable target ref a generic-effect block addresses — the resolved line target reduced to
 * the name-plus-kind pair a `displayable` payload stores, which the inspector's binding resolves back.
 *
 * Shared because more than one command builds that payload from a target param, and the mapping is a
 * rule rather than a formality: which kinds are Displayables at all is stated here once.
 *
 * (`specs/effects.ts` still carries a private twin of this, from before there was a second caller.
 * Collapsing it onto this one is a one-line follow-up, left out here only to keep this change off a
 * file another branch is editing.)
 */
export function displayableTargetRef(target: ReturnType<typeof asTarget>): StoryDisplayableTargetRef | undefined {
    if (!target) {
        return undefined;
    }
    if (target.type === "reserved") {
        // The camera is not one of these: it has a payload arm of its own (`story.camera` is
        // addressed distinctly by the engine), so a caller that resolved it never reaches here.
        if (target.name === "camera") {
            return undefined;
        }
        const meta = DISPLAYABLE_BUILTIN_META[target.name];
        // `builtin` is the source of truth for these; `name`/`kind` ride along as the display
        // fallbacks `resolveDisplayableTargetRef` documents, so a ref stays readable on its own.
        return { builtin: target.name, kind: meta.kind, name: meta.label, label: meta.label };
    }
    if (target.type === "character") {
        // `name` is the STAGE KEY, not the cast name. The compiler registers a character's portrait
        // under its entering row's stage name - or under the character id when that row named none -
        // so storing what the author typed made the lookup miss the moment the two differed, and
        // `getImage` being get-or-create turned that miss into a blank sprite rather than an error.
        // The cast name is what a person reads, so it becomes `label`.
        return {
            kind: "character",
            name: target.stageName ?? characterStageName(target.characterId),
            label: target.name,
            ...(target.sourceBlockId ? { sourceBlockId: target.sourceBlockId } : {}),
        };
    }
    // Audio, video and vfx are not Displayables and no caller's `accepts` list offers them; this arm
    // exists to keep the function total, not because a line can reach it.
    if (target.objectKind === "audio" || target.objectKind === "video" || target.objectKind === "vfx") {
        return { name: target.name, label: target.name };
    }
    // An image / text / layer names itself: the stage key IS what the author typed, so the two halves
    // coincide. `label` is written anyway rather than left for the reader to infer - a reference with
    // no label falls back to `name`, and that fallback is the legacy path, not this one.
    return {
        kind: target.objectKind,
        name: target.name,
        label: target.name,
        ...(target.sourceBlockId ? { sourceBlockId: target.sourceBlockId } : {}),
    };
}

/**
 * The reference a row addressing a named `Actionable` handle stores - a clip, an ambience overlay, a
 * sound played by an earlier row.
 *
 * The `Actionable` counterpart of {@link displayableTargetRef}, and separate from it because the two
 * ref types are siblings rather than one widened type: `StoryDisplayableTargetKind` deliberately
 * excludes video and vfx, and audio is not a stage object at all.
 *
 * A named handle's stage key is the name the author typed, so `name` and `label` coincide here. The
 * one case where they do not - a `playSound` row with no name, which keys on its `assetId` - is not
 * reachable from a line: the candidate list only offers rows that HAVE a name. It is reachable
 * through the anchor, and that is exactly what `resolveActionableTargetRef` reads `label` for.
 */
export function actionableTargetRef(target: Extract<StoryCommandTargetValue, { type: "stageObject" }>): StoryActionableTargetRef {
    return {
        name: target.name,
        label: target.name,
        ...(target.sourceBlockId ? { sourceBlockId: target.sourceBlockId } : {}),
    };
}

/**
 * The reference a sound-control row stores.
 *
 * An omitted target means the music channel (`/vol 0.5` turns the music down), and so does the
 * reserved word spelled out. That channel is referenced as `{ builtin: "bgm" }` rather than bound to
 * a row, because it HAS no declaring row: a scene states its music on its own record, and every
 * `/vol` addresses the same handle whether or not this scene holds a `/bgm` line.
 */
export function audioTargetRef(target: StoryCommandTargetValue | undefined): StoryActionableTargetRef {
    if (target?.type === "stageObject" && target.name !== BGM_STAGE_OBJECT_NAME) {
        return actionableTargetRef(target);
    }
    const meta = ACTIONABLE_BUILTIN_META.bgm;
    return { builtin: "bgm", name: meta.name, label: meta.label };
}
