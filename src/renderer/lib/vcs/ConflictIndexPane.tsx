import type { CSSProperties } from "react";
import { CircleDashed } from "lucide-react";
import type { VcsMergeSideChoice } from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { splitDocumentPath } from "./changeIndex";
import type { ConflictRowView } from "./mergeDecisionView";

/**
 * The left half of a merge: which files are in conflict, and what has been decided about each.
 *
 * **An index, not a report.** A file with two changes inside it and a file with two hundred are the
 * same single line, and nothing here grows with what is inside a document - that is the detail
 * pane's business. It is the same rule `ChangeIndexPane` follows, for the same reason: the surface
 * this replaced drew every file as an expandable section with a two-column grid of values nested
 * inside it, so a merge of forty files was forty sections and the list itself disappeared.
 *
 * **Three states have to be legible at a glance, and the third is the important one.** Mine and
 * theirs are pressed buttons; nothing chosen is a marked row, because that is the state that stops
 * the merge being finished and the author needs to find those rows without reading every button on
 * every line. The per-change control is a fourth thing and appears only where it can work.
 *
 * Owns no state. The selection and every decision belong to the panel, which is the only thing that
 * can carry them for the life of the window (docs §4.24).
 */
export interface ConflictIndexPaneProps {
    readonly rows: readonly ConflictRowView[];
    /** Conflicts past the row cap. Said once, at the foot of the list, never left silent. */
    readonly omitted: number;
    readonly selectedPath: string | null;
    onSelect(path: string): void;
    /** True while a finish or an abandon is out. Not the freeze: choosing writes nothing. */
    readonly disabled: boolean;
    onChooseWhole(path: string, side: VcsMergeSideChoice): void;
    onChooseMerged(path: string): void;
    readonly className?: string;
    readonly style?: CSSProperties;
}

export function ConflictIndexPane({
    rows,
    omitted,
    selectedPath,
    onSelect,
    disabled,
    onChooseWhole,
    onChooseMerged,
    className,
    style,
}: ConflictIndexPaneProps) {
    const { t } = useTranslation();

    return (
        <nav
            aria-label={t("documentDiff.resolve.fileList")}
            style={style}
            className={cn("min-w-0 overflow-y-auto py-1", className)}
        >
            {rows.map(row => (
                <ConflictIndexRow
                    key={row.path}
                    row={row}
                    selected={row.path === selectedPath}
                    disabled={disabled}
                    onSelect={() => onSelect(row.path)}
                    onChooseWhole={side => onChooseWhole(row.path, side)}
                    onChooseMerged={() => onChooseMerged(row.path)}
                />
            ))}
            {omitted > 0 && (
                <p className="px-2 pt-2 text-2xs text-fg-subtle">
                    {t("documentDiff.resolve.rowsOmitted", { count: String(omitted) })}
                </p>
            )}
        </nav>
    );
}

/**
 * One conflicted file: which side it is on, and the way to look inside it.
 *
 * A row of controls rather than one control, so selecting a file and answering for it are separate
 * acts: an author who wants to read both versions before choosing must be able to open a file
 * without that press meaning anything about the outcome.
 *
 * The two whole-file choices are a pair of buttons rather than a menu or a checkbox, and the
 * per-change button joins them only once the file has been read and its format turns out to be
 * mergeable - it is the one whose availability is a property of the DOCUMENT rather than of the
 * interface, so it cannot be drawn before anyone has looked.
 */
function ConflictIndexRow({
    row,
    selected,
    disabled,
    onSelect,
    onChooseWhole,
    onChooseMerged,
}: {
    row: ConflictRowView;
    selected: boolean;
    disabled: boolean;
    onSelect: () => void;
    onChooseWhole: (side: VcsMergeSideChoice) => void;
    onChooseMerged: () => void;
}) {
    const { t, tn } = useTranslation();
    const { directory, name } = splitDocumentPath(row.path);
    const merging = row.decision === "per-change";

    return (
        // A div holding buttons rather than a button holding buttons: the decision controls have to
        // be pressable without selecting the row, and nested native buttons are not valid markup.
        <div
            data-resolve-row={row.path}
            data-resolve-decision={row.decision}
            className={cn(
                "flex items-center gap-1 pr-2 transition-colors",
                selected ? "bg-primary/15" : "hover:bg-fill",
            )}
        >
            <button
                type="button"
                onClick={onSelect}
                title={row.path}
                // `.nl-focus-ring` rather than a Tailwind ring: `styles.css` drops `box-shadow` on
                // every native control, so a ring on a `<button>` is dead code (design-system §5).
                className="nl-focus-ring flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-1 pl-2 text-left cursor-default"
            >
                {row.settled
                    // Only one of the three states wears a marker, and it is the one an author is
                    // looking for. A tick beside every settled file would put a mark on the rows
                    // that need nothing and leave the ones that do to be found by elimination.
                    ? <span aria-hidden className="w-3 shrink-0" />
                    : (
                        <CircleDashed
                            role="img"
                            aria-label={t("documentDiff.resolve.pending")}
                            data-resolve-pending
                            className="h-3 w-3 shrink-0 text-warning"
                        />
                    )}
                <span className="min-w-0 truncate text-xs text-fg">{name}</span>
                {directory !== null && (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{directory}</span>
                )}
            </button>

            <div
                role="group"
                aria-label={t("documentDiff.resolve.decision")}
                className="flex shrink-0 items-center gap-1"
            >
                {(["mine", "theirs"] as const).map(side => (
                    <button
                        key={side}
                        type="button"
                        disabled={disabled}
                        aria-pressed={row.decision === side}
                        onClick={() => onChooseWhole(side)}
                        className={cn(
                            "h-6 rounded-md border px-2 text-2xs transition-colors cursor-default disabled:opacity-50",
                            row.decision === side
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-edge text-fg-muted hover:bg-fill hover:text-fg",
                        )}
                    >
                        {t(side === "mine" ? "documentDiff.resolve.takeMine" : "documentDiff.resolve.takeTheirs")}
                    </button>
                ))}
                {row.mergeable && (
                    <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={merging}
                        title={merging && row.undecidedChanges > 0
                            ? tn("documentDiff.resolve.change.undecided", row.undecidedChanges)
                            : undefined}
                        onClick={onChooseMerged}
                        className={cn(
                            "h-6 rounded-md border px-2 text-2xs transition-colors cursor-default disabled:opacity-50",
                            merging && row.undecidedChanges === 0
                                ? "border-primary bg-primary/15 text-primary"
                                : merging
                                    // Chosen, and not finished: the same warning colour the row's own
                                    // marker wears, because this file is still one of the ones
                                    // holding the merge open.
                                    ? "border-warning text-warning"
                                    : "border-edge text-fg-muted hover:bg-fill hover:text-fg",
                        )}
                    >
                        {t("documentDiff.resolve.change.auto")}
                    </button>
                )}
            </div>
        </div>
    );
}
