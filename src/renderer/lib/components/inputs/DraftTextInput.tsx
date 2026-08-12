import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
} from "react";

/**
 * How long a burst of typing may keep the document behind what is on screen.
 *
 * A commit is not cheap: it mutates the document, which rebuilds the canvas element tree, the
 * inspector and the panel previews, and takes an undo snapshot on the way. On a real project that
 * is tens of milliseconds - far too much to spend on a single keystroke, which is what a field
 * bound straight to `onChange` does. Coalescing to this interval keeps the canvas visibly live
 * while typing yet caps the cost at one commit per interval.
 */
const DEFAULT_COMMIT_INTERVAL_MS = 200;

export interface DraftTextInputProps {
    /** The committed value, read from the document by whoever renders this field. */
    value: string;
    onCommit: (value: string) => void;
    /**
     * Reads the committed value back when the field is left. Supply it when the document
     * normalises what it is given (clamps a length, trims, rewrites); without it a draft the
     * document rejected stays on screen until something else rebuilds the field.
     */
    readCommittedValue?: () => string;
    /** Renders a `<textarea>` rather than an `<input type="text">`. */
    multiline?: boolean;
    rows?: number;
    className?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    spellCheck?: boolean;
    /**
     * Identifies what is being edited, usually the element id. When it changes, keystrokes that
     * have not been written yet are committed against the value they were typed into, and the
     * draft is dropped.
     */
    draftResetKey?: string;
    commitIntervalMs?: number;
}

/**
 * A text field that echoes typing immediately and writes to the document on a throttle.
 *
 * The keystroke no longer waits for the document mutation, and a burst of them shares one
 * commit. What the author sees on the canvas still follows along while they type, at most
 * `commitIntervalMs` behind.
 */
export function DraftTextInput({
    value,
    onCommit,
    readCommittedValue,
    multiline = false,
    rows,
    className,
    placeholder,
    disabled = false,
    readOnly = false,
    spellCheck,
    draftResetKey,
    commitIntervalMs = DEFAULT_COMMIT_INTERVAL_MS,
}: DraftTextInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    /**
     * The pending edit carries the committer it was typed against. A flush provoked by anything
     * other than the timer - leaving the field, selecting another element, unmounting - can
     * therefore never write one element's text onto another's.
     */
    const pending = useRef<{ value: string; commit: (next: string) => void } | null>(null);
    const timer = useRef<number | null>(null);
    const lastCommitAt = useRef(0);
    const composing = useRef(false);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    const flush = useCallback(() => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        const edit = pending.current;
        pending.current = null;
        if (!edit) {
            return;
        }
        lastCommitAt.current = performance.now();
        edit.commit(edit.value);
    }, []);

    const schedule = useCallback(() => {
        // Mid-composition text is pinyin, not a value: an IME writes it a keystroke at a time and
        // replaces the lot when a candidate is chosen. Wait for the end of it.
        if (timer.current !== null || composing.current) {
            return;
        }
        const waited = performance.now() - lastCommitAt.current;
        timer.current = window.setTimeout(flush, Math.max(0, commitIntervalMs - waited));
    }, [commitIntervalMs, flush]);

    // The document caught up with the draft, so stop holding one: edits from elsewhere - an undo,
    // a blueprint binding - are shown again from here on.
    useEffect(() => {
        if (draft !== null && draft === value && pending.current === null) {
            setDraft(null);
        }
    }, [draft, value]);

    // Selecting another element, or unmounting, must not strand keystrokes that were typed but
    // not yet written.
    useEffect(() => {
        return () => {
            flush();
            setDraft(null);
        };
    }, [draftResetKey, flush]);

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
            const next = event.target.value;
            setDraft(next);
            if (disabled || readOnly) {
                return;
            }
            pending.current = { value: next, commit: commitRef.current };
            schedule();
        },
        [disabled, readOnly, schedule],
    );

    const handleBlur = useCallback(() => {
        flush();
        if (readCommittedValue) {
            // A value the document clamped or rewrote is the truth now, and the re-render carrying
            // it may be a frame away - show it rather than the draft it replaced.
            setDraft(readCommittedValue());
            return;
        }
        // Otherwise the effect above drops the draft once the value comes back round, which avoids
        // showing the pre-commit value for the frame in between.
    }, [flush, readCommittedValue]);

    const handleCompositionStart = useCallback(() => {
        composing.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
        composing.current = false;
        schedule();
    }, [schedule]);

    const shown = draft !== null ? draft : value;
    const shared = {
        value: shown,
        className,
        placeholder,
        disabled,
        readOnly,
        spellCheck,
        onChange: handleChange,
        onBlur: handleBlur,
        onCompositionStart: handleCompositionStart,
        onCompositionEnd: handleCompositionEnd,
    };

    if (multiline) {
        return <textarea {...shared} rows={rows} />;
    }
    return <input type="text" {...shared} />;
}
