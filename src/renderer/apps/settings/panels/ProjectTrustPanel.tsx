import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel, IconButton } from "@/lib/components/elements";
import { PROJECT_TRUST_ORIGIN_LABEL } from "@/lib/app/projectTrustOriginLabel";
import type { ProjectTrustRecord } from "@shared/types/projectTrust";

/**
 * The projects Studio did not create, and which of them the author has vouched for.
 *
 * Studio's own projects never appear: they are trusted from the moment the wizard writes them, and
 * the author is not asked about their own work. What is listed is every other project Studio has
 * met - opened from a folder, unpacked from a package, cloned from a server - either waiting for a
 * decision or trusted by the author, here or by naming it to a command-line build.
 *
 * A decision reaches a window already open on that project: the host reloads it, so its run
 * controls and status bar read the ledger again, and stops what the project was running when trust
 * is withdrawn. The note under the lists says so rather than leaving the author to discover it.
 *
 * Every row can also be removed outright. A removed project is one Studio never met: it does not
 * run, and opening it again asks again. The one row that stays is a waiting project inside a
 * trusted one, which says so on the row instead.
 */
export function ProjectTrustPanel() {
    const { t } = useTranslation();
    const [trusted, setTrusted] = useState<ProjectTrustRecord[]>([]);
    const [distrusted, setDistrusted] = useState<ProjectTrustRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [covered, setCovered] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const result = await getInterface().projectTrust.list();
        if (result.success) {
            setTrusted(result.data.trusted);
            setDistrusted(result.data.distrusted);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const act = useCallback(async (record: ProjectTrustRecord, grant: boolean) => {
        setBusy(record.path);
        setCovered(null);
        const api = getInterface().projectTrust;
        await (grant ? api.grant(record.displayPath) : api.revoke(record.displayPath));
        setBusy(null);
        await load();
    }, [load]);

    const forget = useCallback(async (record: ProjectTrustRecord) => {
        setBusy(record.path);
        setCovered(null);
        const result = await getInterface().projectTrust.forget(record.displayPath);
        setBusy(null);
        if (result.success && result.data.result === "covered") {
            setCovered(record.path);
            return;
        }
        await load();
    }, [load]);

    const row = (record: ProjectTrustRecord, grant: boolean) => (
        <div key={record.path} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-fill">
            <p className="min-w-0 flex-1 truncate text-sm text-fg-muted" data-tip={record.displayPath}>
                {record.displayPath}
            </p>
            <span className="shrink-0 text-2xs text-fg-subtle">
                {t(covered === record.path ? "settings.data.projectTrust.deleteCovered" : PROJECT_TRUST_ORIGIN_LABEL[record.origin])}
            </span>
            <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0"
                disabled={busy !== null}
                onClick={() => void act(record, grant)}
            >
                {t(grant ? "settings.data.projectTrust.trust" : "settings.data.projectTrust.revoke")}
            </Button>
            <IconButton
                size="sm"
                variant="ghost"
                aria-label={t("settings.data.projectTrust.delete")}
                data-tip={t("settings.data.projectTrust.delete")}
                disabled={busy !== null}
                onClick={() => void forget(record)}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
        </div>
    );

    if (loading) {
        return <p className="text-xs text-fg-subtle">{t("settings.data.projectTrust.loading")}</p>;
    }

    if (trusted.length === 0 && distrusted.length === 0) {
        return <p className="text-xs text-fg-subtle">{t("settings.data.projectTrust.empty")}</p>;
    }

    return (
        <div className="flex flex-col gap-4">
            {distrusted.length > 0 && (
                <div className="flex flex-col gap-1">
                    <FieldLabel>{t("settings.data.projectTrust.waiting")}</FieldLabel>
                    {distrusted.map(record => row(record, true))}
                </div>
            )}
            {trusted.length > 0 && (
                <div className="flex flex-col gap-1">
                    <FieldLabel>{t("settings.data.projectTrust.granted")}</FieldLabel>
                    {trusted.map(record => row(record, false))}
                </div>
            )}
            <p className="px-2 text-2xs text-fg-subtle">
                {t("settings.data.projectTrust.reloadNote")}
            </p>
        </div>
    );
}
