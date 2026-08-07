import { useEffect, useRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { FreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

/**
 * Find and replace inside one scene.
 *
 * A chapter is a few hundred lines of prose and the only way to change a name across it was to read
 * every row. Global search finds the lines but cannot rewrite them, and it leaves the editor to do it.
 *
 * Deliberately a bar over the editor rather than a dialog: the point is to watch the rows change as
 * you step through them, which a modal covering the rows would prevent.
 *
 * The three option toggles are the ones the project search panel has, driven by the same compiled
 * matcher, so `Aa` and `.*` cannot come to mean two different things in the two boxes an author
 * types the same query into.
 */
/**
 * An option that is ON, in the accent rather than the shared neutral fill.
 *
 * `ToolbarButton`'s own `active` is a neutral wash, which is right for a pressed tool and too close
 * to its hover state for a switch: the whole job of these three is to answer "is this on?" at a
 * glance, from across the bar, without hovering anything.
 */
const ACTIVE_TOGGLE_CLASS = "bg-primary/15 text-primary";

export function StoryFindBar(props: {
    query: string;
    onQueryChange: (value: string) => void;
    replacement: string;
    onReplacementChange: (value: string) => void;
    caseSensitive: boolean;
    onToggleCaseSensitive: () => void;
    wholeWord: boolean;
    onToggleWholeWord: () => void;
    regex: boolean;
    onToggleRegex: () => void;
    /** The pattern would not compile. Reads as "no results", because that is what it finds. */
    invalidPattern: boolean;
    /** Total hits in the scene, and which one is current (1-based; 0 when there are none). */
    matchCount: number;
    activeMatch: number;
    onNext: () => void;
    onPrevious: () => void;
    onReplace: () => void;
    onReplaceAll: () => void;
    onClose: () => void;
    /**
     * Finding is reading and stays live while the workspace is frozen; replacing is a write and does
     * not. The guard greys the two replace buttons rather than hiding them - see `freezeGuard`.
     */
    freeze: FreezeGuard;
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

    const noMatches = props.invalidPattern || (props.query.length > 0 && props.matchCount === 0);

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
                title={props.invalidPattern ? t("story.find.invalidPattern") : undefined}
                className={cn(
                    "h-7 w-44 rounded-md border bg-surface-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-subtle",
                    noMatches ? "border-danger/60" : "border-edge focus:border-primary/50",
                )}
            />
            <ToolbarButton
                size="sm"
                onClick={props.onToggleCaseSensitive}
                title={t("story.find.caseSensitive")}
                aria-label={t("story.find.caseSensitive")}
                aria-pressed={props.caseSensitive}
                active={props.caseSensitive}
                className={cn(props.caseSensitive && ACTIVE_TOGGLE_CLASS)}
            >
                <CaseSensitive className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={props.onToggleWholeWord}
                title={t("story.find.wholeWord")}
                aria-label={t("story.find.wholeWord")}
                aria-pressed={props.wholeWord}
                active={props.wholeWord}
                className={cn(props.wholeWord && ACTIVE_TOGGLE_CLASS)}
            >
                <WholeWord className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={props.onToggleRegex}
                title={t("story.find.regex")}
                aria-label={t("story.find.regex")}
                aria-pressed={props.regex}
                active={props.regex}
                className={cn(props.regex && ACTIVE_TOGGLE_CLASS)}
            >
                <Regex className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="min-w-[54px] shrink-0 text-2xs tabular-nums text-fg-subtle">
                {props.query.length === 0
                    ? ""
                    : props.invalidPattern
                        ? t("story.find.invalidPattern")
                        : props.matchCount === 0
                            ? t("story.find.noMatches")
                            : `${props.activeMatch}/${props.matchCount}`}
            </span>
            <ToolbarButton
                size="sm"
                onClick={props.onPrevious}
                disabled={props.matchCount === 0}
                title={t("story.find.previous")}
                aria-label={t("story.find.previous")}
            >
                <ChevronUp className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={props.onNext}
                disabled={props.matchCount === 0}
                title={t("story.find.next")}
                aria-label={t("story.find.next")}
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </ToolbarButton>

            <span className="mx-1 h-4 w-px bg-edge" aria-hidden />

            <input
                value={props.replacement}
                onChange={event => props.onReplacementChange(event.target.value)}
                placeholder={t("story.find.replacePlaceholder")}
                aria-label={t("story.find.replacePlaceholder")}
                {...props.freeze.writes()}
                className="h-7 w-44 rounded-md border border-edge bg-surface-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-primary/50 disabled:opacity-50"
            />
            <ToolbarButton
                size="sm"
                onClick={props.onReplace}
                aria-label={t("story.find.replace")}
                {...props.freeze.writes(props.matchCount === 0, t("story.find.replace"))}
            >
                <Replace className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                onClick={props.onReplaceAll}
                aria-label={t("story.find.replaceAll")}
                {...props.freeze.writes(props.matchCount === 0, t("story.find.replaceAll"))}
            >
                <ReplaceAll className="h-3.5 w-3.5" />
            </ToolbarButton>

            <ToolbarButton
                size="sm"
                onClick={props.onClose}
                title={t("common.close")}
                aria-label={t("common.close")}
                className="ml-auto"
            >
                <X className="h-3.5 w-3.5" />
            </ToolbarButton>
        </div>
    );
}
