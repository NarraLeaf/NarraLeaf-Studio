import type { StoryBlock } from "@shared/types/story";
import { storySecondsToMs } from "@shared/utils/storyTime";
import type { StoryCommandParam, StoryCommandParamType } from "../storyCommandGrammar";
import type {
    StoryCommandContext,
    StoryCommandResolutionIssue,
    StoryCommandSpan,
    StoryCommandValue,
} from "../storyCommandValues";
import type { ActionCommandGroupCategoryId } from "../storyActionCommands";

/**
 * The single source of truth for one slash command.
 *
 * A command used to be smeared across four unlinked files - an id union member, a palette entry, a
 * grammar def, a `createBlockForCommand` case and an `applyCommandArgs` case - connected only by
 * strings, so renaming a grammar param silently disconnected the apply case that read it. A spec
 * carries all of it in one object, and `ResolvedArgsOf` closes the loop at the type level: `build`
 * receives an args object keyed by this spec's own param names, so a drifted name is a compile error,
 * not a value that resolves and is never written.
 *
 * The pure pipeline layers (parser / cursor / ghost / candidates / resolution) stay generic and read
 * only the grammar-shaped projection (`specToDef`); everything command-specific lives here.
 */

/** A param as authored on a spec: the grammar param minus `name`, which the record key supplies. */
export type StoryCommandParamSpec = Omit<StoryCommandParam, "name">;

/** Params are an ordered record - key order is declaration order, and positionals must lead. */
export type StoryCommandParamsShape = Readonly<Record<string, StoryCommandParamSpec>>;

/**
 * The resolved-args object a spec's `build`/`validate` receive: same keys as the spec's params, each
 * possibly undefined (an unfilled arg is not an error - see the bible's B9 for what "core" gates).
 */
export type ResolvedArgsOf<P extends StoryCommandParamsShape> = {
    readonly [K in keyof P]?: StoryCommandValue;
};

export type StoryCommandBuildContext = {
    generateId: () => string;
    /** The rest of the line for text-bearing blocks created without their text arg. */
    initialText?: string;
    context: StoryCommandContext;
};

/** Validation helpers handed to a spec's `validate` - spans come from the parsed line, not the spec. */
export type StoryCommandValidateContext = {
    context: StoryCommandContext;
    /** The source span of a param's value, for anchoring an issue. Undefined while unfilled. */
    spanOf: (paramName: string) => StoryCommandSpan | undefined;
};

export type StoryCommandSpec<P extends StoryCommandParamsShape = StoryCommandParamsShape> = {
    /** Stable identity: keys `story.command.<id>.label` / `.detail` and telemetry. Never shown raw. */
    id: string;
    /** The canonical keyword. English, never translated (bible B11). */
    token: string;
    aliases?: readonly string[];
    category: ActionCommandGroupCategoryId;
    params: P;
    /**
     * Build the finished block from the resolved args - declarations included, since v6 made a
     * declaration a row like any other.
     *
     * Receives every arg possibly-undefined and must return a valid block regardless - the menu path
     * calls it with `{}` to get the default block, and the bible's core gating (not this function)
     * is what decides whether an unfilled line commits.
     */
    build?: (args: ResolvedArgsOf<P>, ctx: StoryCommandBuildContext) => StoryBlock;
    /** Cross-param checks the generic resolver cannot know (`/font` size XOR color, `/set` type fit). */
    validate?: (args: ResolvedArgsOf<P>, ctx: StoryCommandValidateContext) => StoryCommandResolutionIssue[];
    /**
     * Fill args the author left blank, after resolution - the auto-name pass that lets
     * `/image forest.png` land an image called `forest`. Returns only the keys it adds.
     */
    deriveArgs?: (args: ResolvedArgsOf<P>, context: StoryCommandContext) => Partial<Record<keyof P & string, StoryCommandValue>>;
    /** Open the property inspector right after commit - for commands whose surface is inspector-first (`/fx`). */
    inspectorAfterCommit?: boolean;
    /**
     * Container scaffolding the controller runs after insert: `condition` creates the if-branch
     * (carrying this line's `test` expression), `choice` creates the first option.
     */
    scaffold?: "condition" | "choice";
    /**
     * The high-frequency param keys surfaced as inline quick-edit tokens on a committed row (WI-2) —
     * the bible's B10 "inline high-frequency" half. A subset of `params`. There is no block→args
     * parser, so the row's render path (`getQuickParams`) reads these values straight from the payload;
     * this declaration keeps the intended set discoverable in one place alongside the rest of the spec.
     */
    quickParams?: readonly (keyof P & string)[];
};

