import { createBlockForCommand } from "../../storyActionCommands";
import { asEnum, asNumber, defineStoryCommand } from "../spec";

/** Control flow: `/if`, `/menu`, `/repeat`, the run-mode containers, and `/code`. */

export const ifCommand = defineStoryCommand({
    id: "if",
    token: "if",
    category: "control",
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
    category: "control",
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
    category: "control",
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
    category: "control",
    params: {},
    build: (_args, ctx) => createBlockForCommand("parallel", ctx.generateId),
});

export const race = defineStoryCommand({
    id: "race",
    token: "race",
    category: "control",
    params: {},
    build: (_args, ctx) => createBlockForCommand("race", ctx.generateId),
});

export const sequence = defineStoryCommand({
    id: "sequence",
    token: "sequence",
    aliases: ["seq"],
    category: "control",
    params: {},
    build: (_args, ctx) => createBlockForCommand("sequence", ctx.generateId),
});

export const code = defineStoryCommand({
    id: "code",
    token: "code",
    aliases: ["script"],
    category: "data",
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
    category: "data",
    params: {},
    build: (_args, ctx) => createBlockForCommand("executeScript", ctx.generateId),
    inspectorAfterCommit: true,
});

export const LOGIC_COMMANDS = [ifCommand, menu, repeat, parallel, race, sequence, code, blueprint];
