import { Gamepad2, Lock, Timer, Vibrate, Zap } from "lucide-react";
import {
    STORY_RUMBLE_PRESET_IDS,
    type StoryBlock,
    type StoryInputActionPayload,
    type StoryInputWaitFields,
    type StoryRumblePresetId,
} from "@shared/types/story";
import type { StoryCommandResolutionIssue, StoryCommandValue } from "../../storyCommandValues";
import {
    asBoolean,
    asDurationMs,
    asEnum,
    asNumber,
    defineStoryCommand,
    SECONDS_TYPE,
    secondsParam,
    type StoryCommandParamSpec,
    type StoryCommandValidateContext,
} from "../spec";

/**
 * The player's hands: `/rumble`, `/input`, `/waitinput`, `/hold`, `/mash`.
 *
 * All five build the one `input` payload arm (see `@shared/types/story/input`), told apart by its
 * operation - the same shape `/camera` has, and for the same reason: they address one subject, and the
 * compiler hands every one of them to the same host.
 *
 * # Why the waiting commands name an ACTION
 *
 * `/waitinput Confirm` waits for the project's "Confirm" action, not for a key. The action is where
 * the keyboard, the mouse, a touch and a pad already meet - the author bound them once, in the input
 * settings - so a row that names it is answered by whatever the player is holding. A row that named
 * Space would be a QTE nobody with a pad could pass.
 *
 * # Deadlines and results
 *
 * `timeout=` and `into=` are the pair that makes a wait a test: give the player a few seconds, and
 * write whether they made it into a boolean variable the next `/if` reads. Either works alone - a
 * deadline with nowhere to write simply moves on, and a result with no deadline is always `true` -
 * which is why neither is required.
 */

/** `stop` last: it is the one that does the opposite of everything above it. */
const RUMBLE_CHOICES = [...STORY_RUMBLE_PRESET_IDS, "stop"] as const;

function inputBlock(generateId: () => string, payload: StoryInputActionPayload): StoryBlock {
    return { id: generateId(), parentId: null, childrenIds: [], kind: "action", payload };
}

/** The action slot every waiting command leads with. Skippable, so `/hold 2` means "any action". */
function actionParam(skippable: boolean): StoryCommandParamSpec {
    return {
        hint: "inputAction",
        type: { kind: "inputAction" },
        positional: true,
        ...(skippable ? { skippable: true } : {}),
    };
}

/** `timeout=` - give up after this many seconds. */
function timeoutParam(): StoryCommandParamSpec {
    return { aliases: ["limit"], hint: "inputTimeout", type: SECONDS_TYPE };
}

/** `into=` - the boolean variable the outcome is written into. */
function resultParam(): StoryCommandParamSpec {
    return { aliases: ["result"], hint: "inputResult", type: { kind: "variable" } };
}

