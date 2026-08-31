import { AppWindow, Bookmark, CornerUpLeft, Flag, FlagTriangleRight, GitBranch, ListChecks, ListOrdered, LogOut, Repeat, Repeat2, Rows3, SeparatorHorizontal, Workflow } from "lucide-react";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import type { StoryBlock, StoryConditionRef } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import { appTagParam, asAppTagId, asNumber, asSurfaceId, asText, defineStoryCommand } from "../spec";

/**
 * Control flow: `/if`, `/menu`, the two loops (`/repeat`, `/until`), `/break`, `/cut`, and the
 * run-mode containers.
 */

export const ifCommand = defineStoryCommand({
    id: "if",
    token: "if",
    category: "flow",
    icon: GitBranch,
    examples: ["/if gold > 10", "/if met"],
    params: {
        test: { hint: "condition", type: { kind: "expression", expects: "boolean" }, positional: true, greedy: true, core: true },
    },
    // The expression rides on the *branch*, which does not exist yet - the controller's scaffolding
    // creates it right after insert and reads the resolved `test` off this line. Nothing to write
    // onto the container itself.
    build: (_args, ctx) => createBlockForCommand("condition", ctx.generateId),
    scaffold: "condition",
});

export const menu = defineStoryCommand({
    id: "menu",
    token: "menu",
    aliases: ["choice"],
    category: "flow",
    icon: ListChecks,
    examples: ["/menu Which way?"],
    params: {
        text: { hint: "content", type: { kind: "text" }, positional: true, greedy: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("choice", ctx.generateId);
        if (block.kind !== "nodeAction" || block.payload.action !== "choice" || !block.payload.prompt) {
            return block;
        }
        if (args.text?.kind !== "text") {
            return block;
        }
        // Typed on one line, so the prompt is plain - drop any `rich` the placeholder carried.
        return { ...block, payload: { ...block.payload, prompt: { ...block.payload.prompt, value: args.text.value, rich: undefined } } };
    },
    scaffold: "choice",
});

/**
 * `/repeat N` - the counted loop. The conditional one is {@link until}, a command of its own.
 *
 * Two commands rather than two forms of one, and the reason is the parser, not taste. `/repeat until
 * gold >= 10` cannot be made to work: `until` would have to be a positional that `times` yields to,
 * and the skippable rule (`strictlyMatches`, storyCommandParser.ts) only dispatches on CLOSED value
 * sets - enum, keyword, number, boolean, color - so an `expression` slot can never be strictly
 * matched and `times` swallows the keyword instead, reporting `badValue`. Widening that rule would
 * change how every command resolves a mismatched positional, to buy one line of syntax.
 *
 * The named `until=` below survives that as a second way in - same payload, reachable on a `/repeat`
 * line - but it needs quotes around a multi-token condition, so it is neither what the manual teaches
 * nor what a scene renders back to. Kept because it costs one param and removing it would break any
 * line already written with it.
 */
export const repeat = defineStoryCommand({
    id: "repeat",
    token: "repeat",
    aliases: ["loop"],
    category: "flow",
    icon: Repeat,
    examples: ["/repeat 3"],
    params: {
        // `times` is deliberately NOT `core` any more. Core is a per-param flag and cannot say "one
        // of these two", so leaving it on would have made `/repeat until=…` uncommittable - a line
        // the parser accepts, the resolver approves and Enter refuses, for a slot the author
        // deliberately did not fill. What core was buying is bought elsewhere: a bare `/repeat`
        // builds a two-pass loop whose count is printed on the row header with a stepper beside it,
        // so nothing about it is hidden or has to be guessed at.
        times: { hint: "times", type: { kind: "number", min: 1, integer: true }, positional: true },
        until: { hint: "condition", type: { kind: "expression", expects: "boolean" } },
    },
    // Not "prefer one" - a line naming both has two answers to when the loop stops and no rule can
    // pick the one the author meant, so it must not commit at all.
    validate(args, ctx) {
        if (args.times === undefined || args.until === undefined) {
            return [];
        }
        const span = ctx.spanOf("until") ?? ctx.spanOf("times");
        return span ? [{ code: "repeatTimesAndUntil", span }] : [];
    },
    build(args, ctx) {
        const block = createBlockForCommand("repeat", ctx.generateId);
        if (block.kind !== "control" || block.payload.control !== "repeat") {
            return block;
        }
        // `until` wins the `times` the default block carries, so a conditional loop never ships a
        // stale count the inspector would then offer to edit.
        if (args.until?.kind === "expression") {
            return {
                ...block,
                payload: { control: "repeat", mode: block.payload.mode, until: { kind: "expression", expression: args.until.expression } },
            };
        }
        const times = asNumber(args.times);
        return times === undefined ? block : { ...block, payload: { ...block.payload, times } };
    },
});

/**
 * `/until <condition>` - the conditional loop, written the way a condition is written everywhere else.
 *
 * Builds exactly the block `/repeat until=…` builds; the whole difference is that a greedy positional
 * claims the rest of the line verbatim, so `/until gold >= 10` needs no quotes. Conditions are almost
 * always multi-token, so the quoting a named arg forces would have been a tax on nearly every use.
 *
 * The token reads as the sentence it makes ("until gold is at least 10"), which is also the trap the
 * schema warns about: this is a STOP condition, and the compiler hands its NEGATION to the engine's
 * `whileLoop`. The detail line says so, because the token alone cannot.
 */
export const until = defineStoryCommand({
    id: "until",
    token: "until",
    category: "flow",
    icon: Repeat2,
    examples: ["/until gold >= 10", "/until met"],
    params: {
        // Core: a loop with no stop condition is the one shape this command must never commit - it
        // has no count to fall back on, so an unfilled line would build a group that never ends.
        condition: { hint: "condition", type: { kind: "expression", expects: "boolean" }, positional: true, greedy: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            // No `times`: the two forms are exclusive in the payload, and a count riding along under
            // an `until` is a number the header would offer to edit and the compiler would never read.
            payload: {
                control: "repeat",
                until: args.condition?.kind === "expression"
                    ? { kind: "expression", expression: args.condition.expression }
                    : EMPTY_UNTIL_CONDITION,
            },
        };
    },
});

/**
 * The stop condition a `/until` line builds before its expression resolves.
 *
 * `until` being *present* is what makes a repeat conditional, so the unfilled case cannot drop the
 * field - that would silently build a counted loop instead. An `invalid` ast is the same "written but
 * not yet valid" value the inspector's condition editor produces, and the compiler already refuses to
 * emit a loop whose condition cannot resolve.
 */
const EMPTY_UNTIL_CONDITION = {
    kind: "expression",
    expression: { source: "", ast: { kind: "invalid", source: "" } },
} as const satisfies StoryConditionRef;

/** `/break` - leave the innermost loop. A single instruction, so it builds its block inline. */
export const breakLoop = defineStoryCommand({
    id: "break",
    token: "break",
    category: "flow",
    icon: LogOut,
    examples: ["/break"],
    params: {},
    build(_args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            payload: { control: "break" },
        };
    },
});

