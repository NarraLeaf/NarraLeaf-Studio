/**
 * The voice controls on a spoken story row. Shows nothing until the line actually has a take in the
 * project's primary voice language, so a project without voice — or a line no one has voiced — sees no
 * new chrome.
 *
 * Two controls, in this order and deliberately not the other way round:
 *  - a mic that jumps to that language's voice table, where assignment lives. Always visible, because
 *    it is the mark that says "this line is voiced" while an author is reading, and warning-coloured
 *    when the line changed after the take was imported. A signal, not an action.
 *  - a speaker that plays the take, LAST and hover-only. It is a thing you reach for, not a thing you
 *    read, so it stays out of the reading surface until the pointer is on the row. It carries a
 *    speaker rather than a transport triangle for the same reason: what it means is "hear this line",
 *    not "start the player".
 *
 * Hover-only holds while a clip is playing too — the icon takes the accent colour there, but it does
 * not pin itself open. Moving off the row leaves the take running to its end; coming back gives the
 * control (now a stop) again.
 *
 * Read-only by design: the story editor surfaces and auditions voice, the voice table manages it.
 * Comments in English per project convention.
 */

import { Mic, Volume2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { StoryBlock } from "@shared/types/story";
import { useStoryVoiceState } from "./useStoryVoiceState";

export function StoryVoiceIndicator({ block }: { block: StoryBlock }) {
    const { t } = useTranslation();
    const voice = useStoryVoiceState(block);

    if (!voice.segment || !voice.primary || !voice.hasTake) {
        // No take for this line — the story editor stays clean; voice it in the voice table.
        return null;
    }

    const auditionLabel = voice.isPlaying ? t("story.rows.voiceStop") : t("story.rows.voicePlay");
    const tableLabel = voice.stale ? t("story.rows.voiceOutdated") : t("story.rows.voiceManage");

    // Both buttons name themselves through `aria-label` rather than leaning on `title` as the
    // last-resort accessible name: it is the convention the rest of the row cluster uses, and it keeps
    // the name from depending on whether a tooltip is exposed at all.
    return (
        <>
            <button
                type="button"
                tabIndex={-1}
                title={tableLabel}
                aria-label={tableLabel}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-fill hover:text-fg ${
                    voice.stale ? "text-warning" : "text-fg-subtle"
                }`}
                onClick={event => {
                    event.stopPropagation();
                    voice.openVoiceTable();
                }}
            >
                <Mic className="h-3.5 w-3.5" />
            </button>
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
        </>
    );
}
