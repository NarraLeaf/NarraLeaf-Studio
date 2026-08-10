import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StoryDocument, StoryInterpolationRef, StorySceneId, StoryTextSegment } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { renderRunsToElement, segmentToRuns } from "./richText";
import { storyAppearanceLabel, type StoryAppearanceSelection } from "./storyAppearanceLabel";
import { useStoryCommandLineContext } from "./StoryCommandLineView";
import { resolveInterpolationName, type PersistentVariableOption, type SavedVariableOption } from "./storyInterpolation";

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
    // Off the row context rather than a prop: the appearance table is per-tab, and a scene is hundreds
    // of rows. Outside the provider it is simply absent, and an expression chip stays icon-only.
    const { appearanceName, commandContext } = useStoryCommandLineContext();

    /**
     * The two PROJECT scopes' variables, taken off the per-tab command context rather than read from
     * the registry here — a service subscription per row is what this context exists to avoid.
     *
     * Without them a `{好感}` chip on a registry-declared variable prints the word reserved for a
     * declaration that was DELETED, so a row the compiler resolves perfectly well reads as broken.
     * Each scope is keyed the way its own ref addresses an entry: `saved` by id, `persistent` by
     * storage key (which is what a persistent ref's `variableId` is).
     */
    const savedRegistry = useMemo<SavedVariableOption[]>(
        () => (commandContext?.variables ?? [])
            .filter(entry => entry.ref.scope === "saved")
            .map(entry => ({ id: entry.ref.variableId, name: entry.name, valueType: entry.valueType })),
        [commandContext],
    );
    const persistentRegistry = useMemo<PersistentVariableOption[]>(
        () => (commandContext?.variables ?? [])
            .filter(entry => entry.ref.scope === "persistent")
            .map(entry => ({ storageKey: entry.ref.variableId, name: entry.name, valueType: entry.valueType })),
        [commandContext],
    );

    const resolveLabel = useCallback(
        (interp: StoryInterpolationRef) => (
            storyDocument && sceneId
                ? resolveInterpolationName(storyDocument, sceneId, persistentRegistry, interp, savedRegistry)
                : t("story.richText.valueFallback")
        ),
        [storyDocument, sceneId, persistentRegistry, savedRegistry, t],
    );

    const resolveAppearance = useCallback(
        (appearance: StoryAppearanceSelection) => storyAppearanceLabel(appearance, appearanceName),
        [appearanceName],
    );

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        renderRunsToElement(root, segmentToRuns(segment), {
            resolveLabel,
            resolveAppearance,
            titles: {
                pauseClick: t("story.richText.pauseClick"),
                pauseSeconds: seconds => t("story.richText.pauseSeconds", { seconds }),
                insertedValue: name => t("story.richText.insertedValue", { name }),
                valueFallback: t("story.richText.valueFallback"),
                expressionEvent: t("story.richText.expressionEvent"),
                soundEvent: t("story.richText.soundEvent"),
            },
        });
    }, [segment, resolveLabel, resolveAppearance, t]);

    return <span ref={rootRef} className={props.className} />;
}
