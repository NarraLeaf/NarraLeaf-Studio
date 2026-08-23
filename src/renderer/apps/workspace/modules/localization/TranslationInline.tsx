/**
 * The half of the translation table that knows what a line looks like.
 *
 * A translation carries the line's styling by naming its runs. Every other tool a translator might
 * open the file in has to show those names as codes, because a `.po` file has no idea what run 1 is.
 * Studio does know, and this is where it says so: the source reads as the line reads, and the tags
 * in the translation are objects - a bracket the caret steps over, a pause chip, a value chip -
 * rather than four characters to be typed and mistyped.
 *
 * Everything is drawn by `renderRunsToElement`, the story editor's own builder. A second renderer
 * for the same runs is how the two would come to disagree about what a line looks like, and the
 * translator is precisely the person who cannot check.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject, ReactNode } from "react";
import type { StoryRichRun } from "@shared/types/story";
import type { TranslationToken } from "@shared/utils/localizationText";
import { useTranslation } from "@/lib/i18n";
import { TooltipGroup } from "@/lib/tooltip";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { compositionHandlers, isComposingText, isImeKeyEvent } from "@/lib/utils/imeComposition";
import { renderRunsToElement, type RichRenderOptions } from "@/apps/workspace/modules/story/scene-editor/richText";
import {
    caretOffsetIn,
    printTranslationTokens,
    renderTranslationTokens,
    setCaretOffset,
    translationTokens,
    translationTokensFromDom,
} from "./translationField";

/**
 * Chip copy for every rendering here.
 *
 * The story catalogue rather than a second set of strings: these are the same chips, and a pause
 * that reads "Pause 0.4s" in the script must not read anything else here.
 */
