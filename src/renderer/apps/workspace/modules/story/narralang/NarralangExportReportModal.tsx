import { AlertTriangle } from "lucide-react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { NarralangIssueRow } from "./narralangIo";

const ROW = "flex flex-col gap-1 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";
const NOTE = "flex items-start gap-1.5 text-2xs text-warning";

/**
 * Which rows the file does not carry, after it has been written.
 *
 * Shown *after* the write, never instead of it: the export is best effort by design (see the plan's
 * "the gate"), and a reviewer with an incomplete script is better off than one with no script. What
 * they cannot get from the file itself is which rows are missing from it, so that is all this says.
 *
 * Rows are named by the sentence the editor's own row list shows them with, never by an identifier -
 * an author finds the row by reading down the scene, and a UUID here would be unfindable.
 */
export function NarralangExportReportModal(props: {
    rows: NarralangIssueRow[] | null;
    onClose: () => void;
}) {
    const { t, tn } = useTranslation();
    const rows = props.rows;

    return (
        <Modal
            isOpen={rows !== null}
            onClose={props.onClose}
            title={t("story.narralang.reportTitle")}
            helpTopic="storyScript"
            size="lg"
            footer={
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary" })}
                    onClick={props.onClose}
                >
                    {t("common.close")}
                </button>
            }
        >
            {rows && (
                <div className="flex flex-col gap-3">
                    <p className="px-1 text-xs text-fg-subtle">{tn("story.narralang.reportSummary", rows.length)}</p>
                    <div className="flex flex-col gap-1.5">
                        {rows.map(row => (
                            <div key={row.blockId} className={ROW}>
                                <div className="flex items-baseline gap-2">
                                    {row.sceneName !== "" && (
                                        <span className="shrink-0 text-2xs text-fg-subtle">{row.sceneName}</span>
                                    )}
                                    <span className="min-w-0 flex-1 truncate">{row.description}</span>
                                </div>
                                {row.reasons.map(({ reason, detail }) => (
                                    <div key={`${reason}:${detail ?? ""}`} className={NOTE}>
                                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                                        <span className="min-w-0 flex-1">
                                            {/* A dangling reference is the reason an author meets most, and the
                                                generic sentence leaves them guessing whether the missing thing is
                                                an asset or a character. Only this reason carries a detail worth
                                                naming; the rest say all they can from the reason alone. */}
                                            {reason === "unresolvedRef" && detail
                                                ? t("story.narralang.unresolvedRefNamed", {
                                                    what: t(`story.narralang.detail.${detail}` as TranslationKey),
                                                })
                                                : t(`story.narralang.reason.${reason}` as TranslationKey)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Modal>
    );
}