/**
 * Declare a spec. The identity function exists for inference (P is captured from the literal) plus
 * the one structural rule a record cannot express: at most one param is greedy and it comes last -
 * it consumes the rest of the line, so nothing can follow it. Positionals fill in declaration order
 * among themselves; named params may sit anywhere in the record (declaration order is also the ghost
 * hint's order, so put them where an author would type them).
 */
export function defineStoryCommand<P extends StoryCommandParamsShape>(spec: StoryCommandSpec<P>): StoryCommandSpec<P> {
    let sawGreedy = false;
    for (const [name, param] of Object.entries(spec.params)) {
        if (sawGreedy) {
            throw new Error(`/${spec.token}: param "${name}" follows a greedy param; greedy must be last.`);
        }
        sawGreedy = param.greedy === true;
    }
    return spec;
}

// ---------------------------------------------------------------------------
// Value coercers - how `build` reads a StoryCommandValue without re-proving its kind everywhere.
// ---------------------------------------------------------------------------

export function asNumber(value: StoryCommandValue | undefined): number | undefined {
    return value?.kind === "number" ? value.value : undefined;
}

/** Durations are typed in seconds and stored in milliseconds - `d=0.3` means 300ms. */
export function asDurationMs(value: StoryCommandValue | undefined): number | undefined {
    const seconds = asNumber(value);
    return seconds === undefined ? undefined : storySecondsToMs(seconds);
}

export function asBoolean(value: StoryCommandValue | undefined): boolean | undefined {
    return value?.kind === "boolean" ? value.value : undefined;
}

export function asEnum(value: StoryCommandValue | undefined): string | undefined {
    return value?.kind === "enum" ? value.value : undefined;
}

export function asColor(value: StoryCommandValue | undefined): string | undefined {
    return value?.kind === "color" ? value.color : undefined;
}

/** A free-typed name (`text` value), trimmed. Empty means "leave the block's default". */
export function asText(value: StoryCommandValue | undefined): string | undefined {
    if (value?.kind !== "text") {
        return undefined;
    }
    const trimmed = value.value.trim();
    return trimmed === "" ? undefined : trimmed;
}

/** The resolved target of a generic verb (`/show poster`), or undefined while unresolved. */
export function asTarget(value: StoryCommandValue | undefined): Extract<StoryCommandValue, { kind: "target" }>["target"] | undefined {
    return value?.kind === "target" ? value.target : undefined;
}

// ---------------------------------------------------------------------------
// Shared param fragments - the vocabulary table of the bible (§1.2). One key, one meaning.
// ---------------------------------------------------------------------------

/** `d=` - a duration in seconds. */
export function secondsParam(hint = "duration"): StoryCommandParamSpec {
    return { aliases: ["duration"], hint, type: { kind: "number", min: 0 } };
}

/** `at=` - a placement. */
export function placementParam(): StoryCommandParamSpec {
    return {
        aliases: ["pos"],
        hint: "placement",
        type: { kind: "enum", options: [{ value: "left" }, { value: "center" }, { value: "right" }] },
    };
}

/** A positional reference to something already on stage, or a character - the generic verbs' subject. */
export function targetParam(
    accepts: readonly ("character" | "image" | "text" | "layer" | "video" | "audio")[],
    options?: { core?: boolean; skippable?: boolean },
): StoryCommandParamSpec {
    return {
        hint: "target",
        type: { kind: "target", accepts },
        positional: true,
        ...(options?.core ? { core: true } : {}),
        ...(options?.skippable ? { skippable: true } : {}),
    };
}

export type { StoryCommandParamType };
