import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
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
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.clone.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.clone.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.clone.summary.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.clone.summary.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1 min-w-0">
                                    <label className="font-medium text-fg-muted">{t("wizard.source.parsedServer")}</label>
                                    <p className="text-fg break-all">{remote?.origin ?? projectData.remoteUrl}</p>
                                </div>
                                <div className="space-y-1 min-w-0">
                                    <label className="font-medium text-fg-muted">{t("wizard.source.parsedName")}</label>
                                    <p className="text-fg break-all">{remote?.name ?? t("wizard.review.notSpecified")}</p>
                                </div>
                            </div>
                            <div className="space-y-1 min-w-0">
                                <label className="text-sm font-medium text-fg-muted">
                                    {t("wizard.source.destinationLabel")}
                                </label>
                                <p className="text-sm text-fg break-all">{projectData.location}</p>
                            </div>
                        </CardContent>
                    </Card>

                    {busy && (
                        <div className="flex items-start gap-3 rounded-lg border border-edge bg-fill/50 p-4">
                            <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
                            <p className="text-sm text-fg-muted">{t("wizard.clone.working")}</p>
                        </div>
                    )}

                    {!busy && cloneFailure && (
                        <div className="rounded-lg border border-danger/20 bg-danger/10 p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
                                <div className="min-w-0 flex-1 space-y-1">
                                    <h3 className="text-sm font-medium text-danger">
                                        {cloneFailure.kind === "notAProject"
                                            ? t("wizard.clone.error.notAProjectTitle")
                                            : t("wizard.clone.error.failedTitle")}
                                    </h3>
                                    {/* The path is named, not implied: those files are on disk, they are
                                        why the folder the author picked is no longer usable for a second
                                        attempt, and nothing else on screen says where they went. */}
                                    <p className="break-words text-sm text-danger">
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
        </div>
    );
}
