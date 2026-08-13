import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { TextArea } from "@/lib/components/elements";
import type { ProjectMetadata } from "@/lib/workspace/project/project";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

type MetadataTextKey = "version" | "author" | "website" | "copyright" | "copyrightText" | "description";

export function ProjectDetailsSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const metadata = config.metadata ?? {};

    const commitName = useCallback(async (value: string) => {
        const nextName = value.trim();
        if (!nextName) {
            uiService?.showNotification(t("project.details.nameRequired"), "warning");
            throw new Error("empty-name");
        }
        const next = await projectService.updateProjectName(nextName);
        onConfigChange(next);
    }, [onConfigChange, projectService, uiService, t]);

    const commitMetadata = useCallback(async (key: MetadataTextKey, value: string) => {
        const next = await projectService.updateProjectMetadata({ [key]: value } as Partial<ProjectMetadata>);
        onConfigChange(next);
    }, [onConfigChange, projectService]);

    return (
        <SettingsGroup title={t("project.group.details")}>
            {/* Its own gap: these are labelled text fields, not the bordered rows the rest of the
                page is made of, and they read as one form only when the label of each sits closer
                to its own input than to the field above. */}
            <div className="grid gap-3">
                <DetailField
                    label={t("project.details.nameLabel")}
                    initialValue={config.name ?? ""}
                    required
                    placeholder={t("project.details.namePlaceholder")}
                    onCommit={commitName}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                <ReadOnlyField
                    label={t("project.details.identifierLabel")}
                    value={config.identifier ?? ""}
                    helper={t("project.details.identifierHelper")}
                />

                <DetailField
                    label={t("project.details.versionLabel")}
                    initialValue={metadata.version ?? ""}
                    placeholder="1.0.0"
                    onCommit={value => commitMetadata("version", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                <DetailField
                    label={t("project.details.authorLabel")}
                    initialValue={metadata.author ?? ""}
                    placeholder={t("project.details.authorPlaceholder")}
                    onCommit={value => commitMetadata("author", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                <DetailField
                    label={t("project.details.websiteLabel")}
                    initialValue={metadata.website ?? ""}
                    placeholder="https://example.com"
                    onCommit={value => commitMetadata("website", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                {/* Was only ever editable inside the build dialog, which meant the one line that ends
                    up in the packaged app's file properties could not be written without opening a
                    dialog about producing a build. Same service, same field, same file. */}
                <DetailField
                    label={t("project.details.copyrightLabel")}
                    initialValue={metadata.copyright ?? ""}
                    placeholder={t("project.details.copyrightPlaceholder")}
                    onCommit={value => commitMetadata("copyright", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                {/* The notice a player opens, as opposed to the line above that goes into the
                    binary's file properties. Shipped as `COPYRIGHT.txt` beside the game, so it is
                    the one place fonts, music and asset credits can travel with the build. */}
                <DetailField
                    label={t("project.details.copyrightTextLabel")}
                    initialValue={metadata.copyrightText ?? ""}
                    placeholder={t("project.details.copyrightTextPlaceholder")}
                    helper={t("project.details.copyrightTextHelper")}
                    multiline
                    rows={6}
                    onCommit={value => commitMetadata("copyrightText", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />

                <DetailField
                    label={t("common.description")}
                    initialValue={metadata.description ?? ""}
                    placeholder={t("project.details.descriptionPlaceholder")}
                    multiline
                    onCommit={value => commitMetadata("description", value)}
                    onError={message => uiService?.showNotification(message, "error")}
                />
            </div>
        </SettingsGroup>
    );
}

/**
 * Labeled text field that commits its draft on blur (and Enter, for single-line
 * fields) when the value has changed. On a failed commit the draft reverts to
 * the last persisted value.
 */
function DetailField({
    label,
    initialValue,
    onCommit,
    onError,
    placeholder,
    helper,
    required = false,
    multiline = false,
    rows = 3,
}: {
    label: string;
    initialValue: string;
    onCommit: (value: string) => Promise<void>;
    onError?: (message: string) => void;
    placeholder?: string;
    /** One line under the field, for a field whose effect is not visible from its name. */
    helper?: string;
    required?: boolean;
    multiline?: boolean;
    rows?: number;
}) {
    const { t } = useTranslation();
    // Name, version, author, website and description all commit to `project.json` on blur - which is
    // the trap: a frozen field takes the whole edit and only refuses at the blur nobody watches. So the
    // field is disabled rather than merely refused, and the reason is on it.
    const freeze = useFreezeGuard();
    const frozen = freeze.writes();
    const [draft, setDraft] = useState(initialValue);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDraft(initialValue);
    }, [initialValue]);

    const commit = useCallback(async () => {
        if (saving || draft === initialValue) {
            return;
        }
        setSaving(true);
        try {
            await onCommit(multiline ? draft : draft.trim());
        } catch (error) {
            setDraft(initialValue);
            if (error instanceof Error && error.message !== "empty-name") {
                onError?.(error.message);
            } else if (!(error instanceof Error)) {
                onError?.(String(error));
            }
        } finally {
            setSaving(false);
        }
    }, [draft, initialValue, multiline, onCommit, onError, saving]);

    return (
        <label className="grid gap-1.5" data-tip={frozen["data-tip"]}>
            <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-fg-subtle">{label}</span>
                {required ? <span className="text-2xs text-fg-subtle">{t("project.details.required")}</span> : null}
                {saving ? <Loader2 className="h-3 w-3 animate-spin text-fg-subtle" /> : null}
            </div>
            {multiline ? (
                <TextArea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => void commit()}
                    placeholder={placeholder}
                    rows={rows}
                    fullWidth
                    disabled={frozen.disabled}
                />
            ) : (
                <EnhancedInput
                    value={draft}
                    onChange={setDraft}
                    disabled={frozen.disabled}
                    onBlur={() => void commit()}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                            setDraft(initialValue);
                            event.currentTarget.blur();
                        }
                    }}
                    placeholder={placeholder}
                />
            )}
            {helper ? <span className="text-2xs text-fg-subtle">{helper}</span> : null}
        </label>
    );
}

function ReadOnlyField({
    label,
    value,
    helper,
}: {
    label: string;
    value: string;
    helper?: string;
}) {
    return (
        <div className="grid gap-1.5">
            <span className="text-xs font-medium text-fg-subtle">{label}</span>
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2.5 py-1.5">
                <Lock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                <span className="min-w-0 truncate text-sm text-fg-muted">{value || "—"}</span>
            </div>
            {helper ? <span className="text-2xs text-fg-subtle">{helper}</span> : null}
        </div>
    );
}