export const parallel = defineStoryCommand({
    id: "parallel",
    token: "parallel",
    category: "flow",
    icon: Rows3,
    examples: ["/parallel"],
    params: {},
    build: (_args, ctx) => createBlockForCommand("parallel", ctx.generateId),
});

export const race = defineStoryCommand({
    id: "race",
    token: "race",
    category: "flow",
    icon: Flag,
    examples: ["/race"],
    params: {},
    build: (_args, ctx) => createBlockForCommand("race", ctx.generateId),
});

export const sequence = defineStoryCommand({
    id: "sequence",
    token: "sequence",
    aliases: ["seq"],
    category: "flow",
    icon: ListOrdered,
    examples: ["/sequence"],
    params: {},
    build: (_args, ctx) => createBlockForCommand("sequence", ctx.generateId),
});

/**
 * `/label` and `/goto` - the in-scene play head (§5.11, §7.5).
 *
 * Two tokens rather than one generic jump, by §3.5's ruling: `/jump` changes SCENE, which unloads and
 * re-initializes one, while `/goto` moves the play head and unloads nothing. The runtime difference is
 * too large to hide behind a target type, so each command's detail line names the other by hand.
 *
 * `/goto`'s target is a `label` slot, which offers the labels of this scene and refuses a name that is
 * not one of them - the same scan the compiler validates against, so a completed line always builds.
 */
export const label = defineStoryCommand({
    id: "label",
    token: "label",
    aliases: ["mark"],
    category: "flow",
    icon: Bookmark,
    examples: ["/label after refusal"],
    params: {
        // Greedy: a label is a note to the author ("after the first refusal"), not an identifier.
        name: { hint: "labelName", type: { kind: "text" }, positional: true, greedy: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            payload: { control: "label", name: asText(args.name) ?? "" },
        };
    },
});

export const goto = defineStoryCommand({
    id: "goto",
    token: "goto",
    aliases: ["jumpto"],
    category: "flow",
    icon: CornerUpLeft,
    examples: ["/goto intro"],
    params: {
        target: { hint: "labelName", type: { kind: "label" }, positional: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            payload: { control: "goto", targetLabel: args.target?.kind === "label" ? args.target.name : "" },
        };
    },
});

