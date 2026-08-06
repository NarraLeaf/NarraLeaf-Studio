/**
 * The audition control on a spoken story row: one speaker, hover-only, and nothing else.
 *
 * It used to sit next to an always-visible mic that marked the line as voiced and jumped to the
 * voice table. Both are gone. The story editor is the surface an author spends the day in, so every
 * element on a row has to earn its place, and a column of a dozen identical mics is a texture rather
 * than information - it tells you nothing you cannot read in the voice table, which is where voice
 * coverage and staleness actually belong. A per-line status mark is the voice module's job; the
 * story's job is the words.
 *
 * What stays is the one thing you can only want *here*: hearing this line while reading it. It
 * hover-reveals like the rest of the row's actions, it carries a speaker rather than a transport
 * triangle because it means "hear this line" rather than "start the player", and it does not pin
 * itself open while a clip plays - it only takes the accent colour.
 *
 * Still read-only: assignment lives in the voice table. The inspector keeps a fuller voice section
 * (status, staleness, a jump) for when a row is actually selected and being worked on.
 * Comments in English per project convention.
 */

import { Volume2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { StoryBlock } from "@shared/types/story";
import { useStoryVoiceState } from "./useStoryVoiceState";

export function StoryVoiceIndicator({ block }: { block: StoryBlock }) {
    const { t } = useTranslation();
    const voice = useStoryVoiceState(block);

    if (!voice.segment || !voice.primary || !voice.hasTake) {
        // No take for this line - nothing to hear, so no control.
        return null;
    }

    const auditionLabel = voice.isPlaying ? t("story.rows.voiceStop") : t("story.rows.voicePlay");

    // Named through `aria-label` rather than leaning on `title` as the last-resort accessible name:
    // it is the convention the rest of the row cluster uses, and it keeps the name from depending on
    // whether a tooltip is exposed at all.
    return (
        <button
            type="button"
            tabIndex={-1}
            title={auditionLabel}
            aria-label={auditionLabel}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition hover:bg-fill hover:text-fg group-hover:opacity-100 ${
                voice.isPlaying ? "text-primary" : "text-fg-subtle"
            }`}
            onClick={event => {
                event.stopPropagation();
                voice.toggleAudition();
            }}
        >
            <Volume2 className="h-3.5 w-3.5" />
        </button>
    );
}
