import { useMemo } from "react";
import type { CSSProperties } from "react";
import { TextsPreview, Word } from "narraleaf-react";
import type { UITextRun } from "@shared/types/ui-editor/textRuns";
import { storyMarksToWordConfig } from "@shared/utils/storyTextMarks";
import { lineWrapCss } from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import type { TextWrapMode } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import type {
    TextOrientation,
    TextWritingMode,
} from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";

/**
 * The class the engine's word container carries inside a label, so the rule in `styles.css` can
 * reach the elements it builds. See that rule for what it does and why it has to be a rule.
 */
export const TEXT_RUNS_CLASS = "nl-text-runs";

/**
 * The label's runs as the engine's words.
 *
 * `storyMarksToWordConfig` is the single statement of what a mark means to the runtime, and it is
 * the one the dialogue compiler uses: bold, italic, colour, the reading, the emphasis convention
 * and the size step reach the engine here exactly as they reach it from a line of dialogue.
 *
 * Memoised on the runs' content because {@link TextsPreview} takes the array as an effect
 * dependency, and the document hands out a fresh array on every read: an unmemoised array would
 * re-run that effect, which sets state, which renders again.
 */
export function useTextRunWords(runs: UITextRun[] | null): Word[] | null {
    const key = runs ? JSON.stringify(runs) : "";
    return useMemo(() => {
        if (!key) {
            return null;
        }
        const parsed = JSON.parse(key) as UITextRun[];
        return parsed.map(run => new Word(run.text, storyMarksToWordConfig(run.marks ?? {}) as never));
    }, [key]);
}

export type TextRunsBodyProps = {
    words: Word[];
    writingMode: TextWritingMode;
    textOrientation: TextOrientation;
    tateChuYoko: boolean;
    tateChuYokoMaxLength: number;
    textWrapMode: TextWrapMode;
    /** What a bold run is set at, given the weight the label itself is set at. */
    fontWeightBold: CSSProperties["fontWeight"];
};

/**
 * A label's marked text, drawn by the engine's own word renderer.
 *
 * The same renderer the dialogue box uses, with the typewriter turned off: a label reveals nothing,
 * so every word is already settled and the effect that would type them out sets them all at once
 * and stops. What that buys is that ruby, the four emphasis conventions, a relative size step and
 * vertical writing with its short runs set upright are drawn here exactly as they are drawn in
 * dialogue, rather than by a second description of the same typography.
 *
 * Nothing about the label's own appearance is passed in: size, colour, weight and family are left
 * off so that every word inherits them from the paragraph this sits in, and only a word's own marks
 * are written on it. That is what lets the paragraph keep carrying the authored style - including a
 * size auto fit has brought down and a colour that is mid-transition - with the marks relative to
 * it.
 */
export function TextRunsBody({
    words,
    writingMode,
    textOrientation,
    tateChuYoko,
    tateChuYokoMaxLength,
    textWrapMode,
    fontWeightBold,
}: TextRunsBodyProps) {
    return (
        <TextsPreview
            className={TEXT_RUNS_CLASS}
            words={words}
            useTypeEffect={false}
            loop={false}
            fontWeightBold={fontWeightBold}
            writingMode={writingMode}
            textOrientation={textOrientation}
            tateChuYoko={tateChuYoko ? tateChuYokoMaxLength : false}
            // Written here as well as on the paragraph: the engine's container declares
            // `white-space: pre-wrap` in a class of its own, which an inherited value would lose to.
            style={lineWrapCss(textWrapMode)}
        />
    );
}
