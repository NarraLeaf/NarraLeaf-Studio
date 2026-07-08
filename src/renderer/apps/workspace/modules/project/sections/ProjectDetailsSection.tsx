import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { TextArea } from "@/lib/components/elements";
import type { ProjectMetadata } from "@/lib/workspace/project/project";
import type { ProjectSectionProps } from "./types";

type MetadataTextKey = "version" | "author" | "website" | "description";

export function ProjectDetailsSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const metadata = config.metadata ?? {};

    const commitName = useCallback(async (value: string) => {
        const nextName = value.trim();
        if (!nextName) {
            uiService?.showNotification("Application name is required.", "warning");
            throw new Error("empty-name");
        }
        const next = await projectService.updateProjectName(nextName);
        onConfigChange(next);
    }, [onConfigChange, projectService, uiService]);

    const commitMetadata = useCallback(async (key: MetadataTextKey, value: string) => {
        const next = await projectService.updateProjectMetadata({ [key]: value } as Partial<ProjectMetadata>);
        onConfigChange(next);
    }, [onConfigChange, projectService]);

    return (
        <div className="grid gap-4">
            <DetailField
                label="Application Name"
                initialValue={config.name ?? ""}
                required
                placeholder="Application name"
                onCommit={commitName}
                onError={message => uiService?.showNotification(message, "error")}
            />

            <ReadOnlyField
                label="Identifier"
                value={config.identifier ?? ""}
                helper="Set when the project was created and used for packaging."
            />

            <DetailField
                label="Version"
                initialValue={metadata.version ?? ""}
                placeholder="1.0.0"
                onCommit={value => commitMetadata("version", value)}
                onError={message => uiService?.showNotification(message, "error")}
            />

            <DetailField
                label="Author"
                initialValue={metadata.author ?? ""}
                placeholder="Author, organization, or email"
                onCommit={value => commitMetadata("author", value)}
                onError={message => uiService?.showNotification(message, "error")}
            />

            <DetailField
                label="Website"
                initialValue={metadata.website ?? ""}
                placeholder="https://example.com"
                onCommit={value => commitMetadata("website", value)}
                onError={message => uiService?.showNotification(message, "error")}
            />

            <DetailField
                label="Description"
                initialValue={metadata.description ?? ""}
                placeholder="Describe your project..."
                multiline
                onCommit={value => commitMetadata("description", value)}
                onError={message => uiService?.showNotification(message, "error")}
            />
        </div>
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
    required = false,
    multiline = false,
}: {
    label: string;
    initialValue: string;
    onCommit: (value: string) => Promise<void>;
    onError?: (message: string) => void;
    placeholder?: string;
    required?: boolean;
    multiline?: boolean;
}) {
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
        <label className="grid gap-1.5">
            <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-fg-subtle">{label}</span>
                {required ? <span className="text-2xs text-fg-subtle">Required</span> : null}
                {saving ? <Loader2 className="h-3 w-3 animate-spin text-fg-subtle" /> : null}
            </div>
            {multiline ? (
                <TextArea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => void commit()}
                    placeholder={placeholder}
                    rows={3}
                    fullWidth
                />
            ) : (
                <EnhancedInput
                    value={draft}
                    onChange={setDraft}
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