/** The fields the three waiting commands share, read off their args. */
function waitFields(args: {
    readonly action?: StoryCommandValue;
    readonly timeout?: StoryCommandValue;
    readonly into?: StoryCommandValue;
}): StoryInputWaitFields {
    const timeoutMs = asDurationMs(args.timeout);
    return {
        ...(args.action?.kind === "inputAction" ? { actionId: args.action.actionId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(args.into?.kind === "variable" ? { resultTarget: args.into.ref } : {}),
    };
}

/**
 * `into=` has to be a boolean: the row writes `true` or `false` and nothing else, so a number or a
 * text variable would be handed a value its own declaration forbids. Reported with the assignment
 * wording `/set` uses, since it is the same mistake.
 */
function validateResult(
    args: { readonly into?: StoryCommandValue },
    ctx: StoryCommandValidateContext,
): StoryCommandResolutionIssue[] {
    const target = args.into;
    if (target?.kind !== "variable" || target.valueType === "boolean") {
        return [];
    }
    const span = ctx.spanOf("into");
    return span
        ? [{
            code: "expressionTypeMismatch",
            span,
            value: target.name,
            variable: target.name,
            expected: target.valueType,
            received: "boolean",
        }]
        : [];
}

/**
 * `/rumble` - shake the player's pad.
 *
 * `left` and `right` are the two motors, named for the hand that feels them rather than as
 * strong/weak: nobody holds a pad thinking about which motor is which, and "a heavy thud with a thin
 * buzz over it" is already the pair. A preset supplies the numbers the row does not state;
 * `custom` uses only the row's own, so a motor it does not mention is off.
 *
 * `stop` is a value of the same slot rather than a command of its own: starting and stopping are one
 * subject, and two tokens would file them under two names in the same menu.
 *
 * Nothing happens, silently, where there is nothing to shake - no pad, a browser with no haptics, a
 * pad that is not standard-mapping. The author did nothing wrong by writing the row, and a warning on
 * every desktop playthrough would be noise about hardware rather than about the story.
 */
export const rumble = defineStoryCommand({
    id: "rumble",
    token: "rumble",
    aliases: ["vibrate"],
    // 场景, beside `/blink` and `/vignette`: feedback about the moment on screen, not a thing on stage.
    category: "scene",
    icon: Vibrate,
    examples: ["/rumble", "/rumble impact", "/rumble custom left=1 right=0.3 d=0.4", "/rumble quake wait", "/rumble stop"],
    quickParams: ["d"],
    params: {
        preset: {
            hint: "rumblePreset",
            type: { kind: "enum", options: RUMBLE_CHOICES.map(value => ({ value })) },
            positional: true,
        },
        left: { hint: "rumbleLeft", type: { kind: "number", min: 0, max: 1 } },
        right: { hint: "rumbleRight", type: { kind: "number", min: 0, max: 1 } },
        d: secondsParam(),
        wait: { hint: "rumbleWait", type: { kind: "boolean" } },
    },
    build(args, ctx): StoryBlock {
        const preset = asEnum(args.preset);
        if (preset === "stop") {
            // Carries nothing else: a row that said `stop` and gave a duration would be two
            // instructions wearing one name.
            return inputBlock(ctx.generateId, { action: "input", operation: "stopRumble" });
        }
        const left = asNumber(args.left);
        const right = asNumber(args.right);
        const durationMs = asDurationMs(args.d);
        const wait = asBoolean(args.wait);
        return inputBlock(ctx.generateId, {
            action: "input",
            operation: "rumble",
            // Absent means 脉冲 at compile time; only a preset the author named is written down, so a
            // bare `/rumble` reads back as a bare `/rumble`.
            ...(preset ? { preset: preset as StoryRumblePresetId } : {}),
            ...(left !== undefined ? { strongMagnitude: left } : {}),
            ...(right !== undefined ? { weakMagnitude: right } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(wait ? { wait: true } : {}),
        });
    },
});

/**
 * `/input lock` / `/input unlock` - take the story out of the player's hands for a passage.
 *
 * While locked, a click, the advance key, auto-forward and skipping all do nothing; rows that do not
 * wait for the player go on playing. That is a cutscene: transitions, motion and sound the player
 * cannot click through. A dialogue line inside one waits for an advance nobody can give, so the
 * passage has to end in `/input unlock` before the next line - which is what the detail text tells the
 * author, because no row can tell a cutscene that forgot to unlock from one that is not over yet.
 *
 * Two words of one slot rather than `/lock` and `/unlock`: one subject, one place in the menu.
 */
export const input = defineStoryCommand({
    id: "input",
    token: "input",
    category: "flow",
    icon: Lock,
    examples: ["/input lock", "/input unlock"],
    params: {
        state: {
            hint: "inputLock",
            type: { kind: "enum", options: [{ value: "lock" }, { value: "unlock" }] },
            positional: true,
            core: true,
        },
    },
    build(args, ctx): StoryBlock {
        return inputBlock(ctx.generateId, {
            action: "input",
            // The menu builds this with no args; a lock is what the command is for.
            operation: asEnum(args.state) === "unlock" ? "unlock" : "lock",
        });
    },
});

/**
 * `/waitinput [action]` - hold the story until the player performs an action.
 *
 * With no action named, any of the project's actions answers. It is `/wait click` grown up: the
 * gesture is the author's, it reaches every device the action is bound on, and it can fail.
 */
export const waitInput = defineStoryCommand({
    id: "waitInput",
    token: "waitinput",
    aliases: ["waitaction"],
    category: "flow",
    icon: Gamepad2,
    examples: ["/waitinput", "/waitinput Confirm", "/waitinput Confirm timeout=2 into=met"],
    quickParams: ["timeout"],
    params: {
        action: actionParam(false),
        timeout: timeoutParam(),
        into: resultParam(),
    },
    build(args, ctx): StoryBlock {
        return inputBlock(ctx.generateId, { action: "input", operation: "wait", ...waitFields(args) });
    },
    validate: validateResult,
});

/**
 * `/hold [action] <seconds>` - hold the story until the player keeps an action down that long.
 *
 * Letting go early does not fail the row; the count starts over on the next press. Only the deadline
 * fails it, which is what makes "hold to resist" readable as a test of nerve rather than of timing.
 */
export const hold = defineStoryCommand({
    id: "hold",
    token: "hold",
    aliases: ["longpress"],
    category: "flow",
    icon: Timer,
    examples: ["/hold 1.5", "/hold Confirm 2", "/hold Confirm 2 timeout=5 into=met"],
    quickParams: ["seconds"],
    params: {
        action: actionParam(true),
        seconds: { hint: "holdDuration", type: SECONDS_TYPE, positional: true, core: true },
        timeout: timeoutParam(),
        into: resultParam(),
    },
    build(args, ctx): StoryBlock {
        return inputBlock(ctx.generateId, {
            action: "input",
            operation: "hold",
            // The menu path builds with no args; a second is a hold anyone can feel.
            holdMs: asDurationMs(args.seconds) ?? 1000,
            ...waitFields(args),
        });
    },
    validate: validateResult,
});

/**
 * `/mash [action] <count>` - hold the story until the player presses an action that many times.
 *
 * Without a deadline it is a count, not a test; the deadline is what makes it a struggle, which is why
 * every example carries one.
 */
export const mash = defineStoryCommand({
    id: "mash",
    token: "mash",
    aliases: ["rapid"],
    category: "flow",
    icon: Zap,
    examples: ["/mash 10 timeout=3", "/mash Confirm 15 timeout=4 into=met"],
    quickParams: ["count"],
    params: {
        action: actionParam(true),
        count: { hint: "mashCount", type: { kind: "number", min: 1, integer: true }, positional: true, core: true },
        timeout: timeoutParam(),
        into: resultParam(),
    },
    build(args, ctx): StoryBlock {
        return inputBlock(ctx.generateId, {
            action: "input",
            operation: "mash",
            count: Math.max(1, Math.round(asNumber(args.count) ?? 10)),
            ...waitFields(args),
        });
    },
    validate: validateResult,
});

export const INPUT_COMMANDS = [rumble, input, waitInput, hold, mash];
