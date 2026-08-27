/**
 * Numeric setting control for the project sub-pages.
 *
 * Commits on blur and on Enter rather than per keystroke: every commit is a
 * write to `.nlproj`, and typing "15" over "5" would otherwise persist the
 * intermediate "1". Escape abandons the edit, and anything unparseable or out
 * of range snaps back to the last good value instead of being stored.
 */

import { useEffect, useState } from "react";
import { Input } from "@/lib/components/elements";

export function NumberField({
    value,
    min,
    max,
    unit,
    disabled,
    ariaLabel,
    onCommit,
}: {
    value: number;
    min: number;
    max: number;
    /** Rendered after the field, e.g. "s". */
    unit?: string;
    disabled?: boolean;
    ariaLabel: string;
    onCommit: (value: number) => void;
}) {
    const [draft, setDraft] = useState(String(value));

    // Follow the stored value when it changes underneath us - a rejected write
    // rolls back, and the field has to roll back with it.
    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const commit = () => {
        const parsed = Number.parseInt(draft, 10);
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
            setDraft(String(value));
            return;
        }
        if (parsed !== value) {
            onCommit(parsed);
        }
    };

    // Sized from the range rather than from a prop the caller has to remember:
    // a field whose ceiling is 192000 cannot show its own value in the width a
    // quality of 1 to 100 needs, and a clipped number reads as a broken one.
    const width = max >= 10_000 ? "w-24" : "w-16";

    return (
        <div className="flex shrink-0 items-center gap-1.5">
            <Input
                size="sm"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft}
                disabled={disabled}
                aria-label={ariaLabel}
                className={`${width} text-right`}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                        setDraft(String(value));
                        event.currentTarget.blur();
                    }
                }}
            />
            {unit ? <span className="text-2xs text-fg-subtle">{unit}</span> : null}
        </div>
    );
}
