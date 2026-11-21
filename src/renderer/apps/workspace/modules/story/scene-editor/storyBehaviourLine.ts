import type { StoryBlock } from "@shared/types/story";
import { isCharacterBehaviourBlock } from "@shared/story/characterBehaviours";
import { toCanonicalCommandLine } from "./commandTrigger";
import { getCommandSpec } from "./commands/registry";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";
import type { StoryCommandContext } from "./storyCommandValues";

/**
 * The commands a character's behaviour offers and accepts: the ones that stage a portrait that is
 * already up, and a sound effect. The command line's menu lists these alone, and a line written with
 * any other command is refused, so what the menu offers and what Enter accepts are one list.
 *
 * Chosen by what a behaviour is for - staging that accompanies a line - not by what happens to build
 * an allowed row: `/show` and `/hide` decide who is on stage (which is what behaviours depend on),
 * `/bgm` and the sound controls act on music that belongs to the scene, and every flow command would
 * make a line of dialogue a branch nobody can see in the script.
 */
export const CHARACTER_BEHAVIOUR_COMMAND_IDS: ReadonlySet<string> = new Set([
    "transform",
    "reset",
    "face",
    "front",
    "motion",
    "skin",
    "param",
    "sound",
]);

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
    if (!spec || spec.editScene || !spec.build || !CHARACTER_BEHAVIOUR_COMMAND_IDS.has(line.def.commandId)) {
        return { ok: false, reason: "notAllowed" };
    }
    const block = spec.build(args, { generateId: () => globalThis.crypto.randomUUID(), context });
    if (!isCharacterBehaviourBlock(block)) {
        return { ok: false, reason: "notAllowed" };
    }
    return { ok: true, block };
}
