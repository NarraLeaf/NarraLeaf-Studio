import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { EnhancedInput, type EnhancedInputProps } from "./EnhancedInput";
import { cn } from "@/lib/utils/cn";
import { arrowKeyStep, beginNumberScrub, evaluateNumericInput, stepNumber } from "./numericExpression";

type Passthrough = Omit<EnhancedInputProps, "value" | "onChange">;

export interface NumericDraftEnhancedInputProps extends Passthrough {
    /** Serialized committed value shown when not editing a draft */
    committedDisplay: string;
    /** Called only when the raw string parses to a finite number */
    onFiniteNumber: (n: number) => void;
    /** Called when the raw string is emptied */
    onEmpty?: () => void;
    /** When this changes (e.g. selected element id), clear any in-progress draft */
    draftResetKey?: string;
    /**
     * When the number reaches the caller.
     *
     * `blur` (the default) waits for the field to be left, or for Enter, as a design tool's inspector
     * does - because a number typed digit by digit is not one edit: `120` wrote 1, then 12, then 120,
     * and the first two are figures the author never meant. They resized the element to 1px on the
     * way, reflowed a stack around it, drifted a locked aspect ratio, and left undo steps to walk
     * back. Escape puts the value back; the arrow keys step it and commit at once.
     *
     * `change` hands over every keystroke that parses, for the rare field whose picture has to follow
     * the digits as they are typed.
     */
    commitOn?: "change" | "blur";
    /**
     * Every keystroke that parses, whether or not it commits.
     *
     * For a caller that draws the same number somewhere else - a slider beside the box - which would
     * otherwise stand at the committed figure while the box shows the one being typed.
     */
    onDraftNumber?: (n: number) => void;
}

/**
 * Controlled numeric field backed by document state: keeps a local draft string so
 * transient emptiness or partial input (e.g. "") does not snap back before blur.
 * Maps `type="number"` → `type="text"` for empty-safe controlled values; default popover threshold stays usable for narrow inspector columns after that layout shift.
 *
 * {@link NumericDraftEnhancedInputProps.commitOn} decides when the number leaves the field. The
 * other deferred numeric field in the app is `DeferredNumberInput`, which draws a bare `<input>`;
 * this one exists for the places that need the shared field's chrome around it.
 */
