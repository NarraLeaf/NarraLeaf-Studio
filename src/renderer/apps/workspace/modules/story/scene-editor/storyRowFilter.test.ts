import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import {
    EMPTY_STORY_ROW_FILTER,
    isDialogueOnlyStoryRowFilter,
    isStoryRowFilterActive,
    dialogueOnlyStoryRowFilter,
    normalizeStoryRowFacets,
    normalizeStoryRowSpeakers,
    revealRowInStoryRowFilter,
    speakerKeyForCharacter,
    speakerKeyForName,
    storyRowFacet,
    storyRowFilterSize,
    storyRowPassesFilter,
    storyRowSpeakerKeyOf,
    STORY_ROW_FACETS,
    STORY_ROW_NARRATIVE_FACETS,
    STORY_ROW_STAGING_FACETS,
    tallyStoryRows,
    type StoryRowFacetId,
    type StoryRowFilter,
} from "./storyRowFilter";

function block(partial: Partial<StoryBlock> & Pick<StoryBlock, "kind" | "payload">): StoryBlock {
    return { id: "b", parentId: null, childrenIds: [], ...partial } as StoryBlock;
}

const dialogue = block({ kind: "nodeAction", payload: { action: "dialogue", characterId: "c1", text: { textId: "t", role: "dialogue", value: "hi" } } });
const otherDialogue = block({ kind: "nodeAction", payload: { action: "dialogue", characterId: "c2", text: { textId: "t", role: "dialogue", value: "ho" } } });
const tempDialogue = block({ kind: "nodeAction", payload: { action: "dialogue", speakerName: "Guard", text: { textId: "t", role: "dialogue", value: "halt" } } });
const unassignedDialogue = block({ kind: "nodeAction", payload: { action: "dialogue", text: { textId: "t", role: "dialogue", value: "?" } } });
const narration = block({ kind: "nodeAction", payload: { action: "narration", text: { textId: "t", role: "narration", value: "..." } } });
const choice = block({ kind: "nodeAction", payload: { action: "choice" } });
const choiceOption = block({ kind: "nodeAction", payload: { action: "choiceOption", text: { textId: "t", role: "choiceText", value: "" } } });
const note = block({ kind: "note", payload: { text: { textId: "t", role: "note", value: "" } } });
const expression = block({ kind: "action", payload: { action: "character", operation: "expression", characterId: "c1" } });
const enter = block({ kind: "action", payload: { action: "character", operation: "enter", characterId: "c1" } });
const transform = block({ kind: "action", payload: { action: "displayable", operation: "transform", target: { kind: "character", name: "Alice" } } as never });
const image = block({ kind: "action", payload: { action: "image", operation: "show", imageId: "i1" } as never });
const background = block({ kind: "action", payload: { action: "setBackground" } as never });
const jump = block({ kind: "jump", payload: { targetSceneId: "s2" } });
const condition = block({ kind: "control", payload: { control: "condition" } as never });
const invalid = block({ kind: "invalid", payload: { text: "/nope" } as never });

/** The scene's cast, as the controller supplies it: display name → character id. */
const byName = (name: string) => (name === "Alice" ? "c1" : null);
const noCast = () => null;

function filter(partial: Partial<{ facets: StoryRowFacetId[]; speakers: string[] }>): StoryRowFilter {
    return { facets: new Set(partial.facets ?? []), speakers: new Set(partial.speakers ?? []) };
}

describe("storyRowFacet", () => {
    it("splits the prose kinds out of the character category", () => {
        // The whole reason the filter has its own taxonomy: these three share one command category.
        expect(storyRowFacet(dialogue)).toBe("dialogue");
        expect(storyRowFacet(narration)).toBe("narration");
        expect(storyRowFacet(expression)).toBe("character");
    });

    it("files a choice and its options together, apart from flow control", () => {
        expect(storyRowFacet(choice)).toBe("choice");
        expect(storyRowFacet(choiceOption)).toBe("choice");
        expect(storyRowFacet(condition)).toBe("flow");
    });

    it("collapses the stage subjects onto one facet and keeps scene-scoped rows on the scene", () => {
        expect(storyRowFacet(image)).toBe("stage");
        expect(storyRowFacet(background)).toBe("scene");
        expect(storyRowFacet(jump)).toBe("scene");
    });

    it("gives an unresolved line its own facet rather than burying it under 'other'", () => {
        expect(storyRowFacet(invalid)).toBe("invalid");
        expect(storyRowFacet(note)).toBe("note");
    });
});

