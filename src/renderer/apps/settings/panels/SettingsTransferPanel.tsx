import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Button, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import {
    applyImport,
    DEFAULT_EXPORT_OPTIONS,
    exportSettings,
    planImport,
    type SettingsExportOptions,
} from "@/lib/settings/transferSettings";
import type { SettingsImportPlan } from "@shared/utils/settingsDocument";

/**
 * Moving preferences between machines.
 *
 * A panel rather than two Action rows because both halves need something a row cannot hold: the
 * export has two opt-ins, and the import has to show what it would do before it does it. Reading
 * an import back is the whole safety property here - the file is JSON an author can edit, and
 * applying it blind is how a settings transfer becomes a settings loss.
 *
 * The preview is inline rather than a modal: it is a short list, it is the only thing this panel
 * is doing at that moment, and a dialog over a settings window is a layer nothing here needs.
 */
export function SettingsTransferPanel() {
    const { t } = useTranslation();
    const [options, setOptions] = useState<SettingsExportOptions>(DEFAULT_EXPORT_OPTIONS);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
    const [plan, setPlan] = useState<SettingsImportPlan | null>(null);

    const runExport = useCallback(async () => {
        setBusy(true);
        setMessage(null);
        try {
            const result = await exportSettings(options);
            if (!result.canceled) {
                setMessage({ tone: "ok", text: t("settings.transfer.exported", { path: result.filePath ?? "" }) });
            }
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [options, t]);

    const runPlan = useCallback(async () => {
        setBusy(true);
        setMessage(null);
        setPlan(null);
        try {
            const result = await planImport();
            if (result) {
                setPlan(result.plan);
            }
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, []);

    const runApply = useCallback(async () => {
        if (!plan) {
            return;
        }
        setBusy(true);
        try {
            const applied = await applyImport(plan);
            setPlan(null);
            setMessage({ tone: "ok", text: t("settings.transfer.imported", { count: String(applied) }) });
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [plan, t]);

    const skipped = plan ? plan.entries.filter(entry => entry.verdict === "unknown" || entry.verdict === "invalid") : [];
    const unchanged = plan ? plan.entries.filter(entry => entry.verdict === "same").length : 0;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <p className="text-xs text-fg-muted">{t("settings.transfer.exportHint")}</p>
                <label className="flex h-7 items-center gap-2 text-xs text-fg-muted">
                    <Switch
                        size="sm"
                        checked={options.includeWallpaper}
                        onCheckedChange={includeWallpaper => setOptions(prev => ({ ...prev, includeWallpaper }))}
                    />
                    {t("settings.transfer.includeWallpaper")}
                </label>
                <label className="flex h-7 items-center gap-2 text-xs text-fg-muted">
                    <Switch
                        size="sm"
                        checked={options.includeIdentity}
                        onCheckedChange={includeIdentity => setOptions(prev => ({ ...prev, includeIdentity }))}
                    />
                    {t("settings.transfer.includeIdentity")}
                </label>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => void runExport()}>
                        {t("settings.transfer.export")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void runPlan()}>
                        {t("settings.transfer.import")}
                    </Button>
                </div>
            </div>

            {plan && (
                <div className="flex flex-col gap-2 rounded-md border border-edge bg-fill-subtle p-2">
                    <p className="text-xs text-fg-muted">
                        {t("settings.transfer.planSummary", {
                            change: String(plan.applicable.length),
                            same: String(unchanged),
                            skipped: String(skipped.length),
                        })}
                    </p>
                    {plan.applicable.length > 0 && (
                        <div className="max-h-48 overflow-y-auto">
                            {plan.applicable.map(entry => (
                                <div key={entry.key} className="flex h-6 items-center gap-2 text-2xs">
                                    <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.key}</span>
                                    <span className="min-w-0 max-w-40 truncate text-fg-subtle line-through">
                                        {formatValue(entry.current)}
                                    </span>
                                    <span className="min-w-0 max-w-40 truncate text-fg">{formatValue(entry.incoming)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {skipped.length > 0 && (
                        <div className="max-h-24 overflow-y-auto">
                            {skipped.map(entry => (
                                <p key={entry.key} className="truncate text-2xs text-fg-subtle">
                                    {entry.verdict === "unknown"
                                        ? t("settings.transfer.skippedUnknown", { key: entry.key })
                                        : t("settings.transfer.skippedInvalid", { key: entry.key, reason: entry.reason ?? "" })}
                                </p>
                            ))}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="primary"
                            className="h-7"
                            disabled={busy || plan.applicable.length === 0}
                            onClick={() => void runApply()}
                        >
                            {t("settings.transfer.apply")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setPlan(null)}>
                            {t("common.cancel")}
                        </Button>
                    </div>
                </div>
            )}

            {message && (
                <p className={cn("truncate text-xs", message.tone === "ok" ? "text-fg-subtle" : "text-danger")}>
                    {message.text}
                </p>
            )}
        </div>
    );
}

/**
 * A value as one short line. Whole objects are summarized rather than dumped.
 *
 * An unset value renders as nothing at all, which in the struck-through "before" column reads as
 * "there was nothing here" - which is what it means.
 */
function formatValue(value: unknown): string {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value || "\"\"";
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.length}]`;
    }
    return "{…}";
}
