import { Move3d, RotateCcw } from "lucide-react";
import type { StoryActionPayload, StoryBlock, StoryTransformProps, StoryTransformRef } from "@shared/types/story";
import { composeStoryFilter, pruneStoryTransformProps } from "@shared/story/transformProps";
import { resolveStoryCameraLook, storyCameraLookTweens } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { createBlockForCommand } from "../../storyActionCommands";
import type { StoryCommandResolutionIssue, StoryCommandTargetValue, StoryCommandValue } from "../../storyCommandValues";
import { STORY_RESERVED_TARGETS } from "../../storyCommandValues";
import {
    asBoolean,
    asDurationMs,
    asTarget,
    defineStoryCommand,
    secondsParam,
    targetParam,
    type StoryCommandValidateContext,
} from "../spec";
import { displayableTargetRef } from "../payloadHelpers";
import { resetVariableBlock } from "./variables";
import {
    filterWritersOf,
    parseFromProps,
    parsePositionValue,
    CAMERA_ONLY_PROP_KEYS,
    RESET_CHANNEL_KEYS,
    RESET_PROP_PARAMS,
    resetPropsFromArgs,
    TRANSFORM_PROP_KEYS,
    TRANSFORM_PROP_PARAMS,
    TRANSFORM_TIMING_PARAMS,
    transformPropsFromArgs,
    transformTimingFromArgs,
    type TransformArgs,
} from "../transformVocabulary";

/**
 * `/transform` and `/reset` - the only two verbs that write a displayable's prop bag.
 *
 * **The axiom.** One prop bag, one interpolation. A command differs from another only in what it
 * ADDRESSES and how its values are SPELLED - never in what it can reach. Everything that used to be a
 * verb of its own here (`/fx`, `/mirror`, `/move`, `/camera`) said "object type × operation", which is
 * the taxonomy the command language has been deleting command by command: `mask` was never an
 * operation, it was one prop of the one bag with a payload field and a switch arm of its own, which
 * is exactly why no row could ever dim AND blur.
 *
 * So the vocabulary is the bag (`../transformVocabulary.ts`), and these two specs are thin: one
 * writes props, the other clears them, and both reach every channel on every subject.
 *
 * ## What is NOT here, and why
 *
 * A **transition** is not a transform. `/bg`, `/jump` and `/face` keep their `t=`, because those
 * really do write a `StoryTransitionRef` - a whole-screen change with a named engine effect. What
 * `/show t=` used to write was a transform wearing the word "transition", and that one has been
 * renamed to `in=` / `out=` rather than folded in here: an entrance is a transform *with a
 * direction*, and the direction is what the verb already says.
 *
 * The **screen effects** used to be a command of their own, on the reasoning that a blink is two
 * eyelid overlays running their own timelines and one-object-at-a-time cannot express that. They are
 * here now, and the reasoning was the answer rather than the objection: the eyelids belong to the
 * CAMERA's lens, so `lens=` is a prop of the one bag like every other channel.
 */

/** Every kind that has a transform pipeline, and the reserved words that name the stage singletons. */
const TRANSFORM_ACCEPTS = ["image", "text", "layer", "character"] as const;

/**
 * Resolved so it can be refused, not left out so it can be missed.
 *
 * A `Video` and a `Vfx` are engine `Actionable`s, not Displayables: `StoryDisplayableTargetKind`
 * excludes both, and the compiler has no path that would give either a `Transform`. But they ARE on
 * stage with names an author can see, so leaving them out of the slot entirely would answer
 * `/transform petals` with "nothing on stage is named petals" - a lie about a thing sitting in plain
 * sight. Listing them here resolves the name and says what it found.
 */
const TRANSFORM_REFUSES = ["video", "vfx"] as const;

type TransformSubject =
    | { kind: "camera" }
    | { kind: "displayable"; target: StoryCommandTargetValue }
    | { kind: "none" };

function subjectOf(value: StoryCommandValue | undefined): TransformSubject {
    const target = asTarget(value);
    if (!target) {
        return { kind: "none" };
    }
    if (target.type === "reserved" && target.name === "camera") {
        return { kind: "camera" };
    }
    return { kind: "displayable", target };
}

/** The word an `unsupportedParam` names the subject by - what the author sees in the report. */
function subjectWord(subject: TransformSubject, target: StoryCommandTargetValue | undefined): string {
    if (subject.kind === "camera") {
        return "camera";
    }
    if (!target) {
        return "target";
    }
    return target.type === "character" ? "character" : target.type === "reserved" ? "layer" : target.objectKind;
}

