import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { FolderOpen } from "lucide-react";
import { DirectoryValidationResult, ProjectData, ValidationErrors } from "../types";

interface SourceStepProps {
    projectData: ProjectData;
    /** What the address parses to, or null while it is not an address yet. */
    remote: { origin: string; name: string } | null;
    updateRemoteUrl: (url: string) => void;
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
 * Everything a project that already exists needs to be asked.
 *
 * **Two fields, and that is the whole of it.** Name, app id, stage size, licence and author are
 * all already recorded in the project on the server; asking for them here would let the author
 * give answers that the clone then silently overwrites, which is worse than not asking. What is
 * genuinely unknown is where the project is and where it should land.
 *
 * The address is echoed back split into the server and the name it carries, once it parses. That
 * readback is the only feedback available before the transfer starts - the backend has nothing to
 * say about an address until it is asked to use it - and it catches the mistake that actually
 * happens: a colleague's address pasted with the project name of a different project on the end.
 */
export function SourceStep({
    projectData,
    remote,
    updateRemoteUrl,
    validationErrors,
    directoryValidation,
    isValidatingDirectory,
    onLocationChange,
    onLocationBlur,
    onLocationFocus,
    onSelectDirectory,
    isSelectingDirectory,
}: SourceStepProps) {
    const { t } = useTranslation();
    // Only once they have typed something: an empty field is not a mistake, it is a field they
    // have not reached yet.
    const addressInvalid = projectData.remoteUrl.trim() !== "" && !remote;

    return (
        <div className="p-6">
            <div className="space-y-6">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-fg">{t("wizard.source.title")}</h2>
                    <p className="text-sm text-fg-muted">
                        {t("wizard.source.subtitle")}
                    </p>
                </div>

                <div className="grid gap-6 max-w-2xl">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.source.server.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.source.server.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup
                                label={t("wizard.source.addressLabel")}
                                required
                                error={addressInvalid ? t("wizard.source.addressInvalid") : undefined}
                            >
                                <div className="space-y-1">
                                    <Input
                                        autoFocus
                                        placeholder="lore://studio.example.lan:41337/my-game"
                                        value={projectData.remoteUrl}
                                        onChange={(e) => updateRemoteUrl(e.target.value)}
                                    />
                                    <p className="text-xs text-fg-muted">{t("wizard.source.addressHint")}</p>

                                    {remote && (
                                        <div className="grid grid-cols-2 gap-4 pt-2 text-sm">
                                            <div className="space-y-1 min-w-0">
                                                <label className="font-medium text-fg-muted">
                                                    {t("wizard.source.parsedServer")}
                                                </label>
                                                <p className="text-fg break-all">{remote.origin}</p>
                                            </div>
                                            <div className="space-y-1 min-w-0">
                                                <label className="font-medium text-fg-muted">
                                                    {t("wizard.source.parsedName")}
                                                </label>
                                                <p className="text-fg break-all">{remote.name}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </InputGroup>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("wizard.source.destination.title")}</CardTitle>
                            <CardDescription>
                                {t("wizard.source.destination.description")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <InputGroup
                                label={t("wizard.source.destinationLabel")}
                                required
                                error={validationErrors.location || validationErrors.directory}
                            >
                                <div className="space-y-1">
                                    <div className="relative">
                                        <Input
                                            placeholder={t("wizard.settings.projectLocationPlaceholder")}
                                            value={projectData.location}
                                            onChange={(e) => onLocationChange(e.target.value)}
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
                                    {directoryValidation && !directoryValidation.exists && !validationErrors.directory && (
                                        <div className="text-xs text-primary mt-1">
                                            ✓ {t("wizard.source.destinationWillBeCreated")}
                                        </div>
                                    )}
                                    <p className="text-xs text-fg-muted">{t("wizard.source.destinationHint")}</p>
                                </div>
                            </InputGroup>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