describe("storyRowSpeakerKeyOf", () => {
    it("claims a character's dialogue and everything staged at them, entrances included", () => {
        expect(storyRowSpeakerKeyOf(dialogue, noCast)).toBe(speakerKeyForCharacter("c1"));
        expect(storyRowSpeakerKeyOf(expression, noCast)).toBe(speakerKeyForCharacter("c1"));
        // Wider than `paragraphActionCharacterId`, which excludes staging: following one character
        // through a scene means seeing them arrive.
        expect(storyRowSpeakerKeyOf(enter, noCast)).toBe(speakerKeyForCharacter("c1"));
    });

    it("resolves a displayable addressed by name back to the character it names", () => {
        expect(storyRowSpeakerKeyOf(transform, byName)).toBe(speakerKeyForCharacter("c1"));
        // No character by that name: still a speaker, just one with nothing behind them.
        expect(storyRowSpeakerKeyOf(transform, noCast)).toBe(speakerKeyForName("Alice"));
    });

    it("keeps a temp speaker apart from a real character of any name", () => {
        expect(storyRowSpeakerKeyOf(tempDialogue, noCast)).toBe(speakerKeyForName("Guard"));
        expect(speakerKeyForName("Guard")).not.toBe(speakerKeyForCharacter("Guard"));
    });

    it("gives no owner to rows nobody speaks, including a dialogue with no speaker yet", () => {
        for (const orphan of [narration, choice, background, condition, invalid, unassignedDialogue]) {
            expect(storyRowSpeakerKeyOf(orphan, byName)).toBeNull();
        }
    });
});

describe("dialogue-only preset", () => {
    it("keeps the dialogue and nothing else, prose included", () => {
        const preset = dialogueOnlyStoryRowFilter();
        expect(storyRowPassesFilter(dialogue, preset, byName)).toBe(true);
        expect(storyRowPassesFilter(otherDialogue, preset, byName)).toBe(true);
        expect(storyRowPassesFilter(tempDialogue, preset, byName)).toBe(true);
        // Narration and notes go too — the preset says 仅对话, not "the prose".
        for (const dropped of [narration, choice, choiceOption, note, expression, background, invalid]) {
            expect(storyRowPassesFilter(dropped, preset, byName)).toBe(false);
        }
    });

    it("recognizes itself, and nothing near it", () => {
        const preset = dialogueOnlyStoryRowFilter();
        expect(isDialogueOnlyStoryRowFilter(preset)).toBe(true);
        expect(isStoryRowFilterActive(preset)).toBe(true);

        expect(isDialogueOnlyStoryRowFilter(filter({ facets: ["dialogue", "narration"] }))).toBe(false);
        expect(isDialogueOnlyStoryRowFilter(filter({ facets: ["narration"] }))).toBe(false);
        // A selected speaker is a filter the preset does not describe — the button must not claim to
        // be on while the page is also narrowed to one name.
        expect(isDialogueOnlyStoryRowFilter(filter({ facets: ["dialogue"], speakers: ["id:c1"] }))).toBe(false);

        expect(isDialogueOnlyStoryRowFilter(EMPTY_STORY_ROW_FILTER)).toBe(false);
        expect(isStoryRowFilterActive(EMPTY_STORY_ROW_FILTER)).toBe(false);
    });
});

