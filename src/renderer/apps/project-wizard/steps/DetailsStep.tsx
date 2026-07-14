import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { TextArea } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { ProjectData } from "../types";
import { licenseOptions, resolutionOptions } from "../constants";

interface DetailsStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
    updateProjectName: (name: string) => void;
    updateAppId: (appId: string) => void;
}


/**
 * Project details step for basic project information
 */
export function DetailsStep({ projectData, updateProjectData, updateProjectName, updateAppId }: DetailsStepProps) {
    const { t } = useTranslation();
    const [showCustomLicense, setShowCustomLicense] = useState(false);
    const [appIdError, setAppIdError] = useState("");

    const localizedLicenseOptions = licenseOptions.map((option) => ({
        ...option,
        label: option.labelKey ? t(option.labelKey) : option.label,
    }));

    /**
     * Validate app ID and update error state
     */
    const handleAppIdChange = (value: string) => {
        updateAppId(value);

        if (value.trim() === "") {
            setAppIdError(t("wizard.details.appIdRequired"));
        } else if (!/^[a-z0-9-]+$/.test(value)) {
            setAppIdError(t("wizard.details.appIdInvalid"));
        } else {
            setAppIdError("");
        }
    };

    const handleLicenseChange = (value: string | number) => {
        const stringValue = String(value);
        updateProjectData({ license: stringValue });
        if (stringValue === "Other") {
            setShowCustomLicense(true);
        } else {
            setShowCustomLicense(false);
            updateProjectData({ licenseCustom: "" });
        }
    };

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.details.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.details.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    {/* Basic Information Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.details.basicInfo.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.details.basicInfo.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label={t("wizard.details.projectName")} required>
                                <Input
                                    placeholder={t("wizard.details.projectNamePlaceholder")}
                                    value={projectData.name}
                                    onChange={async (e) => await updateProjectName(e.target.value)}
                                />
                            </InputGroup>

                            <InputGroup
                                label={t("wizard.fields.appId")}
                                required
                                error={appIdError}
                                helper={t("wizard.details.appIdHelper")}
                            >
                                <Input
                                    placeholder={t("wizard.details.appIdPlaceholder")}
                                    value={projectData.appId}
                                    onChange={async (e) => await handleAppIdChange(e.target.value)}
                                    variant={appIdError ? "error" : "default"}
                                    pattern="[a-z0-9-]*"
                                    title={t("wizard.details.appIdInvalid")}
                                />
                            </InputGroup>

                            <InputGroup label={t("wizard.fields.author")}>
                                <Input
                                    placeholder={t("wizard.details.authorPlaceholder")}
                                    value={projectData.author}
                                    onChange={(e) => updateProjectData({ author: e.target.value })}
                                />
                            </InputGroup>

                            <InputGroup label={t("wizard.fields.license")}>
                                <Select
                                    options={localizedLicenseOptions}
                                    value={projectData.license}
                                    onChange={async (value) => await handleLicenseChange(value)}
                                    placeholder={t("wizard.details.licensePlaceholder")}
                                />
                            </InputGroup>

                            {showCustomLicense && (
                                <InputGroup label={t("wizard.details.customLicense")}>
                                    <Input
                                        placeholder={t("wizard.details.customLicensePlaceholder")}
                                        value={projectData.licenseCustom || ""}
                                        onChange={(e) => updateProjectData({ licenseCustom: e.target.value })}
                                    />
                                </InputGroup>
                            )}

                            <InputGroup label={t("common.description")}>
                                <TextArea
                                    placeholder={t("wizard.details.descriptionPlaceholder")}
                                    value={projectData.description}
                                    onChange={(e) => updateProjectData({ description: e.target.value })}
                                    rows={3}
                                />
                            </InputGroup>
                        </CardContent>
                    </Card>

                    {/* Application Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.details.application.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.details.application.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label={t("wizard.fields.resolution")} required>
                                <Select
                                    options={resolutionOptions}
                                    value={projectData.resolution}
                                    onChange={(value) => updateProjectData({ resolution: String(value) })}
                                    placeholder={t("wizard.details.resolutionPlaceholder")}
                                />
                            </InputGroup>
                        </CardContent>
                    </Card>
                </div>

                {/* Validation Messages */}
                {(!projectData.name.trim() || !projectData.resolution || !projectData.appId.trim() || appIdError) && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <div className="flex items-start gap-3">
                            <div className="text-yellow-400 mt-0.5">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-sm font-medium text-yellow-200">
                                    {t("wizard.details.requiredFieldsTitle")}
                                </h3>
                                <p className="text-sm text-yellow-300 mt-1">
                                    {t("wizard.details.requiredFieldsMessage")}
                                    {appIdError && ` ${appIdError}`}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
