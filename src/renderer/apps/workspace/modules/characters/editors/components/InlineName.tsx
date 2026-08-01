import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A name you edit where it is written.
 *
 * Replaces the pencil → modal → field → Enter loop every renameable thing in this module used to
 * go through. Renaming a pose is the most frequent edit an author makes here and it was also the
 * most expensive one, which is backwards; and a modal that says "Rename pose" over a list of poses
 * is a dialog whose whole content is already on screen behind it.
 *
 * Enter commits, Escape reverts, blur commits — the same contract every inline field in the app
 * uses. An empty or unchanged name is not a rename, so it reverts rather than writing a blank.
 *
 * `onEditingChange` exists for one reason: a row that is `draggable` swallows text selection inside
 * it (a native drag begins on mousedown, before the caret can be placed), so the rows that drag have
 * to drop `draggable` while their name is being edited.
 */
export function InlineName(props: {
    value: string;
    onCommit: (next: string) => void;
    /** Frozen project, or anything else that makes the rename impossible. Selection still works. */
    disabled?: boolean;
    title?: string;
    className?: string;
    /**
     * Whether the name takes the row's spare width. True for a list row; false inside a chip, whose
     * container is shrink-to-fit and would let a `flex-1` name collapse to nothing.
     */
    grow?: boolean;
    onEditingChange?: (editing: boolean) => void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const editing = draft !== null;
    const { onEditingChange } = props;

    useEffect(() => {
        onEditingChange?.(editing);
    }, [editing, onEditingChange]);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    // A rename that lands from somewhere else (the properties panel, an undo) while this row is not
    // being edited must show through; while it is, the author's draft wins.
    const begin = (event: React.SyntheticEvent) => {
        if (props.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        setDraft(props.value);
    };

    const commit = () => {
        const next = (draft ?? "").trim();
        setDraft(null);
        if (next && next !== props.value) {
            props.onCommit(next);
        }
    };

    const box = props.grow === false ? "" : "min-w-0 flex-1";

    if (editing) {
        return (
            <input
                ref={inputRef}
                value={draft ?? ""}
                draggable={false}
                size={props.grow === false ? Math.max(4, props.value.length) : undefined}
                className={cn(
                    box,
                    "rounded-sm border border-primary/60 bg-surface px-1 py-0 outline-none",
                    props.className,
                )}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                // Stopped here rather than at the row: the layer list, the axis cards and the
                // snapshot rows all act on clicks and keys of their own, and none of them should
                // hear a keystroke meant for this field.
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onMouseDown={event => event.stopPropagation()}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(null);
                    }
                }}
            />
        );
    }

    return (
        <span
            className={cn(box, "truncate", props.className)}
            title={props.title}
            tabIndex={props.disabled ? undefined : 0}
            onDoubleClick={begin}
            onKeyDown={event => {
                if (event.key === "F2" || event.key === "Enter") {
                    begin(event);
                }
            }}
        >
            {props.value}
        </span>
    );
}

/**
 * The next free `Base 1`, `Base 2`… for a new sibling.
 *
 * Every new pose being called "New pose" is not a naming problem, it is a *selection* problem: the
 * story row's pose picker lists them by name, and five identical entries cannot be told apart.
 * Numbering from the lowest free index rather than from the count means deleting the middle one and
 * adding another reuses the gap instead of climbing forever.
 */
export function nextAutoName(template: (n: number) => string, taken: readonly { name: string }[]): string {
    const used = new Set(taken.map(item => item.name.trim().toLowerCase()));
    for (let n = 1; n <= used.size + 1; n++) {
        const candidate = template(n);
        if (!used.has(candidate.trim().toLowerCase())) {
            return candidate;
        }
    }
    return template(used.size + 1);
}
