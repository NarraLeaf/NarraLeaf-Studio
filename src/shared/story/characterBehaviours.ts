import type { StoryActionPayload, StoryBlock, StoryTransformProps } from "../types/story/document";
import { characterStageName, characterStageObjectName, normalizeStageObjectName } from "../types/story/displayableTarget";
import { isRecord } from "@shared/utils/isRecord";

/**
 * A character's behaviours: command rows a character runs on its own when it starts or stops
 * speaking, written once on the character instead of around every line.
 *
 * **Why a character holds them.** A cast that brightens and steps forward on its own lines and
 * dims back on everyone else's has to restate that on both sides of every speaker change - two
 * rows per change, identical every time, and a scene of a few hundred lines carries hundreds of
 * them. A row that has to be identical every time it appears is not a decision a scene makes.
 *
 * **Only the speaker-driven events.** Both fire as a consequence of who is talking, which is what
 * makes them repetitive and what makes them derivable from the script; an entrance happens once
 * and is written once, so it has no business here.
 *
 * **What runs.** Each event is an ordered list of ordinary story rows, edited with the same command
 * line as the story editor and compiled by the same compiler. They run together, alongside the line
 * that set them off, and never hold it up: a behaviour is staging that accompanies a line, and a
 * line that waited for a 0.3 s zoom before its text began would read as lag.
 *
 * **When.** On a line whose speaker differs from the last one heard: the previous speaker's
 * `stopSpeaking` first, then the new speaker's `startSpeaking`. A narration line counts as nobody
 * speaking. A line that opts out (`skipCharacterBehaviours`) is treated as though the speaker had
 * not changed at all - nobody's behaviour runs and the last speaker stays who it was. A character
 * that is not on stage runs nothing; behaviours stage a portrait, and there is none to stage.
 */

export const CHARACTER_BEHAVIOUR_EVENTS = ["startSpeaking", "stopSpeaking"] as const;

export type CharacterBehaviourEvent = (typeof CHARACTER_BEHAVIOUR_EVENTS)[number];

/**
 * Event to its rows. A key that is present with an empty list is a behaviour the author added and
 * has not filled yet - the section stays on screen - while an absent key is an event the character
 * does not react to.
 */
export type CharacterBehaviours = Partial<Record<CharacterBehaviourEvent, StoryBlock[]>>;

export function isCharacterBehaviourEvent(value: unknown): value is CharacterBehaviourEvent {
    return typeof value === "string" && (CHARACTER_BEHAVIOUR_EVENTS as readonly string[]).includes(value);
}

/**
 * Character operations a behaviour may carry. Not `enter` / `exit`: behaviours only run for a
 * character already on stage, so bringing one on is meaningless and taking one off would turn a
 * line of dialogue into an exit nobody wrote. Not `setName`: the nametag is the line's own business.
 */
const CHARACTER_OPERATIONS = new Set<string>(["move", "expression", "setMotion", "setSkin", "setParams"]);

/** Displayable operations a behaviour may carry; showing and hiding are left to the script for the same reason. */
const DISPLAYABLE_OPERATIONS = new Set<string>(["transform", "bringToFront", "loop", "stopLoop"]);

/**
 * Whether a row may be one of a behaviour's rows.
 *
 * A whitelist rather than "any action", because a behaviour is staging that runs beside a line:
 * anything that changes the flow (a jump, a choice, a wait, a page) or that the line's own
 * speaker-tracking depends on (another line of dialogue) would turn an accompaniment into a second
 * script nobody can see in the scene.
 */
export function isCharacterBehaviourBlock(block: StoryBlock): boolean {
    if (block.kind !== "action" || block.childrenIds.length > 0) {
        return false;
    }
    const payload = block.payload;
    switch (payload.action) {
        case "character":
            return CHARACTER_OPERATIONS.has(payload.operation);
        case "displayable":
            return DISPLAYABLE_OPERATIONS.has(payload.operation);
        case "camera":
            return true;
        case "audio":
            // A sound effect; the music and the sound controls belong to the scene.
            return payload.operation === "playSound";
        default:
            return false;
    }
}

/**
 * Drop every `undefined` a builder left behind, deep.
 *
 * The character store is a canonical document and its encoder refuses an `undefined` property by
 * name, while the command specs build payloads with optional fields spelled as `undefined`. A JSON
 * round trip is exactly the right normalisation: it is what the store would have written anyway.
 */
function plainClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** One stored row, reduced to the flat shape a behaviour keeps, or null when it cannot be one. */
function sanitizeBehaviourBlock(value: unknown): StoryBlock | null {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || !isRecord(value.payload)) {
        return null;
    }
    const block = plainClone({ ...value, parentId: null, childrenIds: [] }) as unknown as StoryBlock;
    // A disabled flag is a story-editor gesture with no counterpart here; a stored one would make a
    // row that reads as present and never runs.
    delete (block as { disabled?: boolean }).disabled;
    delete (block as { diagnosticsMeta?: unknown }).diagnosticsMeta;
    return isCharacterBehaviourBlock(block) ? block : null;
}

/**
 * Read stored behaviours, keeping only what a behaviour can run.
 *
 * Defensive in the way `sanitizeCharacterEntranceProps` is: `character.json` may have been edited by
 * hand or written by a plugin, so every row is checked rather than trusted, and a row that fails is
 * dropped rather than repaired.
 */
export function sanitizeCharacterBehaviours(value: unknown): CharacterBehaviours | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const next: CharacterBehaviours = {};
    for (const event of CHARACTER_BEHAVIOUR_EVENTS) {
        const rows = value[event];
        if (!Array.isArray(rows)) {
            continue;
        }
        const seen = new Set<string>();
        next[event] = rows.flatMap(row => {
            const block = sanitizeBehaviourBlock(row);
            if (!block || seen.has(block.id)) {
                return [];
            }
            seen.add(block.id);
            return [block];
        });
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

/** Whether any event carries at least one row - the only case in which a compile has work to do. */
export function hasCharacterBehaviourRows(behaviours: CharacterBehaviours | undefined): boolean {
    return CHARACTER_BEHAVIOUR_EVENTS.some(event => (behaviours?.[event]?.length ?? 0) > 0);
}

/** Whether a line of dialogue or narration declines to set off behaviours. */
export function speakingRowSkipsBehaviours(block: StoryBlock): boolean {
    if (block.kind !== "nodeAction") {
        return false;
    }
    const payload = block.payload;
    return (payload.action === "dialogue" || payload.action === "narration") && payload.skipCharacterBehaviours === true;
}

/**
 * Who a speaking row hands the floor to: a character id, `null` for nobody (narration, or a speaker
 * with no Studio character behind it), or `undefined` when the row is not a line at all.
 */
export function speakingRowSpeaker(block: StoryBlock): string | null | undefined {
    if (block.kind !== "nodeAction") {
        return undefined;
    }
    const payload = block.payload;
    if (payload.action === "dialogue") {
        return payload.characterId || null;
    }
    if (payload.action === "narration") {
        return null;
    }
    return undefined;
}

/**
 * The stage channels one row writes, each spelled `<subject>|<channel>`, for telling a hand-written
 * row from a behaviour that writes the same thing at the same moment.
 *
 * The subject is the stage name - the one key a character row and a displayable row addressing the
 * same portrait share (`characterStageObjectName`) - so two rows conflict only when they act on the
 * same thing; the channel is a transform prop, an
 * appearance, a puppet state channel, the stacking order, or the camera's one transform. Coarse on
 * purpose: "both move Alice's zoom" is the question an author can act on, and finer distinctions
 * (two different filter functions) would hide a conflict the engine still has - one filter chain.
 */
export function storyRowStageChannels(block: StoryBlock): Set<string> {
    const channels = new Set<string>();
    if (block.kind !== "action") {
        return channels;
    }
    const payload = block.payload as StoryActionPayload;
    const addTransform = (subject: string, props: StoryTransformProps | undefined) => {
        for (const [key, value] of Object.entries(props ?? {})) {
            if (value === undefined) {
                continue;
            }
            // The three filter writers share one CSS property, so they are one channel.
            const channel = key === "filterRaw" || key === "look" ? "filter" : key;
            channels.add(`${subject}|transform:${channel}`);
        }
    };
    if (payload.action === "character") {
        const subject = `stage:${normalizeStageObjectName(characterStageObjectName(payload))}`;
        switch (payload.operation) {
            case "move":
                if (payload.transform?.mode === "animation") {
                    channels.add(`${subject}|transform:animation`);
                } else {
                    addTransform(subject, payload.transform?.to);
                }
                return channels;
            case "expression":
                channels.add(`${subject}|appearance`);
                return channels;
            case "setMotion":
                channels.add(`${subject}|puppet:motion`);
                return channels;
            case "setSkin":
                channels.add(`${subject}|puppet:skin`);
                return channels;
            case "setParams":
                for (const id of Object.keys(payload.params ?? {})) {
                    channels.add(`${subject}|puppet:param:${id}`);
                }
                return channels;
            default:
                return channels;
        }
    }
    if (payload.action === "displayable") {
        const subject = `stage:${normalizeStageObjectName(payload.target?.name)}`;
        if (payload.operation === "bringToFront") {
            channels.add(`${subject}|front`);
        } else if (payload.transform?.mode === "animation" || payload.operation === "loop" || payload.operation === "stopLoop") {
            channels.add(`${subject}|transform:animation`);
        } else {
            addTransform(subject, payload.transform?.to);
        }
        return channels;
    }
    if (payload.action === "camera") {
        channels.add("camera|transform");
    }
    return channels;
}

/** The two shapes of a scene the static questions below need - a scene, or anything shaped like one. */
type BehaviourSceneShape = {
    blocks: Record<string, StoryBlock>;
    rootBlockIds: readonly string[];
};

function siblingsOf(scene: BehaviourSceneShape, block: StoryBlock): readonly string[] {
    return block.parentId ? scene.blocks[block.parentId]?.childrenIds ?? [] : scene.rootBlockIds;
}

/** A row the walks below stop at: anything that is not a plain action, since play may not have come straight through it. */
function stopsBehaviourWalk(block: StoryBlock): boolean {
    return block.kind !== "action" && block.kind !== "note" && block.kind !== "empty" && block.kind !== "declaration";
}

/**
 * The stage channels hand-written rows set at the moment a line's behaviours run, each mapped to the
 * nearest row that sets it.
 *
 * Behaviours run with the line, so the rows that share that moment are the ones written straight
 * above it: back through its own siblings until the previous line, or anything play may not have come
 * straight through (a container, a jump). A row there that writes the same channel a behaviour row
 * does is the author's explicit word for this line, and wins - the behaviour row is left out here and
 * the hand-written row is marked so the overlap is visible.
 */
export function handWrittenChannelsBeforeLine(scene: BehaviourSceneShape, lineBlockId: string): Map<string, string> {
    const channels = new Map<string, string>();
    const line = scene.blocks[lineBlockId];
    if (!line) {
        return channels;
    }
    const siblings = siblingsOf(scene, line);
    for (let index = siblings.indexOf(lineBlockId) - 1; index >= 0; index -= 1) {
        const block = scene.blocks[siblings[index]];
        if (!block || block.disabled) {
            continue;
        }
        if (stopsBehaviourWalk(block)) {
            break;
        }
        for (const channel of storyRowStageChannels(block)) {
            if (!channels.has(channel)) {
                channels.set(channel, block.id);
            }
        }
    }
    return channels;
}

/**
 * The speaker a line takes the floor from, when the scene states it without play having to decide:
 * the nearest earlier line among its own siblings, climbing to the enclosing rows when the list runs
 * out. `undefined` when it cannot be told statically (a container or jump in the way, or no line
 * before it); `null` when that line was narration.
 */
export function staticPreviousSpeaker(scene: BehaviourSceneShape, lineBlockId: string): string | null | undefined {
    let current = scene.blocks[lineBlockId];
    while (current) {
        const siblings = siblingsOf(scene, current);
        for (let index = siblings.indexOf(current.id) - 1; index >= 0; index -= 1) {
            const block = scene.blocks[siblings[index]];
            if (!block || block.disabled) {
                continue;
            }
            const speaker = speakingRowSpeaker(block);
            if (speaker !== undefined) {
                if (speakingRowSkipsBehaviours(block)) {
                    continue;
                }
                return speaker;
            }
            if (stopsBehaviourWalk(block)) {
                return undefined;
            }
        }
        if (!current.parentId) {
            return undefined;
        }
        const parent = scene.blocks[current.parentId];
        // Stepping out of a branch or an option: the rows before the container ran before it, but
        // whether the floor changed inside a sibling branch is play's decision, not the scene's.
        if (!parent || parent.kind !== "control") {
            return undefined;
        }
        current = parent;
    }
    return undefined;
}

/** One behaviour row a hand-written row overrides at one line. */
export type CharacterBehaviourConflict = {
    /** The hand-written row that wins. */
    rowBlockId: string;
    /** The line whose behaviours it overlaps. */
    lineBlockId: string;
    characterId: string;
    event: CharacterBehaviourEvent;
    behaviourRowId: string;
};

/**
 * Every place in a scene where a hand-written row and a behaviour write the same channel at the same
 * line - the input both the compile (which leaves the behaviour row out there) and the editor's mark
 * read, so the two cannot disagree about which rows overlap.
 *
 * Only behaviours the scene settles statically are checked: the speaker's own `startSpeaking`, and
 * the previous speaker's `stopSpeaking` when {@link staticPreviousSpeaker} can name them. A stop that
 * depends on which branch play took is not reported; the compile still keeps the hand-written row
 * ahead of it wherever it does run.
 */
export function findCharacterBehaviourConflicts(
    scene: BehaviourSceneShape,
    behavioursByCharacter: ReadonlyMap<string, CharacterBehaviours | undefined>,
): CharacterBehaviourConflict[] {
    const conflicts: CharacterBehaviourConflict[] = [];
    if (![...behavioursByCharacter.values()].some(hasCharacterBehaviourRows)) {
        return conflicts;
    }
    for (const block of Object.values(scene.blocks)) {
        const speaker = speakingRowSpeaker(block);
        if (speaker === undefined || block.disabled || speakingRowSkipsBehaviours(block)) {
            continue;
        }
        const previous = staticPreviousSpeaker(scene, block.id);
        if (previous !== undefined && previous === speaker) {
            continue;
        }
        const firing: { characterId: string; event: CharacterBehaviourEvent }[] = [];
        if (speaker) {
            firing.push({ characterId: speaker, event: "startSpeaking" });
        }
        if (previous) {
            firing.push({ characterId: previous, event: "stopSpeaking" });
        }
        if (firing.length === 0) {
            continue;
        }
        const written = handWrittenChannelsBeforeLine(scene, block.id);
        if (written.size === 0) {
            continue;
        }
        for (const { characterId, event } of firing) {
            for (const row of behavioursByCharacter.get(characterId)?.[event] ?? []) {
                for (const channel of storyRowStageChannels(row)) {
                    const rowBlockId = written.get(channel);
                    if (rowBlockId) {
                        conflicts.push({ rowBlockId, lineBlockId: block.id, characterId, event, behaviourRowId: row.id });
                        break;
                    }
                }
            }
        }
    }
    return conflicts;
}

/** Whether a behaviour row writes a channel some hand-written row already sets at this line. */
export function behaviourRowOverridden(row: StoryBlock, written: ReadonlyMap<string, string>): boolean {
    for (const channel of storyRowStageChannels(row)) {
        if (written.has(channel)) {
            return true;
        }
    }
    return false;
}

/**
 * Each portrait key a scene registers for the given characters, back to the character - for the
 * `/show` and `/hide` rows that address a character by the name its portrait is registered under.
 * Seeded with the default key (`characterStageName(id)`) so a character the scene never brings on
 * under a name of its own is still found.
 */
export function characterBehaviourStageNames(
    scene: BehaviourSceneShape,
    characterIds: Iterable<string>,
): Map<string, string> {
    const ids = new Set(characterIds);
    const names = new Map<string, string>();
    for (const characterId of ids) {
        names.set(normalizeStageObjectName(characterStageName(characterId)), characterId);
    }
    for (const block of Object.values(scene.blocks)) {
        if (block.kind === "action" && block.payload.action === "character" && block.payload.characterId && ids.has(block.payload.characterId)) {
            names.set(normalizeStageObjectName(characterStageObjectName(block.payload)), block.payload.characterId);
        }
    }
    return names;
}

/**
 * Which character a row brings on or takes off - an entrance or exit, or a `/show` / `/hide` of a
 * character's portrait - when it is one of the characters `stageNames` covers.
 */
export function characterBehaviourPresenceChange(
    block: StoryBlock,
    stageNames: ReadonlyMap<string, string>,
): { characterId: string; onStage: boolean } | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character" && (payload.operation === "enter" || payload.operation === "exit")) {
        const characterId = payload.characterId;
        const covered = characterId && [...stageNames.values()].includes(characterId);
        return covered ? { characterId, onStage: payload.operation === "enter" } : null;
    }
    if (payload.action === "displayable" && (payload.operation === "show" || payload.operation === "hide") && !payload.target?.builtin) {
        const characterId = stageNames.get(normalizeStageObjectName(payload.target?.name));
        return characterId ? { characterId, onStage: payload.operation === "show" } : null;
    }
    return null;
}
