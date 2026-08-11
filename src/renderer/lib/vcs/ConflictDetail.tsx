import { Loader2 } from "lucide-react";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type { VcsMergeSideChoice } from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { splitDocumentPath } from "./changeIndex";
import {
    describeMergeSide,
    effectiveMergeSide,
    mergeDocumentBlockedKey,
    resolveMergeDecisionLabel,
    type MergeChangeChoices,
    type MergeDocumentEntry,
    type MergeValueView,
} from "./mergeDecisionView";

/**
 * The detail half of a merge: one conflicted file, change by change, with both sides' values.
 *
 * **One file, mounted once.** The values are what this pane exists for and they are what the
 * surface it replaced had no room for: two `target` strings belong opposite each other, and a
 * 320px column nested inside an expanded row could only stack them. Here they get half the tab.
 *
 * The identity line is drawn here rather than by the caller, so the file the values belong to is
 * named on the same surface as the values themselves.
 */
export interface ConflictDetailProps {
    readonly path: string;
    /** `undefined` while nobody has asked for this file yet - which reads the same as loading. */
    readonly entry: MergeDocumentEntry | undefined;
    readonly choices: MergeChangeChoices;
    /** True while a finish or an abandon is out. Not the freeze: choosing writes nothing. */
    readonly disabled: boolean;
    onChooseChange(decision: DocumentMergeDecision, side: VcsMergeSideChoice): void;
    readonly className?: string;
}

