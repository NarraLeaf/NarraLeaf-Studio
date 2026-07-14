import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { ProjectData, ValidationErrors, DirectoryValidationResult } from "../types";
import { versionControlOptions } from "../constants";
import { FolderOpen } from "lucide-react";

interface SettingsStepProps {
    projectData: ProjectData;
    updateProjectData: (updates: Partial<ProjectData>) => void;
    validationErrors: ValidationErrors;
    directoryValidation: DirectoryValidationResult | null;
    isValidatingDirectory: boolean;
    onLocationChange: (value: string) => void;
    onLocationBlur: () => Promise<void>;
    onLocationFocus: () => void;
    onSelectDirectory: () => Promise<void>;
    isSelectingDirectory: boolean;
}

/**
 * Project settings step for configuration options
 */
export function SettingsStep({
    projectData,
    updateProjectData,
    validationErrors,
    directoryValidation,
    isValidatingDirectory,
    onLocationChange,
    onLocationBlur,
    onLocationFocus,
    onSelectDirectory,
    isSelectingDirectory
}: SettingsStepProps) {
    const { t } = useTranslation();
    const localizedVersionControlOptions = versionControlOptions.map((option) => ({
        ...option,
        label: option.labelKey ? t(option.labelKey) : option.label,
    }));
    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.settings.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.settings.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.fields.location")}</CardTitle>
                            <CardDescription>
                                {t("wizard.settings.location.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup
                                label={t("wizard.settings.projectLocation")}
                                required
                                error={validationErrors.location || validationErrors.directory}
                            >
                                <div className="space-y-1">
                                    <div className="relative">
                                        <Input
                                            placeholder={t("wizard.settings.projectLocationPlaceholder")}
                                            value={projectData.location}
                                            onChange={async (e) => await onLocationChange(e.target.value)}
                                            onBlur={onLocationBlur}
                                            onFocus={onLocationFocus}
                                            disabled={isValidatingDirectory}
                                        />
                                        <button
                                            type="button"
                                            onClick={onSelectDirectory}
                                            disabled={isSelectingDirectory || isValidatingDirectory}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <FolderOpen className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {isValidatingDirectory && (
                                        <p className="text-sm text-fg-muted">{t("wizard.settings.validatingDirectory")}</p>
                                    )}

                                    {/* Show informational message when directory doesn't exist */}
                                    {directoryValidation && !directoryValidation.exists && !validationErrors.directory && (
                                        <div className="text-xs text-primary mt-1">
                                            ✓ {t("wizard.settings.directoryWillBeCreated")}
                                        </div>
                                    )}
                                </div>
                            </InputGroup>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.fields.versionControl")}</CardTitle>
                            <CardDescription>
                                {t("wizard.settings.versionControl.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup label={t("wizard.settings.versionControlSystem")}>
                                <Select
                                    options={localizedVersionControlOptions}
                                    value={projectData.versionControl || "git"}
                                    onChange={(value) => updateProjectData({ versionControl: String(value) })}
                                    placeholder={t("wizard.settings.versionControlPlaceholder")}
                                />
                            </InputGroup>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