/**
 * `/cut <variant>` - where the named build variant's story ends.
 *
 * One variant per row, single-valued. Cutting two variants at one point is two rows, which is also
 * the only shape the reference sweep can count: it looks for an `appTagId` holding a variant id, and
 * a list under that key would count as none while every test still passed.
 *
 * The release variant is not offerable (see {@link appTagParam}). A build that ends at a line ships
 * nothing after it, and that is the whole story for the edition every other one is read against.
 * Typing its name still resolves - it has to, since a deleted variant's id resolves to release - and
 * such a row cuts nothing, which is exactly what makes written cut points safe to keep.
 *
 * Hidden from the browse surfaces in a project with no authored variant, because the row would then
 * have nothing to name.
 */
export const cut = defineStoryCommand({
    id: "cut",
    token: "cut",
    category: "flow",
    icon: SeparatorHorizontal,
    examples: ["/cut Demo"],
    params: {
        tag: appTagParam(),
    },
    available: context => context.appTags.some(tag => tag.id !== APP_TAG_ID_RELEASE),
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            // The id, never the typed name: the row has to keep naming the same variant after a
            // rename, and the reference count reads this very field.
            payload: { control: "cut", appTagId: asAppTagId(args.tag) ?? "" },
        };
    },
});

/**
 * `/ending <name>` - the story has reached one of its endings.
 *
 * The row records the ending and stops playback, then shows the page the inspector names (or the
 * one the build declares). Everything downstream keys on the ROW's id rather than on the name, so
 * renaming an ending is free: see `StoryEndingPage` and `listStoryEndings`.
 *
 * The name is a core argument. An unnamed ending would record and stop perfectly well, but it is a
 * thing an author lists on a screen and hands to a player, and a blank one has nothing to show
 * there - so a bare `/ending` stays a draft row asking for the name rather than committing without
 * one, exactly as `/label` does.
 */
export const ending = defineStoryCommand({
    id: "ending",
    token: "ending",
    aliases: ["end"],
    category: "flow",
    icon: FlagTriangleRight,
    examples: ["/ending True End", "/ending Bad End"],
    params: {
        // Greedy, like a label's: an ending is called "The one where nobody comes home", not
        // `ending_03`.
        name: { hint: "endingName", type: { kind: "text" }, positional: true, greedy: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            // No `page`: absent is "the build's own ending page", which is the right default for
            // every project that has set one and harmless for every project that has not.
            payload: { control: "ending", name: asText(args.name) ?? "" },
        };
    },
});

/**
 * `/quit <page>` - the run is over; hand the player this page.
 *
 * The hub row. A scene plays, the playthrough ends, and a page takes the screen - a map, a chapter
 * select, a room the next scene is chosen from. What comes back is `Start Game`, whose scene pin is
 * what makes that page a launcher rather than a menu.
 *
 * Not an `/ending` with the recording turned off: an ending is a thing a player collects, and a hub
 * passed through twenty times would put twenty entries in the endings record, the endings screen and
 * every reader that walks towards one. See the payload's own note.
 *
 * The page is a core argument. A quit with nowhere to go would take the story away and leave the
 * player on a frame with nothing to touch, so a bare `/quit` stays a draft row asking for the page
 * rather than committing without one - exactly as `/label` and `/ending` do with their names.
 */
export const quit = defineStoryCommand({
    id: "quit",
    token: "quit",
    // No `exit` alias: `/hide` already owns that word, and a stage object leaving the screen is
    // the thing an author writes far more often than a playthrough ending.
    aliases: ["leave"],
    category: "flow",
    icon: AppWindow,
    examples: ["/quit Map", "/quit Title"],
    params: {
        page: { hint: "quitPage", type: { kind: "surface" }, positional: true, core: true },
    },
    build(args, ctx): StoryBlock {
        return {
            id: ctx.generateId(),
            parentId: null,
            childrenIds: [],
            kind: "control",
            // The id, never the typed name - the row has to keep naming the same page after a
            // rename, exactly as `/cut` keeps naming the same variant.
            payload: { control: "quit", surfaceId: asSurfaceId(args.page) ?? "" },
        };
    },
});

/** A Story Action Blueprint call - the blueprint itself is picked in the inspector. */
export const blueprint = defineStoryCommand({
    id: "blueprint",
    token: "blueprint",
    aliases: ["executescript", "bp"],
    category: "utils",
    icon: Workflow,
    examples: ["/blueprint"],
    params: {},
    build: (_args, ctx) => createBlockForCommand("executeScript", ctx.generateId),
    inspectorAfterCommit: true,
});

export const LOGIC_COMMANDS = [ifCommand, menu, repeat, until, breakLoop, parallel, race, sequence, label, goto, cut, ending, quit, blueprint];
