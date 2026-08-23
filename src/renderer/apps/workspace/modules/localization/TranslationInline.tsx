/**
 * The half of the translation table that knows what a line looks like.
 *
 * A translation carries the line's styling by naming its runs - `‹1›…‹/1›` for a styled span, `‹2/›`
 * for a pause or a portrait change, `{0}` for a value. Every other tool a translator might open the
 * file in has to show those as codes, because a `.po` file has no idea what run 1 is. Studio does
 * know, and this is where it says so: the source reads as the line reads, the translation is written
 * the same way, and the tags are placed from a palette instead of typed.
 *
 * Everything here renders through `renderRunsToElement` and edits through `RichTextInput` - the very
 * builder and the very field the story editor uses. A second renderer for the same runs is how the
 * two would come to disagree about what a line looks like, and the translator is precisely the person
 * who cannot check.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { StoryRichRun, StoryTextMarks } from "@shared/types/story";
import { targetFromTranslationRuns, translationRunsFromTarget } from "@shared/utils/localizationText";
import { useTranslation } from "@/lib/i18n";
import { TooltipGroup } from "@/lib/tooltip";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import {
    renderRunsToElement,
    unitOffsetFromPoint,
    type RichRenderOptions,
} from "@/apps/workspace/modules/story/scene-editor/richText";
import { RichTextInput, type RichTextInputHandle } from "@/apps/workspace/modules/story/scene-editor/RichTextInput";

/** How much of a styled run's own words a palette button shows: enough to recognise, short enough to sit in a row. */
const SAMPLE_LENGTH = 6;

/**
 * Chip copy for the read-only renderings and the field alike.
 *
 * The story catalogue rather than a second set of strings: these are the same chips, and a pause that
 * reads "Pause 0.4s" in the script must not read anything else here.
 */
function useRenderOptions(): RichRenderOptions {
    const { t } = useTranslation();
    return useMemo(() => ({
        titles: {
            pauseClick: t("story.richText.pauseClick"),
            pauseSeconds: seconds => t("story.richText.pauseSeconds", { seconds }),
            insertedValue: name => t("story.richText.insertedValue", { name }),
            valueFallback: t("story.richText.valueFallback"),
            expressionEvent: t("story.richText.expressionEvent"),
            soundEvent: t("story.richText.soundEvent"),
        },
    }), [t]);
}

/** Runs drawn read-only, exactly as the story editor draws a row it is not editing. */
export function InlineRuns(props: { runs: StoryRichRun[]; className?: string }) {
    const options = useRenderOptions();
    const rootRef = useRef<HTMLSpanElement | null>(null);
    useEffect(() => {
        if (rootRef.current) {
            renderRunsToElement(rootRef.current, props.runs, options);
        }
    }, [props.runs, options]);
    return <span ref={rootRef} data-inline-runs className={props.className} />;
}

/** A styled source run, as the palette offers it. */
type StyledRun = { text: string; marks: StoryTextMarks };

function styledRunsOf(sourceRuns: readonly StoryRichRun[]): StyledRun[] {
    const out: StyledRun[] = [];
    for (const run of sourceRuns) {
        if ("text" in run && run.marks) {
            out.push({ text: run.text, marks: run.marks });
        }
    }
    return out;
}

/**
 * The line's tags as buttons: the styled runs, then the tokens that stand on their own.
 *
 * A styled run shows its own words wearing its own marks, which is the only label that needs no
 * explaining - a translator who sees the dotted phrase knows what pressing it does. The number never
 * appears: it is how the file spells the tag, not something a person should have to carry.
 */
