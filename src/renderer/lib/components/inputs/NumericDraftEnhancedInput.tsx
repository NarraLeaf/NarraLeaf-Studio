import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { EnhancedInput, type EnhancedInputProps } from "./EnhancedInput";

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
     * `change` (the default) hands over every keystroke that parses, which is what a field wired to
     * something that redraws instantly wants: the picture follows the digits.
     *
     * `blur` waits for the field to be left, or for Enter. For a value whose commit is expensive or
     * coarse, because a number typed digit by digit is not one edit: `120` writes 1, then 12, then
     * 120, and the first two are figures the author never meant. Downstream they are three documents
     * to react to, three undo entries to walk back, and - where a value describes something that has
     * to be MADE - two pieces of work nobody will ever look at.
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
    commitOn = "change",
    onDraftNumber,
    onBlur,
    onKeyDown,
    popoverWhenNarrow = true,
    popoverThreshold = 200,
    type,
    ...rest
}: NumericDraftEnhancedInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    // Read through a ref rather than a closure: a commit runs from a blur or an Enter, and either
    // can arrive in the same tick as the keystroke that set the draft.
    const draftRef = useRef<string | null>(null);
    draftRef.current = draft;

    useEffect(() => {
        setDraft(null);
    }, [draftResetKey]);

    const shown = draft !== null ? draft : committedDisplay;

    /** Hand over whatever is being typed, if anything is. */
    const commit = useCallback(() => {
        const pending = draftRef.current;
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
        const n = Number.parseFloat(pending);
        if (Number.isFinite(n)) {
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
            const n = Number.parseFloat(next);
            if (!Number.isFinite(n)) {
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
            }
            onKeyDown?.(event);
        },
        [commit, commitOn, onKeyDown]
    );

    return (
        <EnhancedInput
            {...rest}
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
