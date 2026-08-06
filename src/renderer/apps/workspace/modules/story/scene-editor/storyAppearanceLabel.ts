import type { StoryCharacterTagSelection } from "@shared/types/story";

/**
 * An appearance as a row stores it.
 *
 * Structural rather than one of the two payload types, because it IS the same selection written into
 * two places: a `/face` action's payload, and the inline expression event a dialogue line carries.
 * Only the action can name a puppet's look — an inline event always targets a character Studio draws.
 */
export type StoryAppearanceSelection = {
    characterId?: string;
    pose?: string;
    tags?: StoryCharacterTagSelection;
    puppetName?: string;
};

/** The author-facing name behind a pose / tag id, or `null` when it resolves to nothing. */
export type StoryAppearanceNameLookup = (characterId: string, refId: string) => string | null;

/**
 * Which appearance a row switches to, as the author's own word — for the surfaces that show the
 * switch without room for the command line that made it: a dialogue line's inline event chip, and the
 * plain projection of that same line.
 *
 * Both storage shapes are ids (`pose` for a `preset` character, one `tags` entry per axis for a
 * `layered` one), so a surface without the lookup can only print an id, and an id printed into a
 * paragraph reads as `pro5swd`. The lookup is the one a typed `/face` line resolves against, which is
 * the point: the chip and the line say the same word.
 *
 * Every named axis is listed, unlike `appearanceWord` in the command line, which declines to name a
 * multi-axis selection. The two are answering different questions: that one fills ONE slot of a
 * sentence and must not claim the author chose a single look, while this chip's whole content is
 * "what changed here", and a change across two axes changed both.
 *
 * `null` when nothing resolves — a deleted pose, or a surface with no lookup at all. The caller falls
 * back to the bare chip, because "the face changes here" is true and an id is not an answer.
 */
export function storyAppearanceLabel(
    appearance: StoryAppearanceSelection,
    appearanceName: StoryAppearanceNameLookup | undefined,
): string | null {
    // A puppet's expression is a name its own model owns: there is nothing to look up, and the stored
    // string IS the word the author typed.
    const puppetName = appearance.puppetName?.trim();
    if (puppetName) {
        return puppetName;
    }
    const characterId = appearance.characterId;
    if (!characterId || !appearanceName) {
        return null;
    }
    const ids = [
        ...(appearance.pose ? [appearance.pose] : []),
        ...Object.values(appearance.tags ?? {}),
    ];
    const names = ids
        .map(id => appearanceName(characterId, id))
        .filter((name): name is string => Boolean(name?.trim()));
    return names.length > 0 ? names.join(" · ") : null;
}
