import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { AlertTriangle, FileArchive, FolderOpen, Loader2 } from "lucide-react";
import { ImportFailure, ImportStatus } from "../types";

interface ImportStepProps {
    importStatus: ImportStatus;
    importFailure: ImportFailure | null;
}

/**
 * The import flow's only page: what the button is about to ask for, and then what happened.
 *
 * **It has no fields because there is nothing here to collect.** Both choices an import needs -
 * which package, and where to put it - are made in native dialogs that the main process puts up
 * when the button is pressed. Duplicating them as text boxes would mean either asking twice or
 * building a second, worse file picker.
 *
 * So the page's job is to say what is coming before it arrives. Two native dialogs opening
 * back-to-back is startling if nobody warned you, and the second one ("where to put it") is easy
 * to mistake for the first if you did not know there would be two.
 */
export function ImportStep({ importStatus, importFailure }: ImportStepProps) {
    const { t } = useTranslation();
    const busy = importStatus === "picking";

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.import.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.import.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.import.steps.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.import.steps.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-start gap-3">
                                <FileArchive className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-muted" />
                                <p className="text-sm text-fg">{t("wizard.import.steps.pickPackage")}</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <FolderOpen className="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-muted" />
                                <p className="text-sm text-fg">{t("wizard.import.steps.pickFolder")}</p>
                            </div>
                        </CardContent>
                    </Card>

                    {busy && (
                        <div className="flex items-start gap-3 rounded-lg border border-edge bg-fill/50 p-4">
                            <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
                            <p className="text-sm text-fg-muted">{t("wizard.import.working")}</p>
                        </div>
                    )}

                    {!busy && importFailure && (
                        <div className="rounded-lg border border-danger/20 bg-danger/10 p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
                                <div className="min-w-0 flex-1 space-y-1">
                                    <h3 className="text-sm font-medium text-danger">
                                        {importFailure.kind === "notAProject"
                                            ? t("wizard.import.error.notAProjectTitle")
                                            : t("wizard.import.error.failedTitle")}
                                    </h3>
                                    <p className="break-words text-sm text-danger">
                                        {importFailure.kind === "notAProject"
                                            ? t("wizard.import.error.notAProject", { path: importFailure.destination })
                                            : importFailure.message}
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
