import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, EmptyState, SectionCard } from "@/lib/components/elements";
import { formatBytes } from "@shared/utils/formatBytes";
import type { AvailableSpellcheckDictionary, InstalledSpellcheckDictionary } from "@shared/types/spellcheck";
import { notifyDictionariesChanged } from "./dictionaryChanges";

/**
 * The spelling dictionaries on this machine, and the ones that can be fetched.
 *
 * Its reason for existing is that a dictionary is now a thing the author owns rather than something
 * the browser arranged behind them. Chromium used to fetch its own packs, from its own servers,
 * without passing through the main process; Studio downloads word lists it names, verifies and keeps
 * in a cache — so the list of them is something the author can be shown, and each one is something
 * they chose.
 *
 * Nothing here reaches the network until it is asked to. The index is remote, so browsing it is a
 * button rather than something that happens because a settings page was opened, and a download is a
 * second, separate press against a named size and licence.
 */
export function DictionariesPanel() {
    const { t } = useTranslation();
    const [installed, setInstalled] = useState<InstalledSpellcheckDictionary[] | null>(null);
    const [available, setAvailable] = useState<AvailableSpellcheckDictionary[] | null>(null);
    const [browsing, setBrowsing] = useState(false);
    /** The code of the dictionary being downloaded or removed, so one row at a time reads as busy. */
    const [busy, setBusy] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    const readInstalled = useCallback(async (announce = false) => {
        const result = await getInterface().app.spellcheck.listInstalled().catch(() => null);
        setInstalled(result?.success ? result.data.languages : []);
        if (announce) {
            // The language row on this same page offers exactly these codes, and a window does not
            // lose focus to itself - so it is told rather than left to find out.
            notifyDictionariesChanged();
        }
    }, []);

    useEffect(() => {
        void readInstalled();
    }, [readInstalled]);

    const browse = useCallback(async () => {
        setBrowsing(true);
        setFailed(false);
        const result = await getInterface().app.spellcheck.listAvailable().catch(() => null);
        if (result?.success) {
            setAvailable(result.data.entries);
        } else {
            setFailed(true);
        }
        setBrowsing(false);
    }, []);

    const download = useCallback(async (code: string) => {
        setBusy(code);
        setFailed(false);
        const result = await getInterface().app.spellcheck.download(code).catch(() => null);
        if (!result?.success || !result.data.ok) {
            setFailed(true);
        }
        setBusy(null);
        await readInstalled(true);
    }, [readInstalled]);

    const remove = useCallback(async (code: string) => {
        setBusy(code);
        await getInterface().app.spellcheck.remove(code).catch(() => null);
        setBusy(null);
        await readInstalled(true);
    }, [readInstalled]);

    const installedCodes = new Set((installed ?? []).map(entry => entry.code));
    const offered = (available ?? []).filter(entry => !installedCodes.has(entry.code));

    return (
        <div className="flex flex-col gap-3">
            <SectionCard title={t("settings.dictionaries.installed.title")} bodyClassName="p-2">
                {installed === null ? (
                    <p className="px-1 py-1 text-xs text-fg-subtle">{t("settings.dictionaries.loading")}</p>
                ) : installed.length === 0 ? (
                    <EmptyState
                        size="sm"
                        title={t("settings.dictionaries.installed.emptyTitle")}
                        description={t("settings.dictionaries.installed.emptyDescription")}
                    />
                ) : (
                    <div className="flex flex-col">
                        {installed.map(entry => (
                            <div key={entry.code} className="flex min-h-7 items-center gap-3 rounded-md px-1 hover:bg-fill-subtle">
                                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{entry.name}</span>
                                <span className="shrink-0 text-2xs text-fg-subtle">{entry.code}</span>
                                <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(entry.bytes)}</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy !== null}
                                    onClick={() => void remove(entry.code)}
                                >
                                    {t("settings.dictionaries.remove")}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>

            <SectionCard
                title={t("settings.dictionaries.available.title")}
                bodyClassName="p-2"
                actions={
                    <Button size="sm" variant="secondary" disabled={browsing || busy !== null} onClick={() => void browse()}>
                        {t(available === null ? "settings.dictionaries.browse" : "settings.dictionaries.refresh")}
                    </Button>
                }
            >
                {available === null ? (
                    <p className="px-1 py-1 text-xs text-fg-subtle">
                        {browsing ? t("settings.dictionaries.browsing") : t("settings.dictionaries.available.prompt")}
                    </p>
                ) : offered.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-fg-subtle">{t("settings.dictionaries.available.none")}</p>
                ) : (
                    <div className="flex flex-col">
                        {offered.map(entry => (
                            <div key={entry.code} className="flex min-h-7 items-center gap-3 rounded-md px-1 hover:bg-fill-subtle">
                                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{entry.name}</span>
                                <span className="shrink-0 text-2xs text-fg-subtle">{entry.code}</span>
                                {/* The licence travels with the entry and is shown beside it: the word
                                    list is somebody else's work and downloading it is agreeing to their
                                    terms, which is not a thing to find out afterwards. */}
                                <span className="shrink-0 text-2xs text-fg-subtle">{entry.license}</span>
                                <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(entry.bytes)}</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy !== null}
                                    onClick={() => void download(entry.code)}
                                >
                                    {busy === entry.code
                                        ? t("settings.dictionaries.downloading")
                                        : t("settings.dictionaries.download")}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
                {failed && <p className="px-1 pt-2 text-xs text-danger">{t("settings.dictionaries.failed")}</p>}
            </SectionCard>

        </div>
    );
}
