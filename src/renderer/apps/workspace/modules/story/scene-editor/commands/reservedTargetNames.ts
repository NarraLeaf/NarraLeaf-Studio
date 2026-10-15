import type { TranslationKey } from "@shared/i18n";
import { translateCommand } from "@/lib/i18n";
import { STORY_RESERVED_TARGETS, type StoryReservedTargetName } from "../storyCommandValues";

/**
 * What a reserved target word is called in the command language: `camera` is 镜头 / カメラ.
 *
 * The word itself stays the spelling on the line. It is a single token every locale parses and every
 * row prints, and a row that printed 基准图层 for `displayableLayer` would be a second spelling for one
 * target. So the name is shown BESIDE the word in the menu, and accepted when typed, the way a command
 * or a param key answers to its translation - but it never replaces the word.
 *
 * `null` when the command language adds nothing: the translation is missing, or it only spells the
 * word again (en "Camera").
 */
export function reservedTargetName(name: StoryReservedTargetName): string | null {
    const key = `story.stage.reserved.${name}` as TranslationKey;
    const raw = translateCommand(key).trim();
    if (!raw || raw === key || raw.toLowerCase() === name.toLowerCase()) {
        return null;
    }
    return raw;
}

/**
 * The reserved word an author-typed name spells, among the words this slot answers to, or null.
 *
 * Only a single token can be typed into a target slot, so a name with a space in it is shown and
 * never matched; and a name that spells some reserved word's own token is left to that token.
 */
export function matchReservedTargetName(
    reserved: readonly StoryReservedTargetName[],
    raw: string,
): StoryReservedTargetName | null {
    const needle = raw.trim().toLowerCase();
    if (!needle || /\s/.test(needle) || STORY_RESERVED_TARGETS.some(word => word.toLowerCase() === needle)) {
        return null;
    }
    return reserved.find(word => reservedTargetName(word)?.toLowerCase() === needle) ?? null;
}
