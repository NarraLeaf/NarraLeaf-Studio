import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements/Button";
import { Input } from "@/lib/components/elements/Input";
import { Modal } from "@/lib/components/elements/Modal";
import { DocumentChangeList } from "@/lib/vcs/DocumentChangeList";
import { listProjectHistory } from "@/lib/team/teamCall";
import { useTeamTopics } from "@/lib/team/useTeam";
import { Services } from "@/lib/workspace/services/services";
import type { TeamDocumentsService, TeamVersionComparison } from "@/lib/workspace/services/teamDocs/TeamDocumentsService";
import type { TeamDocView } from "@/lib/workspace/services/teamDocs/teamDocSync";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { teamProjectDocTopic } from "@shared/types/team";
import type { VcsServerRevision } from "@shared/types/vcs";
import { useWorkspace } from "../../context";
import { VERSION_RAIL_COLLAPSED_WIDTH, VERSION_RAIL_EXPANDED_WIDTH } from "../../components/layout/versionRailModel";

/** What a screen needs to know about a team project followed through its server. */
export type TeamDocumentsSurface = {
    /** Null for a project that is not followed this way: the old version rail applies. */
    view: TeamDocView | null;
    target: { remoteOrigin: string; project: string } | null;
    service: TeamDocumentsService | null;
    /** The saved version on screen, or null for the present. */
    previewing: string | null;
    /** Set while the project is a personal copy of a team project: where it came from. */
    detached: { remote: string; project: string } | null;
};

export function useTeamDocuments(): TeamDocumentsSurface {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<TeamDocumentsService>(Services.TeamDocuments) : null),
        [context, isInitialized],
    );
    const [state, setState] = useState<Omit<TeamDocumentsSurface, "service">>({ view: null, target: null, previewing: null, detached: null });
    useEffect(() => {
        if (!service) {
            setState({ view: null, target: null, previewing: null, detached: null });
            return;
        }
        const read = () => setState({
            view: service.getView(),
            target: service.getTarget(),
            previewing: service.getPreviewing(),
            detached: service.getDetached(),
        });
        // Read on the way in as well as on every change: following may have begun before mounting.
        read();
        return service.onChanged(read);
    }, [service]);
    return { ...state, service };
}

/** The machine-written trailer every snapshot carries; a hand-saved version has its name above it. */
const SNAPSHOT_TRAILER = /(?:^|\n\n)Team snapshot at seq \d+\s*$/;

function versionName(revision: VcsServerRevision): string | null {
    const message = (revision.message ?? "").replace(SNAPSHOT_TRAILER, "").trim();
    return message === "" ? null : message.split("\n")[0];
}

const PAGE = 50;
const COLLAPSED_KEY = "nl.team.history.collapsed";

/** Whether the author folded the team history last time. A per-window convenience. */
export function readTeamHistoryCollapsed(): boolean {
    try {
        return globalThis.localStorage?.getItem(COLLAPSED_KEY) === "1";
    } catch {
        return false;
    }
}

function keepCollapsed(collapsed: boolean): void {
    try {
        globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
        // A preference that cannot be kept is still honoured for this window.
    }
}

/**
 * How wide the team history is: the version rail's own two widths, so the dock layout accounts for
 * it the way it accounts for that rail (`DockEnv.versionRailWidth`).
 */
export function teamHistoryWidth(collapsed: boolean): number {
    return collapsed ? VERSION_RAIL_COLLAPSED_WIDTH : VERSION_RAIL_EXPANDED_WIDTH;
}

/**
 * The history of a team project: the versions its Team server saved, newest first.
 *
 * Takes the version rail's place for a project whose documents the server holds. There is nothing
 * to commit, push or pull - everyone's edits are already on the server - so this is the list of saved
 * versions, a way to save one by hand with a name, to look at one, to see what changed since, and to
 * put one back. Where the project stands (live, catching up, offline) and any offline edits the
 * server would not take are shown at the top. It folds to a narrow strip so it can stay out of the way.
 */