function useRenderOptions(): RichRenderOptions {
    const { t } = useTranslation();
    return useMemo(() => ({
        // Never interactive. A chip in a translation is a thing to place, not a setting to change:
        // the pause belongs to the line, and a translator who could open it could edit the script.
        interactive: false,
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

/**
 * A translation drawn read-only, without its brackets: the line as the player will read it.
 *
 * This is the preview half of the arrangement. The field shows where each range begins and ends
 * because that is what a translator is moving; the row at rest shows the result, because that is
 * what the translation is for.
 */
function InlineTokens(props: { tokens: TranslationToken[]; sourceRuns: StoryRichRun[]; className?: string }) {
    const options = useRenderOptions();
    const rootRef = useRef<HTMLSpanElement | null>(null);
    useEffect(() => {
        if (rootRef.current) {
            renderTranslationTokens(rootRef.current, props.tokens, props.sourceRuns, options, { brackets: false });
        }
    }, [props.tokens, props.sourceRuns, options]);
    return <span ref={rootRef} data-inline-runs className={props.className} />;
}

/**
 * The field itself: a contentEditable holding the tokens, with the tags as elements the caret steps
 * over rather than enters.
 *
 * The DOM is the working copy while the translator types, which is what keeps the browser's own
 * undo, its own IME and its own caret behaviour intact - all three are things a re-render on every
 * keystroke takes away. It is redrawn only when a tag is placed, and the caret is put back by
 * counting positions, because that edit changes the shape of the line rather than its letters.
 */
/** A token a palette button places: never text, always one of the line's own tags. */
type PlaceableToken = Exclude<TranslationToken, { kind: "text" }>;

export type TranslationFieldHandle = {
    /** Place a token at the caret, or wrap the selection when the token is a style. */
    place: (token: PlaceableToken, closing?: PlaceableToken) => void;
    focus: () => void;
};

function TranslationField(props: {
    target: string;
    sourceRuns: StoryRichRun[];
    placeholder: string;
    ariaLabel: string;
    caret: number | null;
    fieldRef: MutableRefObject<TranslationFieldHandle | null>;
    onChange: (target: string) => void;
    onDone: () => void;
}) {
    const options = useRenderOptions();
    const rootRef = useRef<HTMLDivElement | null>(null);
    /** What this field last emitted, so an echo of its own value never redraws it under the caret. */
    const emitted = useRef(props.target);
    const composing = useRef(false);

    const emit = useCallback(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const value = printTranslationTokens(translationTokensFromDom(root));
        emitted.current = value;
        props.onChange(value);
    }, [props]);

    /**
     * Enter and Escape leave the field - unless an input method is composing, where both belong to
     * the candidate window: Enter confirms the conversion and Escape cancels it. Taking either one
     * there ends the line the translator is halfway through writing.
     */
    const onFieldKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (isImeKeyEvent(event)) {
            return;
        }
        // The table is not the story: none of the keys that move between rows there mean anything
        // here, and a translation is one line.
        event.stopPropagation();
        if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            props.onDone();
        }
    }, [props]);

    const redraw = useCallback((tokens: TranslationToken[], caret: number) => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        renderTranslationTokens(root, tokens, props.sourceRuns, options);
        setCaretOffset(root, caret);
        emit();
    }, [emit, options, props.sourceRuns]);

    // Draw once, on the way in. Everything after that is the browser's edit of this DOM.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        renderTranslationTokens(root, translationTokens(props.target), props.sourceRuns, options);
        root.focus();
        setCaretOffset(root, props.caret ?? Number.MAX_SAFE_INTEGER);
        // Mount only: a redraw while the translator is typing would take their caret with it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    props.fieldRef.current = {
        focus: () => rootRef.current?.focus(),
        place: (token, closing) => {
            const root = rootRef.current;
            const selection = globalThis.window.getSelection();
            if (!root || !selection || selection.rangeCount === 0) {
                return;
            }
            const range = selection.getRangeAt(0);
            const start = caretOffsetIn(root, range.startContainer, range.startOffset);
            const end = caretOffsetIn(root, range.endContainer, range.endOffset);
            const tokens = translationTokensFromDom(root);
            if (closing) {
                // Pressing a style the caret is already inside takes that range off, rather than
                // opening a second one inside the first. A tag is a thing the translator places, so
                // the button that places it is the button that picks it back up.
                const enclosing = enclosingRange(tokens, token.index, start);
                if (enclosing) {
                    const without = tokens.filter((_, index) => index !== enclosing.open && index !== enclosing.close);
                    redraw(without, Math.max(0, start - 1));
                    return;
                }
                // A style wraps what is selected; with nothing selected it opens and closes on the
                // spot, which is how a translator marks a range before typing into it.
                const flat = splitAt(tokens, [start, end]);
                flat.splice(indexAt(flat, end), 0, closing);
                flat.splice(indexAt(flat, start), 0, token);
                redraw(flat, end + 2);
                return;
            }
            const flat = splitAt(tokens, [start]);
            flat.splice(indexAt(flat, start), 0, token);
            redraw(flat, start + 1);
        },
    };

    return (
        <div
            ref={rootRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            aria-label={props.ariaLabel}
            data-placeholder={props.placeholder}
            className="nl-translation-field min-h-[3.25rem] w-full rounded-md border border-primary/50 bg-surface-raised px-2 py-1.5 text-sm leading-relaxed text-fg outline-none"
            onInput={() => {
                if (!composing.current) {
                    emit();
                }
            }}
            onCompositionStart={() => {
                composing.current = true;
                compositionHandlers.onCompositionStart();
            }}
            onCompositionEnd={() => {
                composing.current = false;
                compositionHandlers.onCompositionEnd();
                emit();
            }}
            onPaste={event => {
                // Plain text only: a translation carries the line's tags, and nothing a clipboard can
                // bring in is one of them.
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain").replace(/\r?\n/g, " ");
                globalThis.document.execCommand("insertText", false, text);
            }}
            onKeyDown={onFieldKeyDown}
            onBlur={() => {
                // Composing on macOS opens a real native window, and the web contents fire `blur` on
                // the field while it does. Closing the row there would take the input out from under
                // the input method halfway through a word.
                if (!isComposingText()) {
                    props.onDone();
                }
            }}
        />
    );
}

/**
 * The open/close pair of style `index` that `offset` falls inside, or null.
 *
 * An unclosed range counts as reaching the end of the line, which is what it does when the line is
 * rendered - so pressing its button takes it off from anywhere after it.
 */