describe("the two axes", () => {
    it("shows only the kinds that are ticked", () => {
        const onlyDialogue = filter({ facets: ["dialogue"] });
        expect(storyRowPassesFilter(dialogue, onlyDialogue, byName)).toBe(true);
        expect(storyRowPassesFilter(otherDialogue, onlyDialogue, byName)).toBe(true);
        for (const dropped of [narration, expression, background, note]) {
            expect(storyRowPassesFilter(dropped, onlyDialogue, byName)).toBe(false);
        }
    });

    it("shows only the ticked character's rows, staging included", () => {
        const onlyC1 = filter({ speakers: [speakerKeyForCharacter("c1")] });
        expect(storyRowPassesFilter(dialogue, onlyC1, byName)).toBe(true);
        expect(storyRowPassesFilter(expression, onlyC1, byName)).toBe(true);
        expect(storyRowPassesFilter(transform, onlyC1, byName)).toBe(true);
        expect(storyRowPassesFilter(otherDialogue, onlyC1, byName)).toBe(false);
    });

    it("drops the rows nobody speaks once any name is ticked", () => {
        // Positive selection means what it says: "只看 Nattou" is her rows, not hers plus everything
        // with no owner. Clearing the cast axis is what brings the narration back.
        const onlyC1 = filter({ speakers: [speakerKeyForCharacter("c1")] });
        for (const orphan of [narration, choice, background, note, unassignedDialogue]) {
            expect(storyRowPassesFilter(orphan, onlyC1, byName)).toBe(false);
            expect(storyRowPassesFilter(orphan, EMPTY_STORY_ROW_FILTER, byName)).toBe(true);
        }
    });

    it("ANDs the axes, so the useful combination is expressible", () => {
        const c1Dialogue = filter({ facets: ["dialogue"], speakers: [speakerKeyForCharacter("c1")] });
        expect(storyRowPassesFilter(dialogue, c1Dialogue, byName)).toBe(true);        // both
        expect(storyRowPassesFilter(expression, c1Dialogue, byName)).toBe(false);     // right speaker, wrong kind
        expect(storyRowPassesFilter(otherDialogue, c1Dialogue, byName)).toBe(false);  // right kind, wrong speaker
    });

    it("counts both axes for the toolbar badge", () => {
        expect(storyRowFilterSize(EMPTY_STORY_ROW_FILTER)).toBe(0);
        expect(storyRowFilterSize(filter({ facets: ["sound", "camera"], speakers: ["id:c1"] }))).toBe(3);
    });
});

describe("revealRowInStoryRowFilter", () => {
    it("widens each constrained axis by exactly what the row needs", () => {
        const before = filter({ facets: ["dialogue"], speakers: [speakerKeyForCharacter("c1")] });
        const after = revealRowInStoryRowFilter(otherDialogue, before, byName);
        expect([...after.facets]).toEqual(["dialogue"]);
        expect([...after.speakers]).toEqual([speakerKeyForCharacter("c1"), speakerKeyForCharacter("c2")]);
    });

    it("leaves an axis that was not constraining anything empty", () => {
        // The trap this guards: writing the row's own facet into an empty axis would narrow the page
        // to that facet alone — a filter the author never set.
        const before = filter({ speakers: [speakerKeyForCharacter("c1")] });
        const after = revealRowInStoryRowFilter(otherDialogue, before, byName);
        expect([...after.facets]).toEqual([]);
    });

    it("drops the cast constraint for a row nobody speaks, since no name would satisfy it", () => {
        const before = filter({ speakers: [speakerKeyForCharacter("c1")] });
        const after = revealRowInStoryRowFilter(narration, before, byName);
        expect([...after.speakers]).toEqual([]);
    });

    it("leaves a filter that already passed the row exactly as it was", () => {
        const before = filter({ facets: ["dialogue"], speakers: [speakerKeyForCharacter("c1")] });
        // Same object back, so the caller can skip the write (and the persist) entirely.
        expect(revealRowInStoryRowFilter(dialogue, before, byName)).toBe(before);
        expect(revealRowInStoryRowFilter(narration, EMPTY_STORY_ROW_FILTER, byName)).toBe(EMPTY_STORY_ROW_FILTER);
    });

    it("makes the row pass — which is the whole contract", () => {
        for (const block of [dialogue, expression, transform, background, invalid, tempDialogue, narration]) {
            const before = filter({
                facets: ["sound"],
                speakers: [speakerKeyForCharacter("c9")],
            });
            expect(storyRowPassesFilter(block, revealRowInStoryRowFilter(block, before, byName), byName)).toBe(true);
        }
    });

    it("does not mutate the filter it was given", () => {
        const before = filter({ facets: ["dialogue"], speakers: [speakerKeyForCharacter("c1")] });
        revealRowInStoryRowFilter(expression, before, byName);
        expect([...before.facets]).toEqual(["dialogue"]);
        expect([...before.speakers]).toEqual([speakerKeyForCharacter("c1")]);
    });
});

