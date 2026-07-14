import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { ProjectData } from "../types";
import { projectTemplates } from "../constants";

interface ReviewStepProps {
    projectData: ProjectData;
}

/**
 * Project review step to confirm settings before creation
 */
export function ReviewStep({ projectData }: ReviewStepProps) {
    const { t } = useTranslation();
    const selectedTemplate = projectTemplates.find(tpl => tpl.id === projectData.template);

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.review.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.review.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    {/* Project Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.review.summary.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.review.summary.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-fg-muted">{t("common.name")}</label>
                                    <p className="text-sm text-fg">{projectData.name || t("wizard.review.notSpecified")}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-fg-muted">{t("wizard.fields.author")}</label>
                                    <p className="text-sm text-fg">{projectData.author || t("wizard.review.notSpecified")}</p>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-sm font-medium text-fg-muted">{t("wizard.fields.license")}</label>
                                <p className="text-sm text-fg">
                                    {projectData.license === "Other"
                                        ? (projectData.licenseCustom || t("wizard.review.custom"))
                                        : (projectData.license || t("wizard.review.notSpecified"))}
                                </p>
                            </div>

                            {projectData.description && (
                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-fg-muted">{t("common.description")}</label>
                                    <p className="text-sm text-fg">{projectData.description}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Template Information */}
                    {selectedTemplate && (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("wizard.review.selectedTemplate.title")}</CardTitle>
                                <CardDescription>
                                    {t("wizard.review.selectedTemplate.description")}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-start gap-3">
                                    <div className="text-2xl text-fg-muted">
                                        <selectedTemplate.icon className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-medium text-fg">
                                            {selectedTemplate.nameKey ? t(selectedTemplate.nameKey) : selectedTemplate.name}
                                        </h3>
                                        <p className="text-sm text-fg-muted mt-1">
                                            {selectedTemplate.descriptionKey ? t(selectedTemplate.descriptionKey) : selectedTemplate.description}
                                        </p>
                                        <span className="text-xs text-fg-subtle bg-fill px-2 py-1 rounded mt-2 inline-block">
                                            {selectedTemplate.categoryKey ? t(selectedTemplate.categoryKey) : selectedTemplate.category}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Project Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.settings.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.review.settings.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1">
                                    <label className="font-medium text-fg-muted">{t("wizard.fields.location")}</label>
                                    <p className="text-fg">{projectData.location}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-fg-muted">{t("wizard.fields.versionControl")}</label>
                                    <p className="text-fg">
                                        {projectData.versionControl === "none" ? t("common.none") : "Git"}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-fg-muted">{t("wizard.fields.resolution")}</label>
                                    <p className="text-fg">{projectData.resolution || t("wizard.review.notSpecified")}</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="font-medium text-fg-muted">{t("wizard.fields.appId")}</label>
                                    <p className="text-fg">{projectData.appId || t("wizard.review.notSpecified")}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
