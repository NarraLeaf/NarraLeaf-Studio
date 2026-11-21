import type { StoryBlock } from "@shared/types/story";
import { isCharacterBehaviourBlock } from "@shared/story/characterBehaviours";
import { toCanonicalCommandLine } from "./commandTrigger";
import { getCommandSpec } from "./commands/registry";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";
import type { StoryCommandContext } from "./storyCommandValues";

export type BehaviourLineResult =
    | { ok: true; block: StoryBlock }
    /**
     * `incomplete`: not a command line yet, a required slot is empty, or a name does not resolve -
     * what the slot already draws in the reject colour. `notAllowed`: a finished command that a
     * behaviour cannot hold (see `isCharacterBehaviourBlock`).
     */
    | { ok: false; reason: "incomplete" | "notAllowed" };

/**
 * One typed line turned into the row it writes, by the scene editor's own commit path: parse, the
 * one commit gate, resolve, and the command's spec builds the block.
 *
 * The same four steps `commitCommandFromInsert` takes, minus everything that is about a scene - where
 * the row lands, a container's scaffolding, a command that edits the scene instead of writing a row.
 * A behaviour has none of those, and a command that only exists as one of them is not a behaviour row.
 */
export function buildBehaviourBlockFromLine(value: string, context: StoryCommandContext): BehaviourLineResult {
    // Either trigger reads: the field shows what the author typed, the parser takes the canonical form.
    const line = parseCommandLine(toCanonicalCommandLine(value, true));
    if (line.kind !== "command" || !line.def || !canCommit(line)) {
        return { ok: false, reason: "incomplete" };
    }
    const { args, issues } = resolveCommandLine(line, context);
    if (issues.length > 0) {
        return { ok: false, reason: "incomplete" };
    }
    const spec = getCommandSpec(line.def.commandId);
    if (!spec || spec.editScene || !spec.build) {
        return { ok: false, reason: "notAllowed" };
    }
    const block = spec.build(args, { generateId: () => globalThis.crypto.randomUUID(), context });
    if (!isCharacterBehaviourBlock(block)) {
        return { ok: false, reason: "notAllowed" };
    }
    return { ok: true, block };
}
