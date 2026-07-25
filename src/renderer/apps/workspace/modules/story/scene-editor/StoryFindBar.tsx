import { useEffect, useRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Replace, ReplaceAll, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * Find and replace inside one scene.
 *
 * A chapter is a few hundred lines of prose and the only way to change a name across it was to read
 * every row. Global search finds the lines but cannot rewrite them, and it leaves the editor to do it.
 *
 * Deliberately a bar over the editor rather than a dialog: the point is to watch the rows change as
 * you step through them, which a modal covering the rows would prevent.
 */
export function StoryFindBar(props: {
    query: string;
    onQueryChange: (value: string) => void;
    replacement: string;
    onReplacementChange: (value: string) => void;
    caseSensitive: boolean;
    onToggleCaseSensitive: () => void;
    /** Total hits in the scene, and which one is current (1-based; 0 when there are none). */
    matchCount: number;
    activeMatch: number;
    onNext: () => void;
    onPrevious: () => void;
    onReplace: () => void;
    onReplaceAll: () => void;
    onClose: () => void;
    /** Bumped by the opener to pull focus back to the field on a repeated Mod+F. */
    focusToken: number;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) {
            return;
        }
        input.focus();
        input.select();
    }, [props.focusToken]);

    const noMatches = props.query.length > 0 && props.matchCount === 0;

    return (
        <div
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge bg-surface-raised px-3 py-1.5"
            // The editor's own key handling would read these as row navigation.
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === "Escape") {
                    event.preventDefault();
                    props.onClose();
                    return;
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.shiftKey ? props.onPrevious() : props.onNext();
                }
            }}
        >
            <input
                ref={inputRef}
                value={props.query}
                onChange={event => props.onQueryChange(event.target.value)}
                placeholder={t("story.find.placeholder")}
                aria-label={t("story.find.placeholder")}
                className={[
                    "h-7 w-44 rounded-md border bg-surface-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-subtle",
                    noMatches ? "border-danger/60" : "border-edge focus:border-primary/50",
                ].join(" ")}
            />
            <button
                type="button"
                onClick={props.onToggleCaseSensitive}
                title={t("story.find.caseSensitive")}
                aria-label={t("story.find.caseSensitive")}
                aria-pressed={props.caseSensitive}
                className={[
                    "grid h-7 w-7 place-items-center rounded transition-colors",
                    props.caseSensitive ? "bg-primary/15 text-primary" : "text-fg-subtle hover:bg-fill hover:text-fg",
                ].join(" ")}
            >
                <CaseSensitive className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[54px] shrink-0 text-2xs tabular-nums text-fg-subtle">
                {props.query.length === 0
                    ? ""
                    : props.matchCount === 0
                        ? t("story.find.noMatches")
                        : `${props.activeMatch}/${props.matchCount}`}
            </span>
            <button
                type="button"
                onClick={props.onPrevious}
                disabled={props.matchCount === 0}
                title={t("story.find.previous")}
                aria-label={t("story.find.previous")}
                className="grid h-7 w-7 place-items-center rounded text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
            >
                <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                onClick={props.onNext}
                disabled={props.matchCount === 0}
                title={t("story.find.next")}
                aria-label={t("story.find.next")}
                className="grid h-7 w-7 place-items-center rounded text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </button>

            <span className="mx-1 h-4 w-px bg-edge" aria-hidden />

            <input
                value={props.replacement}
                onChange={event => props.onReplacementChange(event.target.value)}
                placeholder={t("story.find.replacePlaceholder")}
                aria-label={t("story.find.replacePlaceholder")}
                className="h-7 w-44 rounded-md border border-edge bg-surface-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50"
            />
            <button
                type="button"
                onClick={props.onReplace}
                disabled={props.matchCount === 0}
                title={t("story.find.replace")}
                aria-label={t("story.find.replace")}
                className="grid h-7 w-7 place-items-center rounded text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
            >
                <Replace className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                onClick={props.onReplaceAll}
                disabled={props.matchCount === 0}
                title={t("story.find.replaceAll")}
                aria-label={t("story.find.replaceAll")}
                className="grid h-7 w-7 place-items-center rounded text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40"
            >
                <ReplaceAll className="h-3.5 w-3.5" />
            </button>

            <button
                type="button"
                onClick={props.onClose}
                title={t("common.close")}
                aria-label={t("common.close")}
                className="ml-auto grid h-7 w-7 place-items-center rounded text-fg-subtle transition-colors hover:bg-fill hover:text-fg"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
