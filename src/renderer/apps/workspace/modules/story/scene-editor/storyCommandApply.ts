import type {
    StoryActionPayload,
    StoryBlock,
    StoryExpr,
    StoryExpression,
    StoryLiteralValue,
    StoryTransformRef,
    StoryTransitionRef,
    StoryVariableValueType,
} from "@shared/types/story";
import { storySecondsToMs } from "@shared/utils/storyTime";
import type { ActionCommandId } from "./storyActionCommands";
import type { StoryCommandResolvedArgs, StoryCommandValue } from "./storyCommandResolution";

/**
 * Write resolved args onto the block `createBlockForCommand` just produced.
 *
 * Hand-written per command, deliberately. The grammar is declarative because parsing, candidates and
 * hints all pay for it; deriving the *payload* does not. `StoryActionPayload` is a discriminated union
 * whose members disagree at every turn - `setBackground` is `assetId` XOR `color`, `character` carries
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

/** Durations are typed in seconds and stored in milliseconds - `d=0.3` means 300ms. */
function asDurationMs(value: StoryCommandValue | undefined): number | undefined {
    const seconds = asNumber(value);
    return seconds === undefined ? undefined : storySecondsToMs(seconds);
}

function asBoolean(value: StoryCommandValue | undefined): boolean | undefined {
    return value?.kind === "boolean" ? value.value : undefined;
}

function asEnum(value: StoryCommandValue | undefined): string | undefined {
    return value?.kind === "enum" ? value.value : undefined;
}

function asColor(value: StoryCommandValue | undefined): string | undefined {
    return value?.kind === "color" ? value.color : undefined;
}

/** A free-typed object name (`text`), trimmed. Empty means "leave the block's default name". */
function asObjectName(value: StoryCommandValue | undefined): string | undefined {
    if (value?.kind !== "text") {
        return undefined;
    }
    const trimmed = value.value.trim();
    return trimmed === "" ? undefined : trimmed;
}

/**
 * Fold `t=` / `d=` into a transition.
 *
 * A duration with no kind still means "animate", so it implies a transition rather than being
 * dropped on the floor - silently ignoring a value the author typed is worse than picking the house
 * default.
 */