export function TeamHistoryRail({
    surface,
    collapsed,
    onCollapsedChange,
}: {
    surface: TeamDocumentsSurface;
    /** Owned by the layout, whose dock account includes this rail's width. */
    collapsed: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { view, target, service, previewing } = surface;
    const [label, setLabel] = useState("");
    const [busy, setBusy] = useState(false);
    const [older, setOlder] = useState<VcsServerRevision[]>([]);
    const [more, setMore] = useState(false);
    const [comparison, setComparison] = useState<{ revision: VcsServerRevision; rows: TeamVersionComparison[] } | null>(null);

    const read = useCallback(
        () => listProjectHistory(target?.remoteOrigin ?? "", target?.project ?? "", { limit: PAGE }),
        [target],
    );
    const history = useTeamTopics(
        target?.remoteOrigin ?? null,
        target === null ? [] : [teamProjectDocTopic(target.project)],
        read,
    );
    useEffect(() => {
        // A new first page (a version was saved) starts the older pages again.
        setOlder([]);
        setMore(history.value?.more ?? false);
    }, [history.value]);

    if (view === null || target === null || service === null) {
        return null;
    }

    const toggle = () => {
        const next = !collapsed;
        keepCollapsed(next);
        onCollapsedChange(next);
    };

    const run = async (act: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await act();
        } finally {
            setBusy(false);
        }
    };

    const revisions = [...(history.value?.revisions ?? []), ...older];
    const loadMore = () => run(async () => {
        const last = revisions.at(-1);
        if (last === undefined) return;
        const page = await listProjectHistory(target.remoteOrigin, target.project, { limit: PAGE, before: last.id });
        if (page.ok) {
            setOlder(current => [...current, ...(page.value.revisions ?? [])]);
            setMore(page.value.more);
        }
    });

    const save = () => run(async () => {
        const trimmed = label.trim();
        await service.saveVersion(trimmed === "" ? undefined : trimmed);
        setLabel("");
        history.refresh();
    });

    const restore = (revision: VcsServerRevision) => run(async () => {
        const ui = context?.services.get<UIService>(Services.UI);
        const confirmed = ui === undefined
            ? false
            : await ui.showConfirm(t("workspace.shell.team.docs.restoreConfirm"), versionName(revision) ?? revision.id.slice(0, 12));
        if (!confirmed) return;
        await service.restoreVersion(revision.id);
        history.refresh();
    });

    const preview = (revision: VcsServerRevision) => run(() => service.previewVersion(revision.id, versionName(revision) ?? undefined));
    const compare = (revision: VcsServerRevision) => run(async () => {
        const rows = await service.compareWithCurrent(revision.id);
        if (rows !== null) setComparison({ revision, rows });
    });

    const detach = () => run(async () => {
        const ui = context?.services.get<UIService>(Services.UI);
        const confirmed = ui === undefined
            ? false
            : await ui.showDestructiveConfirm(
                t("workspace.shell.team.docs.detachConfirm"),
                t("workspace.shell.team.docs.detachDetail"),
                t("workspace.shell.team.docs.detach"),
            );
        if (confirmed) await service.detach();
    });

    const stateLine = view.state === "online"
        ? t("workspace.shell.team.docs.online")
        : view.state === "offline"
            ? t("workspace.shell.team.docs.offline")
            : t("workspace.shell.team.docs.syncing");
    const online = view.state === "online";

    if (collapsed) {
        return (
            <aside
                data-workspace-team-history="collapsed"
                className="shrink-0 flex flex-col items-center border-r border-edge bg-surface py-2 gap-2"
                style={{ width: teamHistoryWidth(true) }}
            >
                <button type="button" className="text-xs text-fg-muted hover:text-fg" aria-label={t("workspace.shell.team.docs.history")} onClick={toggle}>
                    {"›"}
                </button>
                <span
                    className={online ? "w-2 h-2 rounded-full bg-success" : "w-2 h-2 rounded-full bg-fg-muted"}
                    aria-label={stateLine}
                    data-team-docs-state={view.state}
                />
            </aside>
        );
    }

    return (
        <aside
            data-workspace-team-history
            className="shrink-0 flex flex-col border-r border-edge bg-surface overflow-hidden"
            style={{ width: teamHistoryWidth(false) }}
        >
            <header className="px-3 py-2 border-b border-edge flex items-start gap-2">
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-fg">{t("workspace.shell.team.docs.history")}</div>
                    <div className={online ? "text-xs text-success" : "text-xs text-fg-muted"} data-team-docs-state={view.state}>
                        {stateLine}
                    </div>
                    {!view.mayEdit && <div className="text-xs text-fg-muted">{t("workspace.shell.team.docs.readOnly")}</div>}
                </div>
                <button type="button" className="text-xs text-fg-muted hover:text-fg" aria-label={t("workspace.shell.team.docs.close")} onClick={toggle}>
                    {"‹"}
                </button>
            </header>

            {previewing !== null && (
                <section className="px-3 py-2 border-b border-edge bg-accent/10" data-team-docs-previewing>
                    <div className="text-xs text-fg mb-1">{t("workspace.shell.team.docs.previewing")}</div>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => service.endPreview())}>
                        {t("workspace.shell.team.docs.backToPresent")}
                    </Button>
                </section>
            )}

            {view.conflicts.length > 0 && (
                <section className="px-3 py-2 border-b border-edge bg-warning/10" data-team-docs-conflicts>
                    <div className="text-xs font-medium text-fg">{t("workspace.shell.team.docs.conflictsTitle")}</div>
                    <div className="text-xs text-fg-muted mb-1">{t("workspace.shell.team.docs.conflictsHint")}</div>
                    <ul className="max-h-48 overflow-auto text-xs space-y-1">
                        {view.conflicts.map((conflict, index) => (
                            <li key={index} className="flex items-start gap-2">
                                <span className="flex-1 font-mono break-all">
                                    {conflict.kind === "file"
                                        ? t("workspace.shell.team.docs.conflictFile", { path: conflict.path })
                                        : describeConflict(conflict.op)}
                                </span>
                                <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void run(() => service.overrideConflict(index))}>
                                    {t("workspace.shell.team.docs.override")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                    <Button size="sm" variant="ghost" onClick={() => service.dismissConflicts()}>
                        {t("workspace.shell.team.docs.dismiss")}
                    </Button>
                </section>
            )}

            {view.mayEdit && previewing === null && (
                <section className="px-3 py-2 border-b border-edge flex flex-col gap-2">
                    <div className="text-xs text-fg-muted">{t("workspace.shell.team.docs.historyHint")}</div>
                    <Input
                        size="sm"
                        fullWidth
                        value={label}
                        placeholder={t("workspace.shell.team.docs.versionLabel")}
                        onChange={event => setLabel(event.target.value)}
                        disabled={busy || !online}
                    />
                    <Button size="sm" variant="primary" disabled={busy || !online} onClick={() => void save()}>
                        {t("workspace.shell.team.docs.saveVersion")}
                    </Button>
                </section>
            )}

            {previewing === null && view.state !== "syncing" && (
                <section className="px-3 py-2 border-b border-edge">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void detach()}>
                        {t("workspace.shell.team.docs.detach")}
                    </Button>
                </section>
            )}

            <ol className="flex-1 overflow-auto">
                {revisions.length === 0 && (
                    <li className="px-3 py-4 text-xs text-fg-muted">{t("workspace.shell.team.docs.noVersions")}</li>
                )}
                {revisions.map(revision => {
                    const name = versionName(revision);
                    const onScreen = previewing === revision.id;
                    return (
                        <li key={revision.id} className={onScreen ? "px-3 py-2 border-b border-edge bg-accent/10" : "px-3 py-2 border-b border-edge"} data-team-version={revision.id}>
                            <div className="text-sm text-fg truncate">{name ?? t("workspace.shell.team.docs.automatic")}</div>
                            <div className="text-xs text-fg-muted flex flex-wrap items-center gap-x-2">
                                <span>{revision.at === undefined ? "" : new Date(revision.at).toLocaleString()}</span>
                                {revision.by !== undefined && <span>{t("workspace.shell.team.docs.savedBy", { name: revision.by })}</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                                <Button size="sm" variant="ghost" disabled={busy || !online || onScreen} onClick={() => void preview(revision)}>
                                    {t("workspace.shell.team.docs.preview")}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void compare(revision)}>
                                    {t("workspace.shell.team.docs.compare")}
                                </Button>
                                {view.mayEdit && (
                                    <Button size="sm" variant="ghost" disabled={busy || !online || previewing !== null} onClick={() => void restore(revision)}>
                                        {t("workspace.shell.team.docs.restore")}
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
                {more && (
                    <li className="px-3 py-2">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void loadMore()}>
                            {t("workspace.shell.team.docs.loadMore")}
                        </Button>
                    </li>
                )}
            </ol>

            <Modal
                isOpen={comparison !== null}
                onClose={() => setComparison(null)}
                title={t("workspace.shell.team.docs.comparing")}
                size="lg"
            >
                {comparison !== null && comparison.rows.length === 0 && (
                    <div className="text-sm text-fg-muted">{t("workspace.shell.team.docs.noDifferences")}</div>
                )}
                {comparison?.rows.map(row => (
                    <section key={row.path} className="mb-4" data-team-compare={row.path}>
                        <div className="text-xs font-mono text-fg-muted mb-1">{row.path}</div>
                        {row.kind === "added" && <div className="text-sm">{t("workspace.shell.team.docs.documentAdded")}</div>}
                        {row.kind === "removed" && <div className="text-sm">{t("workspace.shell.team.docs.documentRemoved")}</div>}
                        {row.kind === "changed" && row.diff !== undefined && <DocumentChangeList diff={row.diff} limit={60} />}
                    </section>
                ))}
            </Modal>
        </aside>
    );
}

/** A short line naming what an offline edit was and what it said. */
function describeConflict(op: { op: string } & Record<string, unknown>): string {
    const payload = op["payload"] as { text?: { value?: unknown } } | undefined;
    const text = typeof payload?.text?.value === "string" ? `: ${payload.text.value}` : "";
    const row = typeof op["blockId"] === "string" ? ` ${op["blockId"].slice(0, 8)}` : "";
    return `${op.op}${row}${text}`;
}

/**
 * A personal copy of a team project, with the way back: reconnecting sends everything changed since
 * the copy was made, as coming back online does, and the project follows its server again.
 */
export function TeamReconnectBar({ surface }: { surface: TeamDocumentsSurface }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const { service, detached, view } = surface;
    if (service === null || detached === null || view !== null) {
        return null;
    }
    const reconnect = async () => {
        setBusy(true);
        try {
            await service.reconnect();
        } finally {
            setBusy(false);
        }
    };
    return (
        <div data-team-reconnect className="flex items-center gap-3 px-3 py-1.5 border-b border-edge bg-surface text-xs">
            <span className="flex-1 text-fg-muted">{t("workspace.shell.team.docs.detachedHint")}</span>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void reconnect()}>
                {t("workspace.shell.team.docs.reconnect")}
            </Button>
        </div>
    );
}
