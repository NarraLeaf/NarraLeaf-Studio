import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, Select } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { applyImport, backupToTeam, exportSettings, planImport, planTeamRestore } from "@/lib/settings/transferSettings";
import type { SettingsImportPlan } from "@shared/utils/settingsDocument";
import type { VcsServerSession } from "@shared/types/vcs";

/**
 * Moving preferences between machines.
 *
 * A panel rather than two Action rows because the import has to show what it would do before it
 * does it, which a row cannot hold. Reading an import back is the whole safety property here: the
 * file is JSON an author can edit, and applying it blind is how a settings transfer becomes a
 * settings loss.
 *
 * The export takes no options. It writes a plain JSON document of the preferences, minus the two
 * groups that have no meaning on another machine; a configuration surface for choosing what goes
 * into a settings file would be a second settings system serving one question.
 *
 * The preview is inline rather than a modal: it is a short list, it is the only thing this panel
 * is doing at that moment, and a dialog over a settings window is a layer nothing here needs.
 *
 * Signed in to a Team server, the same document can also be kept there and read back on the next
 * computer. A restore from the server goes through the same preview as a file: it is a document
 * that could have been edited (the web console takes uploads too), so it is read before it is
 * applied, never applied blind.
 */
export function SettingsTransferPanel() {
    const { t, tn } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
    const [plan, setPlan] = useState<SettingsImportPlan | null>(null);
    const [servers, setServers] = useState<VcsServerSession[]>([]);
    const [server, setServer] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void getInterface().vcs.listServers().then(listed => {
            if (!live || !listed.success) {
                return;
            }
            setServers(listed.data.servers);
            setServer(current => current ?? listed.data.servers[0]?.remoteOrigin ?? null);
        }).catch(() => undefined);
        return () => {
            live = false;
        };
    }, []);

    const serverLabel = useCallback(
        (origin: string | null) => {
            const found = servers.find(each => each.remoteOrigin === origin);
            return found?.name ?? found?.authUrl ?? origin ?? "";
        },
        [servers],
    );

    const runBackup = useCallback(async () => {
        if (server === null) {
            return;
        }
        setBusy(true);
        setMessage(null);
        setPlan(null);
        try {
            await backupToTeam(server);
            setMessage({ tone: "ok", text: t("settings.transfer.team.backedUp", { server: serverLabel(server) }) });
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [server, serverLabel, t]);

    const runRestore = useCallback(async () => {
        if (server === null) {
            return;
        }
        setBusy(true);
        setMessage(null);
        setPlan(null);
        try {
            const result = await planTeamRestore(server);
            if (result) {
                setPlan(result);
            } else {
                setMessage({ tone: "ok", text: t("settings.transfer.team.nothingKept", { server: serverLabel(server) }) });
            }
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [server, serverLabel, t]);

    const runExport = useCallback(async () => {
        setBusy(true);
        setMessage(null);
        try {
            const result = await exportSettings();
            if (!result.canceled) {
                setMessage({ tone: "ok", text: t("settings.transfer.exported", { path: result.filePath ?? "" }) });
            }
        } catch (error) {
            setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [t]);

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
            setMessage({ tone: "ok", text: tn("settings.transfer.imported", applied) });
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
            {/* Two rows in the pane's own layout: what happens on the left, the presses on the right.
                Export and import are one pair of equal weight, so they share one look. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <p className="min-w-0 grow basis-64 text-xs text-fg-subtle">{t("settings.transfer.exportHint")}</p>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => void runExport()}>
                        {t("settings.transfer.export")}
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => void runPlan()}>
                        {t("settings.transfer.import")}
                    </Button>
                </div>
            </div>

            {servers.length > 0 && (
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <p className="min-w-0 grow basis-64 text-xs text-fg-subtle">{t("settings.transfer.team.hint")}</p>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        {servers.length > 1 && (
                            <Select
                                size="sm"
                                className="w-48"
                                ariaLabel={t("settings.transfer.team.server")}
                                value={server ?? undefined}
                                options={servers.map(each => ({ value: each.remoteOrigin, label: each.name ?? each.authUrl }))}
                                onChange={value => setServer(String(value))}
                            />
                        )}
                        <Button size="sm" variant="secondary" className="h-7" disabled={busy || server === null} onClick={() => void runBackup()}>
                            {t("settings.transfer.team.backup")}
                        </Button>
                        <Button size="sm" variant="secondary" className="h-7" disabled={busy || server === null} onClick={() => void runRestore()}>
                            {t("settings.transfer.team.restore")}
                        </Button>
                    </div>
                </div>
            )}

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
