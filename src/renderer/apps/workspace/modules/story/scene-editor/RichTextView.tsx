import { useCallback, useEffect, useRef } from "react";
import type { StoryDocument, StoryInterpolationRef, StorySceneId, StoryTextSegment } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { renderRunsToElement, segmentToRuns } from "./richText";
import { resolveInterpolationName } from "./storyInterpolation";

/**
 * Read-only WYSIWYG rendering of a text segment: rich marks are applied inline; pause and
 * interpolation runs render as compact read-only chips (shown in the row preview). Pass
 * `document` + `sceneId` to resolve interpolation variable names.
 *
 * Delegates to `renderRunsToElement` — the very builder the editor renders with — rather than
 * re-describing the same runs in JSX. Two renderers drift (this one used to silently drop `ruby`
 * and `cps`), and the unit model keys off the `data-pause` / `data-interp` attributes only that
 * builder emits: sharing it is what lets a selection made in this preview map onto the editor's
 * unit offsets when the row enters edit mode.
 */
export function RichTextView(props: {
    segment: StoryTextSegment;
    className?: string;
    document?: StoryDocument;
    sceneId?: StorySceneId;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLSpanElement | null>(null);
    const { segment, document: storyDocument, sceneId } = props;

    const resolveLabel = useCallback(
        (interp: StoryInterpolationRef) => (
            storyDocument && sceneId
                ? resolveInterpolationName(storyDocument, sceneId, [], interp)
                : t("story.richText.valueFallback")
        ),
        [storyDocument, sceneId, t],
    );

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        renderRunsToElement(root, segmentToRuns(segment), {
            resolveLabel,
            titles: {
                pauseClick: t("story.richText.pauseClick"),
                pauseSeconds: seconds => t("story.richText.pauseSeconds", { seconds }),
                insertedValue: name => t("story.richText.insertedValue", { name }),
                valueFallback: t("story.richText.valueFallback"),
                expressionEvent: t("story.richText.expressionEvent"),
                soundEvent: t("story.richText.soundEvent"),
            },
        });
    }, [segment, resolveLabel, t]);

    return <span ref={rootRef} className={props.className} />;
}
