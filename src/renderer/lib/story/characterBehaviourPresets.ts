import {
    storyRowStageChannels,
    type CharacterBehaviourEvent,
    type CharacterBehaviours,
} from "@shared/story/characterBehaviours";
import type { StoryBlock, StoryTransformProps } from "@shared/types/story";
import { characterStageName } from "@shared/types/story";

/**
 * Ready-made behaviours: the staging most visual novels use to show who is talking, written as the
 * same rows an author would type (`/transform <name> …`, `/front <name>`), so a preset is a starting
 * point the author can read and edit in the list, not a mode of its own.
 *
 * Each preset is a pair - what the character does when it takes the floor and what it does when it
 * hands it over - because one without the other leaves the character stuck: dimmed on the first line
 * someone else speaks and never brightened again.
 *
 * Numbers are relative to the character's entrance defaults (`entranceTransform`): a character drawn
 * at zoom 0.45 grows to 0.45 x 1.05 and back to 0.45, not to 1.05 and 1. An absolute number would
 * resize every character who carries a default the moment it first spoke.
 */

export const CHARACTER_BEHAVIOUR_PRESET_IDS = [
    "dimWhenSilent",
    "fadeWhenSilent",
    "growWhenSpeaking",
    "shrinkWhenSilent",
    "frontWhenSpeaking",
] as const;

export type CharacterBehaviourPresetId = (typeof CHARACTER_BEHAVIOUR_PRESET_IDS)[number];

/** How long a preset's change takes. Short enough to finish before the line's first words are read. */
export const PRESET_DURATION_MS = 300;

const DIMMED_BRIGHTNESS = 0.6;
const FADED_OPACITY = 0.6;
const GROWN_ZOOM = 1.05;
const SHRUNK_ZOOM = 0.95;

type PresetCharacter = {
    id: string;
    name: string;
    entrance?: StoryTransformProps;
};

type PresetRows = Partial<Record<CharacterBehaviourEvent, StoryBlock[]>>;

function target(character: PresetCharacter) {
    // The stage key, as `/transform <name>` writes it (`displayableTargetRef`): the cast name is only
    // the label a person reads.
    return { kind: "character" as const, name: characterStageName(character.id), label: character.name };
}

function transformRow(generateId: () => string, character: PresetCharacter, to: StoryTransformProps): StoryBlock {
    return {
        id: generateId(),
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "displayable",
            operation: "transform",
            target: target(character),
            transform: { mode: "props", to, durationMs: PRESET_DURATION_MS },
        },
    } as StoryBlock;
}

function frontRow(generateId: () => string, character: PresetCharacter): StoryBlock {
    return {
        id: generateId(),
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "displayable", operation: "bringToFront", target: target(character) },
    } as StoryBlock;
}

/** The brightness the filter channel keeps besides, so dimming does not drop a grade the entrance carries. */
function withBrightness(character: PresetCharacter, brightness: number): StoryTransformProps {
    return { filter: { ...(character.entrance?.filter ?? {}), brightness } };
}

/** The rows one preset writes for one character. */
export function characterBehaviourPresetRows(
    presetId: CharacterBehaviourPresetId,
    character: PresetCharacter,
    generateId: () => string,
): PresetRows {
    const zoom = character.entrance?.zoom ?? 1;
    const opacity = character.entrance?.opacity ?? 1;
    const restBrightness = character.entrance?.filter?.brightness ?? 1;
    switch (presetId) {
        case "dimWhenSilent":
            return {
                startSpeaking: [transformRow(generateId, character, withBrightness(character, restBrightness))],
                stopSpeaking: [transformRow(generateId, character, withBrightness(character, restBrightness * DIMMED_BRIGHTNESS))],
            };
        case "fadeWhenSilent":
            return {
                startSpeaking: [transformRow(generateId, character, { opacity })],
                stopSpeaking: [transformRow(generateId, character, { opacity: opacity * FADED_OPACITY })],
            };
        case "growWhenSpeaking":
            return {
                startSpeaking: [transformRow(generateId, character, { zoom: zoom * GROWN_ZOOM })],
                stopSpeaking: [transformRow(generateId, character, { zoom })],
            };
        case "shrinkWhenSilent":
            return {
                startSpeaking: [transformRow(generateId, character, { zoom })],
                stopSpeaking: [transformRow(generateId, character, { zoom: zoom * SHRUNK_ZOOM })],
            };
        case "frontWhenSpeaking":
            // Nothing to undo when the floor passes: the next speaker's own preset brings them forward.
            return { startSpeaking: [frontRow(generateId, character)] };
    }
}

/**
 * Lay a preset's rows into a character's behaviours.
 *
 * A row the character already has that writes the same thing - the same channel of the same portrait -
 * is replaced in place, so applying "grow" after "shrink" swaps one zoom for the other instead of
 * leaving two rows fighting over it, and applying a preset twice changes nothing. Everything else
 * the author wrote stays where it was; new rows go at the end.
 */
export function applyCharacterBehaviourPreset(current: CharacterBehaviours | undefined, rows: PresetRows): CharacterBehaviours {
    const next: CharacterBehaviours = { ...(current ?? {}) };
    for (const [event, added] of Object.entries(rows) as [CharacterBehaviourEvent, StoryBlock[]][]) {
        const list = [...(next[event] ?? [])];
        for (const row of added) {
            const channels = storyRowStageChannels(row);
            const index = list.findIndex(existing => [...storyRowStageChannels(existing)].some(channel => channels.has(channel)));
            if (index >= 0) {
                list[index] = { ...row, id: list[index].id };
            } else {
                list.push(row);
            }
        }
        next[event] = list;
    }
    return next;
}