// ---------------------------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------------------------

/**
 * A camera move with no stated duration is a MOVE, not a cut.
 *
 * The house number the retired `/camera` used, kept because the compile reads a missing duration as
 * zero: without it `/transform camera zoom=2` would snap, which is the one thing a camera almost
 * never does. A displayable has no equivalent default - its `createBlockForCommand` seed carries one.
 */
const CAMERA_DEFAULT_DURATION_MS = 600;

/**
 * A camera row.
 *
 * **There is nothing left to classify.** This function used to walk a table deciding which single
 * channel the line had named and which of six operations that channel became, and to report a row
 * naming two of them as a conflict - because the payload could hold exactly one. Since v19 the camera
 * carries the same {@link StoryTransformRef} every other subject does, so the line's bag IS the row
 * and every prop in the vocabulary reaches the camera the way it reaches a sprite.
 */
function cameraBlock(args: TransformArgs, generateId: () => string): StoryBlock {
    const block = (payload: Extract<StoryActionPayload, { action: "camera" }>): StoryBlock => ({
        id: generateId(),
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload,
    });
    if (asBoolean(args.motion)) {
        // The shot itself is a binding no line can name, so the row states the mode and the inspector
        // does the picking - exactly what `/camera motion` did.
        return block({ action: "camera", operation: "transform", transform: { mode: "animation" } });
    }
    const props = pruneStoryTransformProps(transformPropsFromArgs(args));
    const transform: StoryTransformRef = {
        ...transformTimingFromArgs(args),
        durationMs: asDurationMs(args.d) ?? CAMERA_DEFAULT_DURATION_MS,
        ...(props ? { to: props } : {}),
    };
    return block({ action: "camera", operation: "transform", transform });
}

// ---------------------------------------------------------------------------------------------
// `/transform`
// ---------------------------------------------------------------------------------------------// ---------------------------------------------------------------------------------------------
// `/transform`
// ---------------------------------------------------------------------------------------------

function displayableBlock(
    target: StoryCommandTargetValue | undefined,
    transform: StoryTransformRef,
    generateId: () => string,
): StoryBlock {
    const block = createBlockForCommand("displayableTransform", generateId);
    if (block.kind !== "action" || block.payload.action !== "displayable") {
        return block;
    }
    const payload = { ...block.payload };
    const ref = displayableTargetRef(target);
    if (ref) {
        payload.target = ref;
    }
    // The seeded block carries a placement, and a row that only dimmed a sprite must not also move it
    // to centre - so the bag is REPLACED by what the line states rather than merged into the default.
    payload.transform = transform;
    return { ...block, payload };
}