export function NumericDraftEnhancedInput({
    committedDisplay,
    onFiniteNumber,
    onEmpty,
    draftResetKey,
    commitOn = "blur",
    onDraftNumber,
    onBlur,
    onKeyDown,
    popoverWhenNarrow = true,
    // The same width the X and Y fields switch at: at 200, the W and H beside them in a default-width
    // inspector turned into click-to-open buttons while X and Y stayed fields.
    popoverThreshold = 112,
    type,
    ...rest
}: NumericDraftEnhancedInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    // Read through a ref rather than a closure: a commit runs from a blur or an Enter, and either
    // can arrive in the same tick as the keystroke that set the draft.
    const draftRef = useRef<string | null>(null);
    draftRef.current = draft;

    // The callbacks of the render the author was typing in. A draft still open when the field is
    // reset (the selection moved) or unmounted belongs to what was selected then: a click on the
    // canvas changes the selection on pointerdown, before the blur that would have committed it, and
    // the typed number used to vanish. It is committed through these, so it lands where it was typed.
    const typedInto = useRef({ onFiniteNumber, onEmpty, commitOn });
    const flushTypedDraft = useCallback(() => {
        const pending = draftRef.current;
        const { onFiniteNumber: commitNumber, commitOn: mode } = typedInto.current;
        if (pending === null || mode !== "blur") {
            return;
        }
        const n = evaluateNumericInput(pending);
        if (n !== null) {
            commitNumber(n);
        }
    }, []);

    const resetKeySeen = useRef(draftResetKey);
    useEffect(() => {
        if (resetKeySeen.current === draftResetKey) {
            return;
        }
        resetKeySeen.current = draftResetKey;
        flushTypedDraft();
        setDraft(null);
    }, [draftResetKey, flushTypedDraft]);
    useEffect(() => flushTypedDraft, [flushTypedDraft]);
    // After the reset effect above, so that one still sees the previous render's callbacks.
    useEffect(() => {
        typedInto.current = { onFiniteNumber, onEmpty, commitOn };
    });

    const shown = draft !== null ? draft : committedDisplay;
    // A draft that is not a number says so while it is being typed. Leaving the field still puts the
    // committed value back - that is the contract - but it used to happen with no sign beforehand that
    // what was typed would be thrown away.
    const draftInvalid = draft !== null && draft.trim() !== "" && evaluateNumericInput(draft) === null;

    /** Hand over whatever is being typed, if anything is. */
    const commit = useCallback(() => {
        const pending = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (pending === null) {
            // Nothing was typed, so there is nothing to say. A field that committed on every blur
            // would rewrite a value for an author who only tabbed through it.
            return;
        }
        if (pending.trim() === "") {
            onEmpty?.();
            return;
        }
        const n = evaluateNumericInput(pending);
        if (n !== null) {
            onFiniteNumber(n);
        }
    }, [onEmpty, onFiniteNumber]);

    const handleChange = useCallback(
        (next: string) => {
            setDraft(next);
            if (next.trim() === "") {
                if (commitOn === "change") {
                    onEmpty?.();
                }
                return;
            }
            const n = evaluateNumericInput(next);
            if (n === null) {
                return;
            }
            onDraftNumber?.(n);
            if (commitOn === "change") {
                onFiniteNumber(n);
            }
        },
        [commitOn, onDraftNumber, onEmpty, onFiniteNumber]
    );

    const handleBlur = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            if (commitOn === "blur") {
                commit();
            } else {
                setDraft(null);
            }
            onBlur?.(event);
        },
        [commit, commitOn, onBlur]
    );

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            // Enter commits where the caret is rather than moving focus: an author naming a figure
            // often wants to see what it did and then type another one.
            if (commitOn === "blur" && event.key === "Enter") {
                event.preventDefault();
                commit();
            } else if (event.key === "Escape" && draftRef.current !== null) {
                // Escape takes back what was typed and leaves the field, as it cancels anywhere else.
                event.preventDefault();
                event.stopPropagation();
                draftRef.current = null;
                setDraft(null);
                event.currentTarget.blur();
            } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !rest.readOnly && !rest.disabled) {
                const current = evaluateNumericInput(draftRef.current ?? committedDisplay);
                if (current !== null) {
                    event.preventDefault();
                    const next = stepNumber(current, (event.key === "ArrowUp" ? 1 : -1) * arrowKeyStep(event));
                    draftRef.current = null;
                    setDraft(null);
                    onDraftNumber?.(next);
                    onFiniteNumber(next);
                }
            }
            onKeyDown?.(event);
        },
        [commit, commitOn, committedDisplay, onDraftNumber, onFiniteNumber, onKeyDown, rest.disabled, rest.readOnly]
    );

    // The leading icon scrubs the value: dragged sideways it previews every step and commits once.
    const handleScrub = useCallback(
        (event: PointerEvent<HTMLSpanElement>) => {
            const start = evaluateNumericInput(draftRef.current ?? committedDisplay);
            if (start === null) {
                return;
            }
            beginNumberScrub(event, {
                start,
                onPreview: value => {
                    setDraft(String(value));
                    onDraftNumber?.(value);
                },
                onCommit: value => onFiniteNumber(value),
                onEnd: () => {
                    draftRef.current = null;
                    setDraft(null);
                },
            });
        },
        [committedDisplay, onDraftNumber, onFiniteNumber]
    );

    return (
        <EnhancedInput
            {...rest}
            aria-invalid={draftInvalid || rest["aria-invalid"] || undefined}
            className={cn(rest.className, draftInvalid && "border-danger/70 focus-within:border-danger/70 focus-within:ring-danger/30")}
            onLeftIconPointerDown={rest.leftIcon ? handleScrub : undefined}
            type={type === "number" ? "text" : type}
            value={shown}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            popoverWhenNarrow={popoverWhenNarrow}
            popoverThreshold={popoverThreshold}
        />
    );
}
