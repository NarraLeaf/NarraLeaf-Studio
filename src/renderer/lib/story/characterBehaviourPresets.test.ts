import { describe, expect, it } from "vitest";
import { isCharacterBehaviourBlock } from "@shared/story/characterBehaviours";
import {
    applyCharacterBehaviourPreset,
    characterBehaviourPresetRows,
    CHARACTER_BEHAVIOUR_PRESET_IDS,
} from "./characterBehaviourPresets";

let next = 0;
const id = () => `row-${next++}`;
const alice = { id: "alice", name: "Alice", entrance: { zoom: 0.5, filter: { saturate: 0.8 } } };

describe("character behaviour presets", () => {
    it("writes only rows a behaviour can hold", () => {
        for (const presetId of CHARACTER_BEHAVIOUR_PRESET_IDS) {
            const rows = characterBehaviourPresetRows(presetId, alice, id);
            for (const row of [...rows.startSpeaking ?? [], ...rows.stopSpeaking ?? []]) {
                expect(isCharacterBehaviourBlock(row), presetId).toBe(true);
            }
        }
    });

    it("works from the character's entrance defaults rather than absolute numbers", () => {
        const grow = characterBehaviourPresetRows("growWhenSpeaking", alice, id);
        expect(grow.startSpeaking?.[0].payload).toMatchObject({ transform: { to: { zoom: 0.525 } } });
        expect(grow.stopSpeaking?.[0].payload).toMatchObject({ transform: { to: { zoom: 0.5 } } });
        // Dimming keeps the grade the entrance carries on the same filter channel.
        const dim = characterBehaviourPresetRows("dimWhenSilent", alice, id);
        expect(dim.stopSpeaking?.[0].payload).toMatchObject({ transform: { to: { filter: { saturate: 0.8, brightness: 0.6 } } } });
    });

    it("replaces a row on the same channel, so a second preset swaps rather than stacks", () => {
        const shrunk = applyCharacterBehaviourPreset(undefined, characterBehaviourPresetRows("shrinkWhenSilent", alice, id));
        const grown = applyCharacterBehaviourPreset(shrunk, characterBehaviourPresetRows("growWhenSpeaking", alice, id));
        expect(grown.startSpeaking).toHaveLength(1);
        expect(grown.stopSpeaking).toHaveLength(1);
        expect(grown.startSpeaking?.[0].id).toBe(shrunk.startSpeaking?.[0].id);
        expect(grown.startSpeaking?.[0].payload).toMatchObject({ transform: { to: { zoom: 0.525 } } });
        const withFront = applyCharacterBehaviourPreset(grown, characterBehaviourPresetRows("frontWhenSpeaking", alice, id));
        expect(withFront.startSpeaking).toHaveLength(2);
        expect(applyCharacterBehaviourPreset(withFront, characterBehaviourPresetRows("frontWhenSpeaking", alice, id))).toEqual(withFront);
    });
});
