import type { StoryBlock } from "@shared/types/story";
import { createBlockForCommand } from "../../storyActionCommands";
import { asEnum, asNumber, asText, defineStoryCommand } from "../spec";

/** Control flow: `/if`, `/menu`, `/repeat`, the run-mode containers, and `/code`. */

export const ifCommand = defineStoryCommand({
    id: "if",
    token: "if",
    category: "flow",
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

export const repeat = defineStoryCommand({
    id: "repeat",
    token: "repeat",
    aliases: ["loop"],
    category: "flow",
    params: {
        times: { hint: "times", type: { kind: "number", min: 1, integer: true }, positional: true, core: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("repeat", ctx.generateId);
        if (block.kind !== "control" || block.payload.control !== "repeat") {
            return block;
        }
        const times = asNumber(args.times);
        return times === undefined ? block : { ...block, payload: { ...block.payload, times } };
    },
});

export const parallel = defineStoryCommand({
    id: "parallel",
    token: "parallel",
    category: "flow",
    params: {},
    build: (_args, ctx) => createBlockForCommand("parallel", ctx.generateId),
});

export const race = defineStoryCommand({
    id: "race",
    token: "race",
    category: "flow",
    params: {},
    build: (_args, ctx) => createBlockForCommand("race", ctx.generateId),
});

export const sequence = defineStoryCommand({
    id: "sequence",
    token: "sequence",
    aliases: ["seq"],
    category: "flow",
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

export const code = defineStoryCommand({
    id: "code",
    token: "code",
    aliases: ["script"],
    category: "utils",
    params: {
        language: {
            hint: "valueType",
            type: {
                kind: "enum",
                options: [
                    { value: "narraleaf", aliases: ["nl"] },
                    { value: "typescript", aliases: ["ts"] },
                    { value: "javascript", aliases: ["js"] },
                ],
            },
            positional: true,
        },
    },
    build(args, ctx) {
        const block = createBlockForCommand("code", ctx.generateId);
        if (block.kind !== "code") {
            return block;
        }
        const language = asEnum(args.language) as "typescript" | "javascript" | "narraleaf" | undefined;
        return language ? { ...block, payload: { ...block.payload, language } } : block;
    },
});

/** A Story Action Blueprint call - the blueprint itself is picked in the inspector. */
export const blueprint = defineStoryCommand({
    id: "blueprint",
    token: "blueprint",
    aliases: ["executescript", "bp"],
    category: "utils",
    params: {},
    build: (_args, ctx) => createBlockForCommand("executeScript", ctx.generateId),
    inspectorAfterCommit: true,
});

export const LOGIC_COMMANDS = [ifCommand, menu, repeat, parallel, race, sequence, label, goto, code, blueprint];