function enclosingRange(
    tokens: readonly TranslationToken[],
    index: number,
    offset: number,
): { open: number; close: number } | null {
    let position = 0;
    let openAt: number | null = null;
    let openOffset = 0;
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.kind === "open" && token.index === index) {
            openAt = i;
            openOffset = position;
        } else if (token.kind === "close" && token.index === index && openAt !== null) {
            if (offset > openOffset && offset <= position) {
                return { open: openAt, close: i };
            }
            openAt = null;
        }
        position += token.kind === "text" ? token.text.length : 1;
    }
    return openAt !== null && offset > openOffset ? { open: openAt, close: -1 } : null;
}

/** Split text tokens so that every offset in `points` falls on a token boundary. */
function splitAt(tokens: readonly TranslationToken[], points: readonly number[]): TranslationToken[] {
    const wanted = [...new Set(points)].sort((a, b) => a - b);
    const out: TranslationToken[] = [];
    let offset = 0;
    for (const token of tokens) {
        if (token.kind !== "text") {
            out.push(token);
            offset += 1;
            continue;
        }
        let text = token.text;
        let cursor = offset;
        for (const point of wanted) {
            const local = point - cursor;
            if (local > 0 && local < text.length) {
                out.push({ kind: "text", text: text.slice(0, local) });
                text = text.slice(local);
                cursor = point;
            }
        }
        out.push({ kind: "text", text });
        offset += token.text.length;
    }
    return out;
}

/** The token index at caret offset `target`, after {@link splitAt} has made it a boundary. */
function indexAt(tokens: readonly TranslationToken[], target: number): number {
    let offset = 0;
    for (let index = 0; index < tokens.length; index += 1) {
        if (offset >= target) {
            return index;
        }
        const token = tokens[index];
        offset += token.kind === "text" ? token.text.length : 1;
    }
    return tokens.length;
}

/**
 * The line's tags as buttons that place them.
 *
 * A styled run shows its own words wearing its own marks, and a token shows its own chip: the label
 * needs no explaining, and the number the file writes never appears. A tag already in the
 * translation is drawn quiet - the translator has placed it, and what they are looking for in this
 * strip is the one they have not.
 */
function TagPalette(props: {
    sourceRuns: StoryRichRun[];
    placed: ReadonlySet<string>;
    onPlace: (token: PlaceableToken, closing?: PlaceableToken) => void;
}) {
    const { t } = useTranslation();
    const entries: { key: string; label: ReactNode; tip: string; place: () => void }[] = [];
    let valueOrdinal = 0;
    props.sourceRuns.forEach((run, index) => {
        if ("text" in run && run.marks) {
            entries.push({
                key: `r${index}`,
                label: <InlineRuns runs={[{ text: run.text.slice(0, 6), marks: run.marks }]} />,
                tip: t("workspace.localization.table.applyStyle"),
                place: () => props.onPlace({ kind: "open", index }, { kind: "close", index }),
            });
            return;
        }
        if ("pause" in run || "event" in run) {
            entries.push({
                key: `r${index}`,
                label: <InlineRuns runs={[run]} />,
                tip: t("workspace.localization.table.placeToken"),
                place: () => props.onPlace({ kind: "standalone", index }),
            });
            return;
        }
        if ("interpolation" in run) {
            const ordinal = valueOrdinal;
            valueOrdinal += 1;
            entries.push({
                key: `v${ordinal}`,
                label: <InlineRuns runs={[run]} />,
                tip: t("workspace.localization.table.placeToken"),
                place: () => props.onPlace({ kind: "value", index: ordinal }),
            });
        }
    });

    if (entries.length === 0) {
        return null;
    }

    return (
        <TooltipGroup className="flex flex-wrap items-center gap-1 pl-2">
            <span className="mr-0.5 text-2xs leading-6 text-fg-subtle">{t("workspace.localization.table.tagsLabel")}</span>
            {entries.map(entry => (
                <button
                    key={entry.key}
                    type="button"
                    className={`grid h-6 min-w-6 place-items-center rounded-md border border-edge-subtle px-1.5 text-xs transition-colors hover:border-edge-strong hover:bg-fill ${
                        props.placed.has(entry.key) ? "opacity-40" : ""
                    }`}
                    // The field owns the caret and a press must not take it: the token lands where the
                    // translator left the caret, and focusing a button would move it first.
                    onMouseDown={event => event.preventDefault()}
                    onClick={entry.place}
                    data-tip={entry.tip}
                    aria-label={entry.tip}
                >
                    {entry.label}
                </button>
            ))}
        </TooltipGroup>
    );
}

