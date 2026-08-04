import type { StoryBlock } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { PaletteActionCommand } from "./storyActionCommands";
import { getCommandSpec } from "./commands/registry";
import { specGroupIds, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { quoteEntityValue } from "./storyCommandCursor";
import { paramTypes, positionalParams, type StoryCommandDef } from "./storyCommandGrammar";

/**
 * "What can this line do to *this* character" - the whole of the character-scoped action set.
 *
 * The blank line Enter opens under a dialogue is still that speaker's line: the author is either
 * writing more of what they say, or doing something to them (show them, hide them, change their
 * face, move them). So the trigger typed there opens the action creator narrowed to one subject
 * rather than the whole vocabulary - the other 40-odd commands are about the stage, the sound and
 * the story's data, and none of them is what "still Alice" means.
 *
 * The membership is NOT a list written here. It is the 角色 group the sidebar already files by
 * (`specGroupIds`), which is the same `accepts` classification every other command surface reads: a
 * verb reaches a character exactly when its target param says it does. A hand-kept list would be the
 * "object type × verb" matrix the taxonomy exists to refuse, and it would go stale the first time a
 * spec grew or lost `character` from its `accepts`.
 */

/** The one group a character-scoped verb files under. */
const CHARACTER_GROUP = "character";

/**
 * The two verbs that decide whether a character is on stage AT ALL, rather than modulating one who
 * already is - and the character-payload operations they write.
 *
 * This is the line between "still this speaker's paragraph" and "the staging around it", and both
 * surfaces below read it from here so they cannot drift apart:
 *
 *  - the scoped creator does not OFFER them. The line it opens sits inside a run of one character's
 *    speech, and a character who is speaking is on stage by definition — asking to show them there
 *    says nothing, and hiding them mid-sentence contradicts the line above and the line below.
 *  - the paragraph does not ABSORB them ({@link paragraphActionCharacterId}). A run that swallowed
 *    its own `@hide` would draw the speaker's continuation rule straight through the row that ends
 *    them, which is the one thing that rule must never say.
 */
const STAGING_COMMAND_IDS: ReadonlySet<string> = new Set(["show", "hide"]);
const STAGING_OPERATIONS: ReadonlySet<string> = new Set(["enter", "exit", "show", "hide"]);

/**
 * Whether a palette entry acts on a character who is already on stage.
 *
 * A plugin action has no spec to classify, so its own registration group is all there is to go on -
 * a plugin that files itself under 角色 is taken at its word, exactly as the sidebar takes it.
 */
export function isCharacterScopedAction(command: PaletteActionCommand): boolean {
    if (STAGING_COMMAND_IDS.has(command.id)) {
        return false;
    }
    const spec = getCommandSpec(command.id);
    return spec ? specGroupIds(spec).includes(CHARACTER_GROUP) : command.group === CHARACTER_GROUP;
}

/** The character-scoped entries of a palette list, in the order they arrived. */
export function characterScopedActions(commands: readonly PaletteActionCommand[]): PaletteActionCommand[] {
    return commands.filter(isCharacterScopedAction);
}

/**
 * The 角色 section of the browse projection, narrowed to the same verbs the typed list offers.
 *
 * Both tiers have to be filtered, not just one: the menu browses these groups on an empty query and
 * ranks the flat list once there is one, so filtering only the flat list would have shown `显示` the
 * moment the author stopped typing.
 */
export function characterScopedSidebarGroups(
    groups: readonly StoryCommandSidebarGroup[],
): readonly StoryCommandSidebarGroup[] {
    return groups
        .filter(entry => entry.group.id === CHARACTER_GROUP)
        .map(entry => ({ ...entry, commands: entry.commands.filter(isCharacterScopedAction) }))
        .filter(entry => entry.commands.length > 0);
}

/**
 * Whether a command's FIRST positional slot is the character it acts on.
 *
 * True for both spellings of that slot - `/face <character>` names one directly, `/show <target>`
 * takes the generic subject slot whose `accepts` includes characters - because the completion only
 * cares that the next word the author would type is a character's name.
 */
export function commandLeadsWithCharacter(def: StoryCommandDef): boolean {
    const first = positionalParams(def)[0];
    if (!first) {
        return false;
    }
    return paramTypes(first).some(type =>
        type.kind === "character" || (type.kind === "target" && type.accepts.includes(CHARACTER_GROUP)));
}

/**
 * The text a scoped pick writes after the verb: the character the line is already about, quoted the
 * way the tokenizer needs it (`'The Stranger'`), plus the space that opens the next slot.
 *
 * Filling it in is the point of the scope. The author chose this action *from a menu that only
 * offered this character's*, so asking them to type the name back would be asking a question the
 * editor already knows the answer to - and it writes the name rather than an id, so the line still
 * reads as something they could have typed themselves.
 *
 * Empty for a command whose first slot is not the character (none today; a plugin action could be
 * one), so an unfillable line is left alone rather than fed a word its grammar has no slot for.
 */
export function characterScopeLead(def: StoryCommandDef, name: string): string {
    return commandLeadsWithCharacter(def) ? `${quoteEntityValue(name)} ` : "";
}

/**
 * The character a dialogue row is speaking as, as a project record.
 *
 * Null for a bare `speakerName`: a temp speaker is a name on a line and nothing else - it has no
 * portrait to show, no forms to switch and no record for `/show` to resolve against - so a line
 * scoped to one would offer verbs that cannot resolve. Those rows keep the plain dialogue placeholder
 * and the plain Enter.
 */
/**
 * The character an ACTION row acts on, when it is the kind of row a speaker's paragraph absorbs.
 *
 * The other half of the scope, and deliberately the same rule: a line the author wrote from inside
 * one character's run reads as part of that run, so it keeps the paragraph's continuation rule
 * instead of standing alone with a directive's glyph. Before this only `/face` was folded in, which
 * left `@动作 Doll run` written between two of Doll's lines looking like a subject change.
 *
 * Two payload shapes reach it, because two spellings of the same idea do:
 *  - a character payload names the character by id, which is exact;
 *  - `/fx` and `/transform` address a *displayable* by name, which is all those rows ever store (see
 *    `displayableTargetRef`), so the match is by name against the cast. That is the same lookup the
 *    row itself resolves through, so it is not a new way to be wrong — a rename that breaks one
 *    breaks both, and visibly.
 *
 * Staging is excluded on both paths: see {@link STAGING_OPERATIONS}.
 */
export function paragraphActionCharacterId(block: StoryBlock, characters: readonly Character[]): string | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character") {
        return !STAGING_OPERATIONS.has(payload.operation) && payload.characterId ? payload.characterId : null;
    }
    if (payload.action === "displayable" && payload.target.kind === "character" && !STAGING_OPERATIONS.has(payload.operation)) {
        const name = payload.target.name;
        return characters.find(character => character.profile.getName() === name)?.profile.getId() ?? null;
    }
    return null;
}

export function dialogueActionCharacter(block: StoryBlock, characters: readonly Character[]): Character | null {
    if (block.kind !== "nodeAction" || block.payload.action !== "dialogue" || !block.payload.characterId) {
        return null;
    }
    const characterId = block.payload.characterId;
    return characters.find(character => character.profile.getId() === characterId) ?? null;
}