function TagPalette(props: { sourceRuns: StoryRichRun[]; editor: RefObject<RichTextInputHandle | null> }) {
    const { t } = useTranslation();
    const styled = styledRunsOf(props.sourceRuns);
    const tokens = props.sourceRuns.filter(run => "pause" in run || "event" in run || "interpolation" in run);

    // The field owns the caret and a press must not take it: a mark lands on a live selection, and
    // focusing a button would collapse it first.
    const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

    return (
        <TooltipGroup className="flex flex-wrap items-center gap-1 px-2">
            {styled.map((run, index) => (
                <button
                    key={`s${index}`}
                    type="button"
                    className="grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs transition-colors hover:bg-fill"
                    onMouseDown={keepSelection}
                    onClick={() => props.editor.current?.applyMarks(run.marks)}
                    data-tip={t("workspace.localization.table.applyStyle")}
                    aria-label={t("workspace.localization.table.applyStyle")}
                >
                    <InlineRuns runs={[{ text: run.text.slice(0, SAMPLE_LENGTH), marks: run.marks }]} />
                </button>
            ))}
            {tokens.map((run, index) => (
                <button
                    key={`t${index}`}
                    type="button"
                    className="grid h-6 place-items-center rounded-md px-0.5 transition-colors hover:bg-fill"
                    onMouseDown={keepSelection}
                    onClick={() => {
                        const editor = props.editor.current;
                        if (!editor) {
                            return;
                        }
                        if ("pause" in run) {
                            editor.insertPause(run.pause);
                        } else if ("event" in run) {
                            editor.insertEvent(run.event);
                        } else if ("interpolation" in run) {
                            editor.insertInterpolation(run.interpolation);
                        }
                    }}
                    data-tip={t("workspace.localization.table.placeToken")}
                    aria-label={t("workspace.localization.table.placeToken")}
                >
                    <InlineRuns runs={[run]} />
                </button>
            ))}
            {styled.length > 0 ? (
                <ToolbarButton
                    size="xs"
                    className="w-auto px-1.5 text-2xs"
                    onMouseDown={keepSelection}
                    onClick={() => props.editor.current?.applyMarks(null)}
                    data-tip={t("workspace.localization.table.clearStyle")}
                    aria-label={t("workspace.localization.table.clearStyle")}
                >
                    {t("workspace.localization.table.clearStyleShort")}
                </ToolbarButton>
            ) : null}
        </TooltipGroup>
    );
}

/**
 * A translation of a line that carries tags: rendered when it is not being edited, and the story
 * editor's own field when it is.
 *
 * One row at a time holds the field, the way one row at a time holds the story editor's. A table of
 * three hundred contentEditables is three hundred spellcheckers and three hundred selection
 * listeners, and only one of them can have the caret anyway.
 */
export function InlineTargetEditor(props: {
    unitId: string;
    sourceRuns: StoryRichRun[];
    target: string;
    editing: boolean;
    /** Where the pointer landed when the row was opened, as a unit offset. `null` lands at the end. */
    caret: number | null;
    placeholder: string;
    ariaLabel: string;
    onEdit: (caret: number | null) => void;
    onStopEdit: () => void;
    onTargetChange: (target: string) => void;
}) {
    const editor = useRef<RichTextInputHandle | null>(null);
    const runs = useMemo(
        () => translationRunsFromTarget(props.target, props.sourceRuns),
        [props.target, props.sourceRuns],
    );

    /**
     * `mousedown`, not `pointerdown`: the story editor's rows enter on the same event, and it is the
     * one a scripted acceptance pass can reach.
     *
     * ⚠ `preventDefault` is what makes the field open at all. The press swaps this element for the
     * field, which focuses itself on mount - and the browser then completes the press by focusing
     * whatever is under the pointer, taking the focus straight back off it. The field's own `onBlur`
     * closes it, so without this the row opens and shuts inside one click and nothing appears to
     * have happened.
     */
    const openAtPointer = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        // Read the offset off the rendered text before the swap, so the caret lands where it was aimed.
        const rendered = event.currentTarget.querySelector<HTMLElement>("[data-inline-runs]");
        props.onEdit(rendered ? unitOffsetFromPoint(rendered, event.clientX, event.clientY) : null);
    }, [props]);

    const openFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onEdit(null);
        }
    }, [props]);

    if (!props.editing) {
        return (
            <div
                className="min-h-8 w-full cursor-text rounded-md border border-transparent px-2 py-1.5 text-sm leading-relaxed text-fg hover:border-edge-subtle"
                role="button"
                tabIndex={0}
                aria-label={props.ariaLabel}
                onMouseDown={openAtPointer}
                onKeyDown={openFromKeyboard}
            >
                {runs.length > 0
                    ? <InlineRuns runs={runs} className="whitespace-pre-wrap" />
                    : <span className="text-fg-subtle">{props.placeholder}</span>}
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <RichTextInput
                key={props.unitId}
                ref={editor}
                initialRuns={runs}
                initialCaret={props.caret === null ? "end" : { start: props.caret, end: props.caret }}
                className="min-h-8 w-full rounded-md border border-edge bg-surface-sunken px-2 py-1.5 text-sm leading-relaxed text-fg outline-none"
                placeholder={props.placeholder}
                onChange={(_value, next) => props.onTargetChange(targetFromTranslationRuns(next, props.sourceRuns))}
                // A translation is one line and this table is not the story: none of the keys that move
                // between rows there mean anything here, and Enter leaving the field is what a one-line
                // editor does.
                onEnter={props.onStopEdit}
                onShiftEnter={props.onStopEdit}
                onExit={props.onStopEdit}
                onBlur={props.onStopEdit}
            />
            <TagPalette sourceRuns={props.sourceRuns} editor={editor} />
        </div>
    );
}