/** Which of the line's tags the translation already carries, keyed the way the palette keys them. */
function placedTags(tokens: readonly TranslationToken[]): Set<string> {
    const placed = new Set<string>();
    for (const token of tokens) {
        if (token.kind === "open" || token.kind === "standalone") {
            placed.add(`r${token.index}`);
        } else if (token.kind === "value") {
            placed.add(`v${token.index}`);
        }
    }
    return placed;
}

/**
 * A translation of a line that carries tags: drawn when it is not being edited, and a field when it
 * is. One row at a time holds the field, the way one row at a time holds the story editor's.
 */
export function InlineTargetEditor(props: {
    unitId: string;
    sourceRuns: StoryRichRun[];
    target: string;
    editing: boolean;
    /** Where the pointer landed when the row was opened, as a caret offset. `null` lands at the end. */
    caret: number | null;
    placeholder: string;
    ariaLabel: string;
    onEdit: (caret: number | null) => void;
    onStopEdit: () => void;
    onTargetChange: (target: string) => void;
}) {
    const field = useRef<TranslationFieldHandle | null>(null);
    const tokens = useMemo(() => translationTokens(props.target), [props.target]);
    const placed = useMemo(() => placedTags(tokens), [tokens]);
    // A frozen workspace shows the translation and refuses the edit, the same bargain the plain box
    // beside it makes: browsing a past version is the point, and an edit taken and then thrown away
    // on thaw is worse than one never taken.
    const freeze = useFreezeGuard();

    /**
     * ⚠ `preventDefault` is what makes the field open at all. The press swaps this element for the
     * field, which focuses itself on mount - and the browser then completes the press by focusing
     * whatever is under the pointer, taking the focus straight back off it. The field's own blur
     * closes it, so without this the row opens and shuts inside one click.
     */
    const openAtPointer = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        const rendered = event.currentTarget.querySelector<HTMLElement>("[data-inline-runs]");
        const point = rendered ? caretFromPoint(rendered, event.clientX, event.clientY) : null;
        props.onEdit(point);
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
                className="min-h-[3.25rem] w-full cursor-text rounded-md border border-edge-subtle bg-transparent px-2 py-1.5 text-sm leading-relaxed text-fg transition-colors hover:border-edge-strong"
                role="button"
                tabIndex={0}
                aria-label={props.ariaLabel}
                onMouseDown={freeze.frozen ? undefined : openAtPointer}
                onKeyDown={freeze.frozen ? undefined : openFromKeyboard}
                data-tip={freeze.frozen ? freeze.reason : undefined}
            >
                {tokens.length > 0
                    ? <InlineTokens tokens={tokens} sourceRuns={props.sourceRuns} className="whitespace-pre-wrap" />
                    : <span className="text-fg-subtle">{props.placeholder}</span>}
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <TranslationField
                key={props.unitId}
                target={props.target}
                sourceRuns={props.sourceRuns}
                placeholder={props.placeholder}
                ariaLabel={props.ariaLabel}
                caret={props.caret}
                fieldRef={field}
                onChange={props.onTargetChange}
                onDone={props.onStopEdit}
            />
            <TagPalette
                sourceRuns={props.sourceRuns}
                placed={placed}
                onPlace={(token, closing) => field.current?.place(token, closing)}
            />
        </div>
    );
}

/** The caret offset a click landed on, in the same positions the field counts in. */
function caretFromPoint(root: HTMLElement, x: number, y: number): number | null {
    const doc = globalThis.document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
    const range = doc.caretRangeFromPoint?.(x, y) ?? null;
    if (!range || !root.contains(range.startContainer)) {
        return null;
    }
    return caretOffsetIn(root, range.startContainer, range.startOffset);
}
