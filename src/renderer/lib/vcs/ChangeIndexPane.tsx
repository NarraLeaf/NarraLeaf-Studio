import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Translator } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { CHANGE_CATEGORY_LABEL_KEY } from "./changeCategory";
import type { ChangeIndex, ChangeIndexGroup, ChangeIndexRow } from "./changeIndex";
import { CHANGE_KIND_GLYPH, CHANGE_KIND_TINT } from "./documentChangeView";

/**
 * The left half of a comparison: what changed, as headings and one line per file.
 *
 * **An index, not a report.** A row is one line whatever it stands for - a file with two changes and
 * a file with two hundred are the same height - and a closed heading is one line whatever it holds.
 * That is the whole difference from the surface this replaced, which drew every file expanded with
 * every change under it and turned forty changed files into a thousand rows in one scroller.
 *
 * Caveats are stated per heading and never per row (see {@link ChangeIndexGroup.caveats}); what
 * SPECIFICALLY was not compared in full is on each file's own detail, where there is room to say so.
 *
 * Owns no state. Which headings are open and which file is selected are the tab's, because the tab
 * has to resolve a selection against a re-read comparison and pick a fallback when the file it was
 * on is gone.
 */
export interface ChangeIndexPaneProps {
    readonly index: ChangeIndex;
    /** Whether this heading is open. The tab layers the author's clicks over the model's default. */
    isOpen(group: ChangeIndexGroup): boolean;
    onToggle(group: ChangeIndexGroup): void;
    readonly selectedPath: string | null;
    onSelect(path: string): void;
    readonly className?: string;
    readonly style?: CSSProperties;
}

export function ChangeIndexPane({
    index,
    isOpen,
    onToggle,
    selectedPath,
    onSelect,
    className,
    style,
}: ChangeIndexPaneProps) {
    const { t } = useTranslation();

    return (
        <nav
            aria-label={t("documentDiff.shell.fileList")}
            style={style}
            className={cn("min-w-0 overflow-y-auto py-1", className)}
        >
            {index.groups.map(group => (
                <ChangeIndexGroupView
                    key={group.category}
                    group={group}
                    open={isOpen(group)}
                    onToggle={() => onToggle(group)}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                />
            ))}
            {index.omitted > 0 && (
                // The count the budget left out, said once for the whole index. A list that stops at
                // its limit in silence is read as the complete list.
                <p className="px-2 pt-2 text-2xs text-fg-subtle">
                    {t("documentDiff.tab.documentsOmitted", { count: String(index.omitted) })}
                </p>
            )}
        </nav>
    );
}

/**
 * One heading and its files.
 *
 * A closed heading is one line and stays one line: the caveat below it is drawn only when the group
 * is open, because a group that starts closed to save room cannot then spend a second line saying
 * something about files nobody can see yet.
 */
export function ChangeIndexGroupView({
    group,
    open,
    onToggle,
    selectedPath,
    onSelect,
}: {
    group: ChangeIndexGroup;
    open: boolean;
    onToggle: () => void;
    selectedPath: string | null;
    onSelect: (path: string) => void;
}) {
    const { t, tn } = useTranslation();

    return (
        <section>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={cn(
                    "flex w-full items-center gap-1 px-2 py-1 text-left transition-colors cursor-default",
                    // `.nl-focus-ring` rather than a Tailwind ring: `styles.css` drops `box-shadow`
                    // on every native control, so a ring on a `<button>` is dead code
                    // (design-system §5), and a keyboard walking this list needs to be visible.
                    "nl-focus-ring text-2xs font-medium text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                {open
                    ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                    : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                <span className="min-w-0 truncate">{t(CHANGE_CATEGORY_LABEL_KEY[group.category])}</span>
                <span className="shrink-0 text-fg-subtle">{group.count}</span>
            </button>

            {open && group.caveats.partialDocuments > 0 && (
                <p className="px-2 pb-1 pl-6 text-2xs text-fg-subtle" data-testid="group-caveat">
                    {tn("documentDiff.shell.partial", group.caveats.partialDocuments)}
                </p>
            )}

            {open && group.rows.map(row => (
                <ChangeIndexRowView
                    key={row.path}
                    row={row}
                    selected={row.path === selectedPath}
                    onSelect={() => onSelect(row.path)}
                />
            ))}
        </section>
    );
}

/**
 * One file, one line, whatever is inside it.
 *
 * Four things at most and every one of them truncates rather than wraps: the marker, the name, where
 * it sits, and how much changed. Nothing here grows with the number of changes or with which tier
 * produced them, which is what keeps the index scannable at forty files and at four hundred.
 */
function ChangeIndexRowView({
    row,
    selected,
    onSelect,
}: {
    row: ChangeIndexRow;
    selected: boolean;
    onSelect: () => void;
}) {
    const translator = useTranslation();

    return (
        <button
            type="button"
            onClick={onSelect}
            title={row.path}
            data-change-index-row={row.path}
            className={cn(
                "flex w-full items-baseline gap-1.5 overflow-hidden whitespace-nowrap px-2 py-1 pl-6 text-left",
                "nl-focus-ring transition-colors cursor-default",
                selected ? "bg-primary/15 text-fg" : "hover:bg-fill",
            )}
        >
            <span
                aria-hidden
                className={cn("w-2 shrink-0 text-center font-mono text-2xs", CHANGE_KIND_TINT[row.kind])}
            >
                {CHANGE_KIND_GLYPH[row.kind]}
            </span>
            <span className="min-w-0 truncate text-xs text-fg">{row.name}</span>
            {row.directory !== null && (
                <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{row.directory}</span>
            )}
            <span className="ml-auto shrink-0 pl-1 text-2xs text-fg-subtle">
                {changeIndexRowSummary(row, translator)}
            </span>
        </button>
    );
}

/** What one file's row says it stands for. A count, except where a count would be misleading. */
export function changeIndexRowSummary(row: ChangeIndexRow, { t, tn }: Pick<Translator, "t" | "tn">): string {
    switch (row.kind) {
        case "added":
            return t("documentDiff.shell.fileAdded");
        case "removed":
            return t("documentDiff.shell.fileRemoved");
        case "moved":
            return t("documentDiff.shell.fileMoved");
        case "changed":
            // A count only where a count is the truth: an added file is reported as one change
            // because there is nothing to compare it against, and "1 change" for a new chapter
            // would be a number the author cannot act on.
            return tn("documentDiff.shell.changes", row.changeCount);
    }
}
