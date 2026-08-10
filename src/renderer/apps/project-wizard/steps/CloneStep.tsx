import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CloneFailure, CloneStatus, ProjectData } from "../types";

interface CloneStepProps {
    projectData: ProjectData;
    remote: { origin: string; name: string } | null;
    cloneStatus: CloneStatus;
    cloneFailure: CloneFailure | null;
}

/**
 * The last page of the clone flow: what is about to happen, and then what happened.
 *
 * **Nothing has touched the network before this page.** The whole project comes down when the
 * button in the footer is pressed, so this reads as a summary until then - the same shape the
 * create flow's Review has, for the same reason: the author should be able to see what they
 * chose without having to walk backwards to find it.
 *
 * While it runs there is a spinner and a sentence, and deliberately no progress bar. The backend
 * collects a clone's per-fragment events and delivers them when the call finishes, so a bar here
 * would sit at zero and then vanish - which reads as broken in exactly the case (a big project, a
 * slow link) where the author most needs to believe it is working.
 */
export function CloneStep({ projectData, remote, cloneStatus, cloneFailure }: CloneStepProps) {
    const { t } = useTranslation();
    const busy = cloneStatus === "cloning";

    return (
        <div className="h-full overflow-y-auto p-5">
            <div className="max-w-xl space-y-4">
                <div className="overflow-hidden rounded-md border border-edge">
                    <SummaryRow
                        label={t("wizard.source.parsedServer")}
                        value={remote?.origin ?? projectData.remoteUrl}
                        first
                    />
                    <SummaryRow
                        label={t("wizard.source.parsedName")}
                        value={remote?.name ?? t("wizard.review.notSpecified")}
                    />
                    <SummaryRow label={t("wizard.fields.location")} value={projectData.location} />
                </div>

                <p className="text-sm text-fg-muted">{t("wizard.clone.subtitle")}</p>

                {busy && (
                    <div className="flex items-center gap-2 text-sm text-fg-muted">
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                        {t("wizard.clone.working")}
                    </div>
                )}

                {!busy && cloneFailure && (
                    <div className="rounded-md border border-danger/20 bg-danger/10 p-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                            <div className="min-w-0 flex-1 space-y-1">
                                <p className="text-sm font-medium text-danger">
                                    {cloneFailure.kind === "notAProject"
                                        ? t("wizard.clone.error.notAProjectTitle")
                                        : t("wizard.clone.error.failedTitle")}
                                </p>
                                {/* The path is named, not implied: those files are on disk, they are
                                    why the folder the author picked is no longer usable for a second
                                    attempt, and nothing else on screen says where they went. */}
                                <p className="break-words text-xs text-danger">
                                    {cloneFailure.kind === "notAProject"
                                        ? t("wizard.clone.error.notAProject", { path: cloneFailure.destination })
                                        : cloneFailure.message}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryRow({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
    return (
        <div
            className={`flex items-baseline justify-between gap-4 px-3 py-2 text-sm ${
                first ? "" : "border-t border-edge"
            }`}
        >
            <span className="shrink-0 text-fg-muted">{label}</span>
            <span className="min-w-0 break-all text-right text-fg">{value}</span>
        </div>
    );
}
