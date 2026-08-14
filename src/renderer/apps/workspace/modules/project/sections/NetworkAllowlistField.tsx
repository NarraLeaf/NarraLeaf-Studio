/**
 * The project's network allowlist, edited.
 *
 * Shown only when the project allows HTTP and has chosen to narrow it. The narrow state is opt-in
 * and always will be: a blueprint node an author wired up is expected to run, and a default that
 * made authored graphs fail would teach people to switch the safety off before they had a reason to
 * understand it. See `@shared/types/networkAllowlist`.
 *
 * ## Two lists, one panel
 *
 * The author's entries are edited here. The hosts installed plugins declared are shown under them,
 * read-only and attributed, because they are removed by a different act - uninstalling the plugin -
 * and because a panel that omitted them would answer "where does my game connect" wrongly, which is
 * the only question this panel exists to answer.
 *
 * ## What it says about sidecars
 *
 * That they are not on it. A sidecar is a child process, so nothing in this list reaches it; what
 * bounds one is the permission the author approved when the plugin was installed. Stating it is not
 * optional - a panel headed "only these addresses" that quietly did not cover a whole channel would
 * be promising something it does not deliver.
 *
 * Comments in English per project convention.
 */

import { Plus, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { normalizeNetworkAllowlistEntry, type NetworkPluginAllowlistEntry } from "@shared/types/networkAllowlist";
import { Button, IconButton, Input } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

export function NetworkAllowlistField({
    entries,
    pluginEntries,
    disabled,
    onCommit,
}: {
    entries: readonly string[];
    pluginEntries: readonly NetworkPluginAllowlistEntry[];
    disabled: boolean;
    onCommit: (next: string[]) => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.writes(disabled);
    const storedKey = entries.join("\n");
    const [drafts, setDrafts] = useState<string[]>([...entries]);
    const [invalidIndexes, setInvalidIndexes] = useState<readonly number[]>([]);

    useEffect(() => {
        setDrafts(storedKey ? storedKey.split("\n") : []);
        setInvalidIndexes([]);
    }, [storedKey]);

    const commit = useCallback((next: readonly string[]) => {
        onCommit(next.filter(entry => entry.trim()));
    }, [onCommit]);

    /**
     * A blank row is a row the author has not filled in, not a mistake: it is dropped on the way out
     * rather than reported, so Add and then leave costs nothing. A row that is filled in but not an
     * address keeps what was typed and says why, because a mistyped host is usually one character
     * away from a correct one.
     */
    const commitRow = useCallback((index: number) => {
        const value = drafts[index]?.trim() ?? "";
        if (value && normalizeNetworkAllowlistEntry(value) === null) {
            setInvalidIndexes(prev => (prev.includes(index) ? prev : [...prev, index]));
            return;
        }
        setInvalidIndexes(prev => prev.filter(entry => entry !== index));
        commit(drafts);
    }, [commit, drafts]);

    return (
        <div className="grid min-w-0 gap-2 [&>*]:min-w-0" data-tip={frozen["data-tip"]}>
            <div className="grid min-w-0 gap-1.5 [&>*]:min-w-0">
                {drafts.map((draft, index) => (
                    <div key={index} className="flex min-w-0 items-start gap-1">
                        <div className="grid min-w-0 flex-1 gap-1 [&>*]:min-w-0">
                            <Input
                                size="sm"
                                value={draft}
                                placeholder={t("project.settings.networkAllowlist.placeholder")}
                                disabled={frozen.disabled}
                                aria-label={t("project.settings.networkAllowlist.title")}
                                className="w-full min-w-0 font-mono"
                                data-network-allowlist-entry={index}
                                onChange={event => setDrafts(prev => prev.map((entry, i) => (
                                    i === index ? event.target.value : entry
                                )))}
                                onBlur={() => commitRow(index)}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            {invalidIndexes.includes(index) ? (
                                <span className="text-2xs text-danger">
                                    {t("project.settings.networkAllowlist.invalid")}
                                </span>
                            ) : null}
                        </div>
                        <IconButton
                            size="sm"
                            variant="ghost"
                            disabled={frozen.disabled}
                            aria-label={t("project.settings.networkAllowlist.remove")}
                            data-network-allowlist-remove={index}
                            onClick={() => {
                                const next = drafts.filter((_, i) => i !== index);
                                setDrafts(next);
                                setInvalidIndexes([]);
                                commit(next);
                            }}
                        >
                            <X className="h-3.5 w-3.5" />
                        </IconButton>
                    </div>
                ))}
                <span className="flex min-w-0">
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={frozen.disabled}
                        onClick={() => setDrafts(prev => [...prev, ""])}
                        className="px-1.5"
                        data-network-allowlist-add=""
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {t("project.settings.networkAllowlist.add")}
                    </Button>
                </span>
            </div>

            {pluginEntries.length > 0 ? (
                <div className="grid min-w-0 gap-1 [&>*]:min-w-0">
                    <span className="text-2xs text-fg-subtle">
                        {t("project.settings.networkAllowlist.fromPlugins")}
                    </span>
                    {pluginEntries.map(entry => entry.patterns.map((pattern, index) => (
                        <div
                            key={`${entry.pluginId}-${index}`}
                            className="flex min-w-0 items-baseline justify-between gap-2"
                        >
                            <span className="min-w-0 truncate font-mono text-2xs text-fg-muted">{pattern}</span>
                            <span className="shrink-0 text-2xs text-fg-subtle">{entry.pluginId}</span>
                        </div>
                    )))}
                </div>
            ) : null}

            <span className="text-2xs text-fg-subtle">
                {t("project.settings.networkAllowlist.sidecarNote")}
            </span>
        </div>
    );
}
