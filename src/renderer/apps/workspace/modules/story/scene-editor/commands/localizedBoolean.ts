import { STORY_BOOLEAN_WORDS } from "@shared/types/story";
import { translateCommand } from "@/lib/i18n";

/**
 * A boolean in the author's command language: `真` / `假` in Chinese, `真` / `偽` in Japanese, `true` /
 * `false` otherwise. The words come from `story.condition.valueTrue` / `valueFalse`, the ones the
 * condition chips and the value switch already use, so a row, a chip and the inspector name a flag the
 * same way.
 *
 * Only a spelling the expression parser reads back is used (`STORY_BOOLEAN_WORDS`): a row never shows a
 * line the editor would refuse, so a translation outside that list falls back to the English word.
 */
export function localizedBooleanWord(value: boolean): string {
    const word = translateCommand(value ? "story.condition.valueTrue" : "story.condition.valueFalse").trim();
    const spellings: readonly string[] = value ? STORY_BOOLEAN_WORDS.true : STORY_BOOLEAN_WORDS.false;
    return spellings.includes(word) ? word : String(value);
}