/** The issues a prop row raises that no generic check could: which channel, on which subject. */
function validateProps(
    args: TransformArgs,
    ctx: StoryCommandValidateContext,
    options: { reset: boolean },
): StoryCommandResolutionIssue[] {
    const issues: StoryCommandResolutionIssue[] = [];
    const subject = subjectOf(args.target);
    const target = asTarget(args.target);
    const kind = subjectWord(subject, target);

    // Three keys write the one CSS `filter` channel. Reported rather than resolved, the way `/font`
    // refuses a size and a colour: two writers of one channel means whichever the emitter reads last
    // wins, silently, and neither of them is wrong on its own.
    const writers = filterWritersOf(args);
    if (writers.length > 1) {
        const key = writers.includes("raw") ? "filter" : "look";
        const span = ctx.spanOf(key);
        if (span) {
            issues.push({ code: "conflictingParams", span, keys: ["filter", "look", "blur…"].filter((_, index) => index < writers.length) });
        }
    }

    // A position that is neither a placement word nor an align pair. The grammar cannot check it -
    // the pair has no closed value set - so the spec is the only place it can be said.
    const posSpan = ctx.spanOf("pos");
    if (posSpan && args.pos !== undefined && parsePositionValue(args.pos.kind === "text" ? args.pos.value : undefined) === null && args.pos.kind === "text") {
        issues.push({ code: "unsupportedOption", span: posSpan, value: args.pos.value, allowed: ["left", "center", "right", "x,y"] });
    }

    // A Story Motion is a whole keyframed shot with its own timing; a prop bag is a destination with
    // one. A row carrying both says two different things about the same move.
    if (args.motion !== undefined && TRANSFORM_PROP_KEYS.some(key => args[key] !== undefined)) {
        const span = ctx.spanOf("motion");
        if (span) {
            issues.push({ code: "conflictingParams", span, keys: ["motion", "props"] });
        }
    }

    // `from=` is re-parsed rather than resolved (see `parseFromProps`), so its own bad keys have
    // nowhere else to be reported.
    const fromSpan = ctx.spanOf("from");
    const from = args.from?.kind === "text" ? parseFromProps(args.from.value) : null;
    if (fromSpan && from && from.badKeys.length > 0) {
        issues.push({
            code: "unsupportedOption",
            span: fromSpan,
            value: from.badKeys[0],
            allowed: ["pos", "zoom", "scale", "rot", "opacity", "blur", "bright", "gray", "sat", "sepia", "hue", "invert"],
        });
    }

    // The lens is the CAMERA's own glass: the engine renders `shutter` and `vignette` from an overlay
    // that belongs to the camera, and no other Displayable has one. On a sprite these would write
    // props the stage never reads, which is the silent failure this layer exists to refuse.
    if (subject.kind !== "camera") {
        for (const key of CAMERA_ONLY_PROP_KEYS) {
            const span = args[key] === undefined ? undefined : ctx.spanOf(key);
            if (span) {
                issues.push({ code: "unsupportedParam", span, key, kind });
            }
        }
    }

    // `color=` IS `fontColor`, the one channel of the bag that belongs to a single kind of
    // displayable. Everything else in the vocabulary reaches every subject - including the camera,
    // which since v19 is simply another one, and which has no text to colour either.
    const colorSpan = ctx.spanOf("color");
    const colorless = subject.kind === "camera" || (target !== undefined && !(target.type === "stageObject" && target.objectKind === "text"));
    if (!options.reset && colorSpan && args.color !== undefined && colorless) {
        issues.push({ code: "unsupportedParam", span: colorSpan, key: "color", kind });
    }
    return issues;
}

export const transform = defineStoryCommand({
    id: "transform",
    token: "transform",
    aliases: ["displayabletransform"],
    // Only the flat surfaces read this; the sidebar files `/transform` under every subject its target
    // param accepts, which since M2 includes the camera.
    category: "image",
    icon: Move3d,
    examples: [
        "/transform hero pos=left d=0.4",
        "/transform hero blur=4 gray=1",
        "/transform Alice flip=on",
        "/transform camera zoom=1.6 d=0.8",
        "/transform camera look=moonlight",
    ],
    quickParams: ["d"],
    params: {
        target: targetParam([...TRANSFORM_ACCEPTS], {
            core: true,
            reserved: [...STORY_RESERVED_TARGETS],
            refuses: [...TRANSFORM_REFUSES],
        }),
        ...TRANSFORM_PROP_PARAMS,
        ...TRANSFORM_TIMING_PARAMS,
    },
    build(args, ctx) {
        const subject = subjectOf(args.target);
        if (subject.kind === "camera") {
            return cameraBlock(args, ctx.generateId);
        }
        if (asBoolean(args.motion)) {
            return displayableBlock(asTarget(args.target), { mode: "animation" }, ctx.generateId);
        }
        const props = pruneStoryTransformProps(transformPropsFromArgs(args));
        const transformRef: StoryTransformRef = {
            ...transformTimingFromArgs(args),
            ...(props ? { to: props } : {}),
        };
        return displayableBlock(asTarget(args.target), transformRef, ctx.generateId);
    },
    validate: (args, ctx) => validateProps(args, ctx, { reset: false }),
    /**
     * Inspector-first only where the line could not finish the row.
     *
     * Two cases, and both are "the line says nothing yet". A Story Motion has picked no shot, and no
     * line can pick one - the asset is a binding. A bare `/transform hero` states no channel at all,
     * so it would commit a row that does nothing; opening on the inspector is what the retired `/fx`
     * did for exactly this line. Everything else is complete as typed and must NOT have the caret
     * yanked out of the row mid-flow.
     */
    inspectorAfterCommit: block => {
        if (block.kind !== "action") {
            return false;
        }
        if (block.payload.action === "camera") {
            return block.payload.transform?.mode === "animation";
        }
        if (block.payload.action !== "displayable") {
            return false;
        }
        const ref = block.payload.transform;
        return ref?.mode === "animation" || !ref || Object.keys(ref).length === 0;
    },
});

