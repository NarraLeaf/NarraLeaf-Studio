import type { StoryBlock, StoryTransformRef, StoryTransitionRef } from "@shared/types/story";
import type { ActionCommandId } from "./storyActionCommands";
import type { StoryCommandResolvedArgs, StoryCommandValue } from "./storyCommandResolution";

/**
 * Write resolved args onto the block `createBlockForCommand` just produced.
 *
 * Hand-written per command, deliberately. The grammar is declarative because parsing, candidates and
 * hints all pay for it; deriving the *payload* does not. `StoryActionPayload` is a discriminated union
 * whose members disagree at every turn — `setBackground` is `assetId` XOR `color`, `character` carries
 * both a `transition` and a `transform`, `wait` splits two semantics across a `mode` field, `dialogue`
 * is `characterId` XOR `speakerName`. A declarative mapping expressive enough for all of that costs
 * more than the switch below and hides the XORs that matter. See the plan's §7-2.
 *
 * Only ever *narrows* what the block already is: the block arrives valid and leaves valid, so an
 * unfilled arg is not an error (`/bg` alone still commits a background awaiting an image).
 */

const FALLBACK_TRANSITION: StoryTransitionRef["kind"] = "fadeIn";

function asNumber(value: StoryCommandValue | undefined): number | undefined {
    return value?.kind === "number" ? value.value : undefined;
}

function asBoolean(value: StoryCommandValue | undefined): boolean | undefined {
    return value?.kind === "boolean" ? value.value : undefined;
}

function asEnum(value: StoryCommandValue | undefined): string | undefined {
    return value?.kind === "enum" ? value.value : undefined;
}

/**
 * Fold `t=` / `d=` into a transition.
 *
 * A duration with no kind still means "animate", so it implies a transition rather than being
 * dropped on the floor — silently ignoring a value the author typed is worse than picking the house
 * default.
 */
function withTransition(current: StoryTransitionRef | undefined, args: StoryCommandResolvedArgs): StoryTransitionRef | undefined {
    const kind = asEnum(args.t) as StoryTransitionRef["kind"] | undefined;
    const durationMs = asNumber(args.d);
    if (kind === undefined && durationMs === undefined) {
        return current;
    }
    return {
        ...(current ?? { kind: FALLBACK_TRANSITION }),
        ...(kind !== undefined ? { kind } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
}

/** Fold `at=` / `d=` into a transform. `d` belongs to the transform on character actions, not the transition. */
function withTransform(current: StoryTransformRef | undefined, args: StoryCommandResolvedArgs): StoryTransformRef | undefined {
    const preset = asEnum(args.at) as StoryTransformRef["preset"] | undefined;
    const durationMs = asNumber(args.d);
    if (preset === undefined && durationMs === undefined) {
        return current;
    }
    return {
        ...(current ?? {}),
        ...(preset !== undefined ? { preset } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
    };
}

export function applyCommandArgs(block: StoryBlock, commandId: ActionCommandId, args: StoryCommandResolvedArgs): StoryBlock {
    switch (commandId) {
        case "background": {
            if (block.kind !== "action" || block.payload.action !== "setBackground") {
                return block;
            }
            const image = args.image;
            const payload = { ...block.payload };
            // assetId XOR color: setting one must clear the other, or the compiler sees both.
            if (image?.kind === "asset") {
                payload.assetId = image.assetId;
                payload.color = undefined;
            } else if (image?.kind === "color") {
                payload.color = image.color;
                payload.assetId = undefined;
            }
            const transition = withTransition(payload.transition, args);
            return { ...block, payload: { ...payload, ...(transition ? { transition } : {}) } };
        }

        case "characterEnter":
        case "characterMove":
        case "characterExit": {
            if (block.kind !== "action" || block.payload.action !== "character") {
                return block;
            }
            const payload = { ...block.payload };
            if (args.character?.kind === "character") {
                payload.characterId = args.character.characterId;
            }
            if (args.form?.kind === "characterForm") {
                payload.formName = args.form.formName;
            }
            const transform = withTransform(payload.transform, args);
            const transition = args.t ? withTransition(payload.transition, { t: args.t }) : payload.transition;
            return {
                ...block,
                payload: {
                    ...payload,
                    ...(transform ? { transform } : {}),
                    ...(transition ? { transition } : {}),
                },
            };
        }

        case "dialogue": {
            if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
                return block;
            }
            const payload = { ...block.payload };
            // characterId XOR speakerName — the row points at a record or carries a bare name, never both.
            if (args.character?.kind === "character") {
                payload.characterId = args.character.characterId;
                payload.speakerName = undefined;
            } else if (args.character?.kind === "speakerName") {
                payload.speakerName = args.character.speakerName;
                payload.characterId = undefined;
            }
            if (args.text?.kind === "text") {
                // Typed on one line, so it is plain: `rich` is dropped rather than left describing the
                // text this line replaced.
                payload.text = { ...payload.text, value: args.text.value, rich: undefined };
            }
            return { ...block, payload };
        }

        case "waitDuration": {
            if (block.kind !== "action" || block.payload.action !== "wait") {
                return block;
            }
            const ms = args.ms;
            if (ms?.kind === "keyword") {
                return { ...block, payload: { action: "wait", mode: "click" } };
            }
            if (ms?.kind === "number") {
                return { ...block, payload: { action: "wait", mode: "duration", durationMs: ms.value } };
            }
            return block;
        }

        case "bgm":
        case "sound": {
            if (block.kind !== "action" || block.payload.action !== "audio") {
                return block;
            }
            const payload = { ...block.payload };
            if (args.audio?.kind === "asset") {
                payload.assetId = args.audio.assetId;
            }
            const fade = asNumber(args.fade);
            if (fade !== undefined) {
                payload.fadeMs = fade;
            }
            const volume = asNumber(args.vol);
            if (volume !== undefined) {
                payload.volume = volume;
            }
            const loop = asBoolean(args.loop);
            if (loop !== undefined) {
                payload.loop = loop;
            }
            return { ...block, payload };
        }

        case "jump": {
            if (block.kind !== "jump") {
                return block;
            }
            const payload = { ...block.payload };
            if (args.scene?.kind === "scene") {
                payload.targetSceneId = args.scene.sceneId;
            }
            const transition = withTransition(payload.transition, args);
            return { ...block, payload: { ...payload, ...(transition ? { transition } : {}) } };
        }

        case "setVariable": {
            if (block.kind !== "action" || block.payload.action !== "setVariable") {
                return block;
            }
            const payload = { ...block.payload };
            if (args.variable?.kind === "variable") {
                payload.target = args.variable.ref;
            }
            if (args.value?.kind === "literal") {
                payload.value = args.value.value;
            }
            return { ...block, payload };
        }

        default:
            // Every other command is menu-only for now: it has no grammar, so it has no args to write.
            return block;
    }
}