describe("facet table", () => {
    it("is partitioned into the two sections with nothing missing or counted twice", () => {
        expect([...STORY_ROW_NARRATIVE_FACETS, ...STORY_ROW_STAGING_FACETS]).toEqual([...STORY_ROW_FACETS]);
        expect(new Set(STORY_ROW_FACETS).size).toBe(STORY_ROW_FACETS.length);
    });

    it("shows every row kind by default — nothing ticked is not a filter", () => {
        for (const candidate of [dialogue, narration, choice, note, expression, image, background, jump, condition, invalid]) {
            expect(storyRowPassesFilter(candidate, EMPTY_STORY_ROW_FILTER, byName)).toBe(true);
        }
    });
});

describe("tallyStoryRows", () => {
    const rows = [dialogue, dialogue, narration, expression, tempDialogue, background, otherDialogue];

    it("counts every facet, including the ones with nothing in them", () => {
        const { facets } = tallyStoryRows(rows, byName);
        expect(facets.dialogue).toBe(4);
        expect(facets.narration).toBe(1);
        expect(facets.character).toBe(1);
        expect(facets.scene).toBe(1);
        expect(facets.camera).toBe(0);
        // Every facet answers, so no switch in the menu is missing its number.
        expect(Object.keys(facets).sort()).toEqual([...STORY_ROW_FACETS].sort());
    });

    it("lists the cast in first-appearance order, counting staged rows toward their character", () => {
        const { speakers } = tallyStoryRows(rows, byName);
        expect(speakers.map(entry => [entry.key, entry.count])).toEqual([
            [speakerKeyForCharacter("c1"), 3],
            [speakerKeyForName("Guard"), 1],
            [speakerKeyForCharacter("c2"), 1],
        ]);
        expect(speakers[0].characterId).toBe("c1");
        expect(speakers[1]).toMatchObject({ characterId: null, name: "Guard" });
    });

    it("still lists a hidden speaker with no rows on this page, at zero", () => {
        // Otherwise the tick holding rows back in another scene would have no home in the menu, while
        // the toolbar button went on counting it.
        const { speakers } = tallyStoryRows([narration], byName, [speakerKeyForCharacter("c9")]);
        expect(speakers).toEqual([{ key: speakerKeyForCharacter("c9"), characterId: "c9", name: "", count: 0 }]);
    });
});

describe("normalize", () => {
    it("drops facets this build cannot name, and de-duplicates", () => {
        expect(normalizeStoryRowFacets(["stage", "nope", "stage", 7, null])).toEqual(["stage"]);
        expect(normalizeStoryRowFacets(undefined)).toEqual([]);
        expect(normalizeStoryRowFacets("stage")).toEqual([]);
    });

    it("keeps any well-formed speaker key — the cast is the project's, not a closed vocabulary", () => {
        expect(normalizeStoryRowSpeakers(["id:c1", "name:Guard", "id:c1", "c1", 7])).toEqual(["id:c1", "name:Guard"]);
        expect(normalizeStoryRowSpeakers(undefined)).toEqual([]);
    });
});