// ---------------------------------------------------------------------------------------------
// `/reset`
// ---------------------------------------------------------------------------------------------

/**
 * `/reset` - put this back the way it was.
 *
 * **Two subjects, one verb.** A variable's `/reset` and a displayable's are the same sentence with a
 * different subject - "restore what this was declared / drawn as" - so they are one command, the way
 * `/show` is one command across six payloads. The slot is a union and the build dispatches on what the
 * name turned out to be, which is the generic-verb rule this language has followed since B3: the
 * target says what is being reset and the token never does.
 *
 * The target branch is tried FIRST, so a stage object wins a name a variable also holds; `validate`
 * reports that collision rather than letting it decide silently. The order is the common case, not a
 * preference: a scene has far more rows resetting a sprite's look than restoring a variable.
 *
 * **No props means all of them.** `/reset hero` is the sentence an author writes to undo everything,
 * and a reset that quietly did nothing because no channel was named would be the most surprising row
 * in the language. Named props reset only those - this is what `clearMask` / `clearClip` /
 * `clearFilter` were, and it is why v18 made the appearance channels nullable.
 */
export const reset = defineStoryCommand({
    id: "reset",
    token: "reset",
    aliases: ["clear"],
    category: "data",
    icon: RotateCcw,
    examples: ["/reset hero", "/reset hero mask filter", "/reset camera d=0.5", "/reset gold"],
    quickParams: ["d"],
    params: {
        target: {
            ...targetParam([...TRANSFORM_ACCEPTS], {
                core: true,
                reserved: [...STORY_RESERVED_TARGETS],
                refuses: [...TRANSFORM_REFUSES],
            }),
            type: [
                { kind: "target", accepts: [...TRANSFORM_ACCEPTS], reserved: [...STORY_RESERVED_TARGETS], refuses: [...TRANSFORM_REFUSES] },
                { kind: "variable" },
            ],
        },
        // Bare flags, so `/reset hero mask filter` is two KEYS rather than two words the parser would
        // have to guess at - the same shape `/bgm battle loop` already has.
        ...RESET_PROP_PARAMS,
        d: secondsParam(),
    },
    build(args, ctx) {
        if (args.target?.kind === "variable") {
            return resetVariableBlock(ctx.generateId, args.target);
        }
        const subject = subjectOf(args.target);
        const durationMs = asDurationMs(args.d);
        if (subject.kind === "camera") {
            // One reset and no per-channel clear, because `resetCamera` is a single engine call rather
            // than a bag of neutral values - see the payload arm's own note for why that survived the
            // fold. A named flag would ask for a clear the call cannot express.
            return {
                id: ctx.generateId(),
                parentId: null,
                childrenIds: [],
                kind: "action",
                payload: { action: "camera", operation: "reset", ...(durationMs !== undefined ? { durationMs } : {}) },
            };
        }
        const props: StoryTransformProps = resetPropsFromArgs(args);
        return displayableBlock(
            asTarget(args.target),
            { to: props, ...(durationMs !== undefined ? { durationMs } : {}) },
            ctx.generateId,
        );
    },
    validate(args, ctx) {
        const issues = validateProps(args, ctx, { reset: true });
        // The union resolves the stage first, so a name held by BOTH would silently reset the sprite
        // and leave the variable alone. Reported here for the same reason `resolveTarget` reports two
        // stage objects sharing a name: the line does not say which one it means.
        const target = asTarget(args.target);
        const span = ctx.spanOf("target");
        if (span && target && ctx.context.variables.some(entry => entry.name.trim().toLowerCase() === target.name.toLowerCase())) {
            issues.push({ code: "ambiguousName", span, value: target.name });
        }
        if (args.target?.kind === "variable" || subjectOf(args.target).kind !== "camera") {
            return issues;
        }
        // Naming a channel on the camera would ask for a clear `resetCamera` cannot express, and a
        // flag that parsed and then did nothing is the failure this whole layer exists to avoid.
        for (const key of RESET_CHANNEL_KEYS) {
            const span = args[key] === undefined ? undefined : ctx.spanOf(key);
            if (span) {
                issues.push({ code: "unsupportedParam", span, key, kind: "camera" });
            }
        }
        return issues;
    },
});

export const TRANSFORM_COMMANDS = [transform, reset];
