import { createBlockForCommand } from "../../storyActionCommands";
import { defineStoryCommand } from "../spec";

/** Studio-only rows: `/note` (alias `//` - the parser consumes the leading slash, so the alias token is `/`). */

export const note = defineStoryCommand({
    id: "note",
    token: "note",
    aliases: ["/"],
    category: "utils",
    params: {
        text: { hint: "content", type: { kind: "text" }, positional: true, greedy: true },
    },
    build(args, ctx) {
        const block = createBlockForCommand("note", ctx.generateId, args.text?.kind === "text" ? args.text.value : "");
        return block;
    },
});

export const MISC_COMMANDS = [note];