function withTransition(current: StoryTransitionRef | undefined, args: StoryCommandResolvedArgs): StoryTransitionRef | undefined {
    const kind = asEnum(args.t) as StoryTransitionRef["kind"] | undefined;
    const durationMs = asDurationMs(args.d);
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
    const durationMs = asDurationMs(args.d);
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
 * Fold a stage object's transform: placement (`at=`, on a create) or reveal (`t=`, on a show/hide),
 * plus `d=`. Images and texts have no separate `StoryTransitionRef` - their entrance and exit animate
 * through the transform preset - so both the placement and the reveal land here; a command never sets
 * both, so reading whichever is present is unambiguous.
 */
function withStageTransform(current: StoryTransformRef | undefined, args: StoryCommandResolvedArgs): StoryTransformRef | undefined {
    const preset = (asEnum(args.at) ?? asEnum(args.t)) as StoryTransformRef["preset"] | undefined;
    const durationMs = asDurationMs(args.d);
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
 * Write a computed right-hand side onto a `setVariable` payload.
 *
 * A tree that is nothing but a literal folds back into `value` and clears `expression`. That keeps
 * `/set met true` producing byte-identical output to what it produced before expressions existed -
 * the inspector's literal editor still binds to it, the compiler still takes the direct
 * `Persistent.set` path, and the document does not grow an expression object around a constant.
 */
function withAssignedExpression(
    payload: Extract<StoryActionPayload, { action: "setVariable" }>,
    expression: StoryExpression,
): Extract<StoryActionPayload, { action: "setVariable" }> {
    if (expression.ast.kind === "literal") {
        return { ...payload, value: expression.ast.value, expression: undefined };
    }
    return { ...payload, expression };
}

/**
 * The variable a `/local` `/var` `/persis` line declares, derived from its resolved args.
 *
 * Lives here, beside the other "resolved args → data" mappings, rather than inside the commit
 * callback in the editor hook - which is where it started, and where a real bug hid: it read the
 * default as an `expression` after the slot had become a `constant`, so `/local gold 100` silently
 * declared a *boolean* named `gold` with no default. Nothing threw and nothing warned, because
 * "no default" and "a default this code could not read" are the same value. Pure and exported, it is
 * covered by a test that pins the whole line to the declaration it produces.
 */
export function declarationFromArgs(args: StoryCommandResolvedArgs): {
    name: string;
    valueType: StoryVariableValueType;
    defaultValue: StoryLiteralValue | undefined;
    description: string | undefined;
} | null {
    const name = args.name?.kind === "text" ? args.name.value.trim() : "";
    if (!name) {
        return null;
    }
    const defaultValue = args.default?.kind === "literal" ? args.default.value : undefined;
    return {
        name,
        // An explicit `type=` wins; otherwise the default's own type is the best evidence available.
        valueType: args.type?.kind === "enum" ? args.type.value as StoryVariableValueType : inferDeclaredType(defaultValue),
        defaultValue,
        description: args.desc?.kind === "text" && args.desc.value.trim() ? args.desc.value.trim() : undefined,
    };
}

/**
 * The type of a declaration with no explicit `type=`.
 *
 * Boolean is the fallback for a bare `/local met` because a flag is what an author declares without
 * thinking about types at all. Note this makes the *default* carry the type: `/local gold 100` is a
 * number only because `100` is, which is why reading the default correctly matters more than it looks.
 */
function inferDeclaredType(defaultValue: StoryLiteralValue | undefined): StoryVariableValueType {
    if (typeof defaultValue === "number") {
        return "number";
    }
    if (typeof defaultValue === "string") {
        return "string";
    }
    if (typeof defaultValue === "boolean" || defaultValue === undefined) {
        return "boolean";
    }
    return "json";
}

/** The zero value of a type - what a variable declared without an explicit default holds. */
function defaultForType(valueType: StoryVariableValueType): StoryLiteralValue {
    switch (valueType) {
        case "boolean":
            return false;
        case "number":
            return 0;
        case "string":
            return "";
        case "json":
            return null;
    }
}

/**
 * `/inc gold`, `/dec gold 5`, `/toggle met`, `/reset gold` - all four lower to the `setVariable`
 * block `/set` would have built, differing only in the expression they synthesize.
 *
 * The trees are built directly rather than by re-parsing a synthesized source string: there is no
 * user text to honour here, and going through the parser would make these commands able to fail on
 * a variable name that happens to contain a space or an operator character.
 */
function applyAssignmentSugar(block: StoryBlock, commandId: ActionCommandId, args: StoryCommandResolvedArgs): StoryBlock {
    if (block.kind !== "action" || block.payload.action !== "setVariable" || args.variable?.kind !== "variable") {
        return block;
    }
    const variable = args.variable;
    const payload = { ...block.payload, target: variable.ref };
    const self: StoryExpr = { kind: "var", target: variable.ref, name: variable.name };

    if (commandId === "toggleVariable") {
        return { ...block, payload: { ...payload, expression: { source: `!${variable.name}`, ast: { kind: "unary", op: "!", operand: self } } } };
    }
    if (commandId === "resetVariable") {
        // Resetting is an assignment of the declared default, snapshotted here rather than resolved at
        // runtime: NLR has no "restore to default" action, and a row that silently changed meaning when
        // someone edited the declaration would be worse than one that says what it assigns.
        return { ...block, payload: { ...payload, value: variable.defaultValue ?? defaultForType(variable.valueType), expression: undefined } };
    }

    const op = commandId === "incrementVariable" ? "+" : "-";
    // `by` defaults to 1: `/inc gold` is the line this command exists for.
    const step: StoryExpr = args.by?.kind === "expression" ? args.by.expression.ast : { kind: "literal", value: 1 };
    const stepSource = args.by?.kind === "expression" ? args.by.source : "1";
    return {
        ...block,
        payload: { ...payload, expression: { source: `${variable.name} ${op} (${stepSource})`, ast: { kind: "binary", op, left: self, right: step } } },
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
        case "characterExit":
        case "characterExpression": {
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
            // characterId XOR speakerName - the row points at a record or carries a bare name, never both.
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
            const seconds = args.seconds;
            if (seconds?.kind === "keyword") {
                return { ...block, payload: { action: "wait", mode: "click" } };
            }
            if (seconds?.kind === "number") {
                return { ...block, payload: { action: "wait", mode: "duration", durationMs: storySecondsToMs(seconds.value) } };
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
            const fadeMs = asDurationMs(args.fade);
            if (fadeMs !== undefined) {
                payload.fadeMs = fadeMs;
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
            } else if (args.value?.kind === "expression") {
                return { ...block, payload: withAssignedExpression(payload, args.value.expression) };
            }
            return { ...block, payload };
        }

        case "incrementVariable":
        case "decrementVariable":
        case "toggleVariable":
        case "resetVariable":
            return applyAssignmentSugar(block, commandId, args);

        case "conditionIf":
            // The expression rides on the *branch*, which does not exist yet - `scaffoldContainer`
            // creates it right after this block is inserted, and reads the condition back off here.
            // Nothing to write onto the container itself.
            return block;

        case "choice": {
            if (block.kind !== "nodeAction" || block.payload.action !== "choice" || !block.payload.prompt) {
                return block;
            }
            if (args.text?.kind !== "text") {
                return block;
            }
            // Typed on one line, so the prompt is plain - drop any `rich` the placeholder carried.
            return { ...block, payload: { ...block.payload, prompt: { ...block.payload.prompt, value: args.text.value, rich: undefined } } };
        }

        case "repeat": {
            if (block.kind !== "control" || block.payload.control !== "repeat") {
                return block;
            }
            const times = asNumber(args.times);
            return times === undefined ? block : { ...block, payload: { ...block.payload, times } };
        }

        case "nvl": {
            if (block.kind !== "action" || block.payload.action !== "nvl") {
                return block;
            }
            // NVL's transition is a transform (preset), not a StoryTransitionRef - see the grammar note.
            const preset = asEnum(args.t) as StoryTransformRef["preset"] | undefined;
            const durationMs = asDurationMs(args.d);
            if (preset === undefined && durationMs === undefined) {
                return block;
            }
            const transition: StoryTransformRef = {
                ...(block.payload.transition ?? {}),
                ...(preset !== undefined ? { preset } : {}),
                ...(durationMs !== undefined ? { durationMs } : {}),
            };
            return { ...block, payload: { ...block.payload, transition } };
        }

        case "imageCreate":
        case "imageSetSource":
        case "imageShow":
        case "imageHide": {
            if (block.kind !== "action" || block.payload.action !== "image") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            if (args.image?.kind === "asset") {
                payload.assetId = args.image.assetId;
            }
            // Images animate through `transform` - placement on create (`at=`), reveal on show/hide (`t=`).
            const transform = withStageTransform(payload.transform, args);
            return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
        }

        case "textCreate":
        case "textSet":
        case "textShow":
        case "textHide": {
            if (block.kind !== "action" || block.payload.action !== "text") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            if (args.content?.kind === "text") {
                payload.text = args.content.value;
            }
            const transform = withStageTransform(payload.transform, args);
            return { ...block, payload: { ...payload, ...(transform ? { transform } : {}) } };
        }

        case "textFont": {
            if (block.kind !== "action" || block.payload.action !== "text") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            // One block runs one op: a size sets the size, otherwise a colour sets the colour.
            const size = asNumber(args.size);
            const color = asColor(args.color);
            if (size !== undefined) {
                payload.operation = "setFontSize";
                payload.fontSize = size;
            } else if (color !== undefined) {
                payload.operation = "setFontColor";
                payload.fontColor = color;
            }
            return { ...block, payload };
        }

        case "layerCreate": {
            if (block.kind !== "action" || block.payload.action !== "layer") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            const zIndex = asNumber(args.z);
            if (zIndex !== undefined) {
                payload.zIndex = zIndex;
            }
            return { ...block, payload };
        }

        case "videoCreate":
        case "videoShow":
        case "videoHide":
        case "videoPlay": {
            if (block.kind !== "action" || block.payload.action !== "video") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            if (args.video?.kind === "asset") {
                payload.assetId = args.video.assetId;
            }
            const muted = asBoolean(args.muted);
            if (muted !== undefined) {
                payload.muted = muted;
            }
            return { ...block, payload };
        }

        case "screenBlink":
        case "screenVignette": {
            if (block.kind !== "action" || block.payload.action !== "screenEffect") {
                return block;
            }
            const payload = { ...block.payload };
            const durationMs = asDurationMs(args.d);
            if (durationMs !== undefined) {
                payload.durationMs = durationMs;
            }
            const holdMs = asDurationMs(args.hold);
            if (holdMs !== undefined) {
                payload.holdMs = holdMs;
            }
            const color = asColor(args.color);
            if (color !== undefined) {
                payload.color = color;
            }
            const opacity = asNumber(args.opacity);
            if (opacity !== undefined) {
                payload.opacity = opacity;
            }
            return { ...block, payload };
        }

        case "stopSound":
        case "pauseSound":
        case "resumeSound":
        case "soundVolume":
        case "soundRate":
        case "muteSound": {
            if (block.kind !== "action" || block.payload.action !== "audio") {
                return block;
            }
            const payload = { ...block.payload };
            const name = asObjectName(args.name);
            if (name !== undefined) {
                payload.objectName = name;
            }
            const volume = asNumber(args.volume);
            if (volume !== undefined) {
                payload.volume = volume;
            }
            const rate = asNumber(args.rate);
            if (rate !== undefined) {
                payload.rate = rate;
            }
            const fadeMs = asDurationMs(args.fade);
            if (fadeMs !== undefined) {
                payload.fadeMs = fadeMs;
            }
            const muted = asEnum(args.muted);
            if (muted !== undefined) {
                payload.muted = muted === "on";
            }
            return { ...block, payload };
        }

        default:
            // Every other command is menu-only for now: it has no grammar, so it has no args to write.
            return block;
    }
}
