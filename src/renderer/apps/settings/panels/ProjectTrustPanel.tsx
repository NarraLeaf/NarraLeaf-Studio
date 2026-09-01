import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel } from "@/lib/components/elements";
import type { ProjectImportOrigin, ProjectTrustRecord } from "@shared/types/projectTrust";
import type { TranslationKey } from "@shared/i18n";

const ORIGIN_LABELS: Record<ProjectImportOrigin, TranslationKey> = {
    package: "settings.data.projectTrust.origin.package",
    remote: "settings.data.projectTrust.origin.remote",
};

/**
 * The projects that arrived from elsewhere, and which of them the author has vouched for.
 *
 * Only external arrivals appear. A project the author created has no row here and never needed one,
 * so this list is short by design - it is not an inventory of everything Studio has opened.
 *
 * Removing a grant does not touch a window already open on that project. Trust is read once when a
 * workspace starts, so the change lands on the next launch; the row says so rather than leaving the
 * author to discover it.
 */
export function ProjectTrustPanel() {
    const { t } = useTranslation();
    const [trusted, setTrusted] = useState<ProjectTrustRecord[]>([]);
    const [distrusted, setDistrusted] = useState<ProjectTrustRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

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
        const api = getInterface().projectTrust;
        await (grant ? api.grant(record.displayPath) : api.revoke(record.displayPath));
        setBusy(null);
        await load();
    }, [load]);

    const row = (record: ProjectTrustRecord, grant: boolean) => (
        <div key={record.path} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-fill">
            <p className="min-w-0 flex-1 truncate text-sm text-fg-muted" data-tip={record.displayPath}>
                {record.displayPath}
            </p>
            <span className="shrink-0 text-2xs text-fg-subtle">{t(ORIGIN_LABELS[record.origin])}</span>
            <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0"
                disabled={busy !== null}
                onClick={() => void act(record, grant)}
            >
                {t(grant ? "settings.data.projectTrust.trust" : "settings.data.projectTrust.remove")}
            </Button>
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
                    <p className="px-2 text-2xs text-fg-subtle">
                        {t("settings.data.projectTrust.removeNote")}
                    </p>
                </div>
            )}
        </div>
    );
}
