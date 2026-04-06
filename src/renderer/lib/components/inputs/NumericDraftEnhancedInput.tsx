import { useCallback, useEffect, useState, type FocusEvent } from "react";
import { EnhancedInput, type EnhancedInputProps } from "./EnhancedInput";

type Passthrough = Omit<EnhancedInputProps, "value" | "onChange">;

export interface NumericDraftEnhancedInputProps extends Passthrough {
    /** Serialized committed value shown when not editing a draft */
    committedDisplay: string;
    /** Called only when the raw string parses to a finite number */
    onFiniteNumber: (n: number) => void;
    /** When this changes (e.g. selected element id), clear any in-progress draft */
    draftResetKey?: string;
}

/**
 * Controlled numeric field backed by document state: keeps a local draft string so
 * transient emptiness or partial input (e.g. "") does not snap back before blur.
 */
export function NumericDraftEnhancedInput({
    committedDisplay,
    onFiniteNumber,
    draftResetKey,
    onBlur,
    popoverWhenNarrow = true,
    popoverThreshold = 112,
    ...rest
}: NumericDraftEnhancedInputProps) {
    const [draft, setDraft] = useState<string | null>(null);

    useEffect(() => {
        setDraft(null);
    }, [draftResetKey]);

    const shown = draft !== null ? draft : committedDisplay;

    const handleChange = useCallback(
        (next: string) => {
            setDraft(next);
            const n = Number.parseFloat(next);
            if (Number.isFinite(n)) {
                onFiniteNumber(n);
            }
        },
        [onFiniteNumber]
    );

    const handleBlur = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setDraft(null);
            onBlur?.(event);
        },
        [onBlur]
    );

    return (
        <EnhancedInput
            {...rest}
            value={shown}
            onChange={handleChange}
            onBlur={handleBlur}
            popoverWhenNarrow={popoverWhenNarrow}
            popoverThreshold={popoverThreshold}
        />
    );
}