export function ConflictDetail({ path, entry, choices, disabled, onChooseChange, className }: ConflictDetailProps) {
    const { t } = useTranslation();
    const { directory, name } = splitDocumentPath(path);

    return (
        <div
            // The one handle a test has on "how many files' decisions are mounted", which is the
            // property that separates this layout from the stack of expanded rows it replaced.
            data-resolve-detail={path}
            className={cn("flex h-full min-h-0 flex-col", className)}
        >
            <div className="flex shrink-0 items-baseline gap-1.5 overflow-hidden px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium text-fg">{name}</span>
                {directory !== null && (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle" title={directory}>
                        {directory}
                    </span>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {entry === undefined || entry.status === "loading" ? (
                    <p className="flex items-center gap-2 text-2xs text-fg-subtle">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("documentDiff.resolve.change.loading")}
                    </p>
                ) : entry.status === "error" ? (
                    <p className="text-2xs text-danger">{entry.message}</p>
                ) : entry.document.blocked !== undefined ? (
                    // Tier three: refuse, and say which wall was hit. The two whole-file buttons on
                    // this file's row are still the answer for it and are still there - this is a
                    // sentence beside them, not a control taken away.
                    <div className="space-y-0.5">
                        <p className="text-2xs text-fg-muted">{t("documentDiff.resolve.change.blocked.title")}</p>
                        <p className="text-2xs text-fg-subtle">{t(mergeDocumentBlockedKey(entry.document.blocked))}</p>
                        {entry.document.detail && (
                            // The producer's own words, untranslated and marked as such by being
                            // quieter - never instead of the sentence above it.
                            <p className="text-2xs text-fg-subtle opacity-70">{entry.document.detail}</p>
                        )}
                    </div>
                ) : entry.document.decisions.length === 0 ? (
                    <p className="text-2xs text-fg-subtle">{t("documentDiff.resolve.change.none")}</p>
                ) : (
                    <>
                        <p className="mb-1 text-2xs text-fg-subtle">{t("documentDiff.resolve.change.heading")}</p>
                        {entry.document.decisions.map(decision => (
                            <MergeChangeRow
                                key={mergeDecisionKey(decision.path)}
                                decision={decision}
                                side={effectiveMergeSide(decision, choices)}
                                disabled={disabled}
                                onChoose={side => onChooseChange(decision, side)}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * One change inside a file, and the side it is on.
 *
 * **Two shapes, because two different questions are being asked.** An `auto-*` row was decided by
 * the merge - one side moved and the other did not, so there was a right answer - and it is drawn
 * as settled, showing only the value that won, with the other side offered on hover. A `conflict`
 * row was decided by nobody, so both sides are drawn as choices and neither is selected; there is
 * no hover affordance there because there is nothing yet to reveal an alternative to.
 *
 * Flipping an `auto-*` row and answering a `conflict` are the same operation underneath - both
 * record a side against this decision's path - which is why the merged document can be rebuilt from
 * the flips alone.
 */
function MergeChangeRow({
    decision,
    side,
    disabled,
    onChoose,
}: {
    decision: DocumentMergeDecision;
    side: "mine" | "theirs" | undefined;
    disabled: boolean;
    onChoose: (side: VcsMergeSideChoice) => void;
}) {
    const translator = useTranslation();
    const { t } = translator;
    const label = resolveMergeDecisionLabel(decision, translator);
    const conflict = decision.outcome === "conflict";
    const other = side === "mine" ? "theirs" : "mine";

    return (
        <div className="group/change border-t border-edge/60 py-1 first:border-t-0">
            <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span
                    className={cn(
                        "min-w-0 truncate text-2xs",
                        label.untranslated ? "font-mono text-fg-muted" : "text-fg",
                    )}
                    title={decision.path.join(" / ")}
                >
                    {label.primary}
                </span>
                {label.detail && <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{label.detail}</span>}
                <span className="flex-1" />
                {!conflict && side !== undefined && (
                    // Hover-revealed rather than persistent: an automatic row is right almost every
                    // time, and a button on each of two hundred of them is two hundred invitations
                    // to change something that did not need changing.
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChoose(other)}
                        className="shrink-0 rounded-md px-1 text-2xs text-fg-subtle opacity-0 transition-opacity cursor-default hover:text-fg group-hover/change:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                    >
                        {t(other === "mine" ? "documentDiff.resolve.change.useMine" : "documentDiff.resolve.change.useTheirs")}
                    </button>
                )}
            </div>

            {conflict || side === undefined ? (
                <div className="mt-0.5 grid grid-cols-2 gap-1">
                    {(["mine", "theirs"] as const).map(candidate => (
                        <button
                            key={candidate}
                            type="button"
                            disabled={disabled}
                            aria-pressed={side === candidate}
                            onClick={() => onChoose(candidate)}
                            className={cn(
                                "min-w-0 rounded-md border px-1.5 py-1 text-left transition-colors cursor-default disabled:opacity-50",
                                side === candidate
                                    ? "border-primary bg-primary/10"
                                    : "border-edge hover:bg-fill",
                            )}
                        >
                            <span className="mb-0.5 block truncate text-2xs text-fg-subtle">
                                {t(candidate === "mine"
                                    ? "documentDiff.resolve.takeMine"
                                    : "documentDiff.resolve.takeTheirs")}
                            </span>
                            <MergeValue view={describeMergeSide(candidate === "mine" ? decision.mine : decision.theirs)} />
                        </button>
                    ))}
                </div>
            ) : (
                <div className="mt-0.5 min-w-0 rounded-md border border-edge/60 px-1.5 py-1">
                    <MergeValue view={describeMergeSide(side === "mine" ? decision.mine : decision.theirs)} />
                </div>
            )}
        </div>
    );
}

/**
 * One side's value, field by field.
 *
 * Not JSON: the question a translation conflict asks is which of two sentences to keep, and putting
 * them inside braces and quotes makes the author read punctuation to find the answer. One line per
 * field puts the two `target` strings opposite each other, which IS the choice.
 */
function MergeValue({ view }: { view: MergeValueView }) {
    const { t } = useTranslation();
    if (view.absent) {
        return <span className="block truncate text-2xs italic text-fg-subtle">{t("documentDiff.resolve.change.absent")}</span>;
    }
    return (
        <span className="block min-w-0">
            {view.lines.map((line, index) => (
                <span key={line.name ?? index} className="flex min-w-0 items-baseline gap-1">
                    {line.name && <span className="shrink-0 text-2xs text-fg-subtle">{line.name}</span>}
                    <span className="min-w-0 truncate text-2xs text-fg">{line.text}</span>
                </span>
            ))}
            {view.hidden > 0 && (
                <span className="block text-2xs text-fg-subtle">
                    {t("documentDiff.resolve.change.moreFields", { count: String(view.hidden) })}
                </span>
            )}
        </span>
    );
}
