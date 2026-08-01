import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import type { VcsAvailability } from "@shared/types/vcs";
import { ProjectData, ValidationErrors, DirectoryValidationResult, VersionControlChoice } from "../types";
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
    const vcsAvailability = useVcsAvailability();
    // Absent while the probe is in flight, which is the honest state: neither "available" nor
    // "not". Offering Lore before the answer arrives and withdrawing it a moment later is worse
    // than a field that is briefly short one option.
    const loreOffered = vcsAvailability?.available === true;
    const localizedVersionControlOptions = versionControlOptions
        // Removed rather than shown disabled: `Select` has no per-option disabled state, and a
        // choice that cannot be taken is not information the author of a new project needs -
        // the line under the field says why it is missing.
        .filter((option) => option.value !== "lore" || loreOffered)
        .map((option) => ({
            ...option,
            label: option.labelKey ? t(option.labelKey) : option.label,
        }));

    // Nobody can create a Lore repository on this host, so the field must not be left saying it
    // will. Written back into the wizard's own data instead of only being displayed as `none`,
    // because `ProjectService.createProject` reads that data and not this render.
    useEffect(() => {
        if (vcsAvailability && !vcsAvailability.available && projectData.versionControl !== "none") {
            updateProjectData({ versionControl: "none" });
        }
    }, [vcsAvailability, projectData.versionControl, updateProjectData]);

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
                                            title={t("wizard.settings.browseLocation")}
                                            aria-label={t("wizard.settings.browseLocation")}
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
                                <div className="space-y-1">
                                    <Select
                                        options={localizedVersionControlOptions}
                                        value={projectData.versionControl}
                                        onChange={(value) =>
                                            updateProjectData({ versionControl: value as VersionControlChoice })}
                                        placeholder={t("wizard.settings.versionControlPlaceholder")}
                                    />
                                    {projectData.versionControl === "lore" && (
                                        <p className="text-xs text-fg-muted">
                                            {t("wizard.settings.versionControl.loreHint")}
                                        </p>
                                    )}
                                    {vcsAvailability && !vcsAvailability.available && (
                                        <p className="text-xs text-fg-muted">
                                            {t(vcsAvailability.reason === "unsupported-platform"
                                                ? "wizard.settings.versionControl.unavailablePlatform"
                                                : "wizard.settings.versionControl.unavailableInstallation")}
                                        </p>
                                    )}
                                </div>
                            </InputGroup>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

/**
 * Whether this machine can create a Lore repository at all.
 *
 * Asked because version control is an OPTIONAL capability - Epic ships no native build for macOS
 * Intel or Windows ARM64 - and "unavailable" is a normal answer with a reason rather than an
 * error. Without this the wizard would offer, and pre-select, a choice whose only outcome on those
 * hosts is a failed `initRepository` after the project directory has already been written.
 *
 * `null` until the probe answers. A failed IPC call is treated as unavailable rather than left
 * pending: the alternative is a field stuck one option short with nothing said about why.
 */
function useVcsAvailability(): VcsAvailability | null {
    const [availability, setAvailability] = useState<VcsAvailability | null>(null);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const result = await getInterface().vcs.getAvailability();
                if (!alive) return;
                setAvailability(result.success
                    ? result.data
                    : { available: false, reason: "backend-load-failed", detail: result.error });
            } catch (error) {
                if (!alive) return;
                setAvailability({ available: false, reason: "backend-load-failed", detail: String(error) });
            }
        })();
        return () => { alive = false; };
    }, []);

    return availability;
}
