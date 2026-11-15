import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements/Button";
import { Input } from "@/lib/components/elements/Input";
import { Modal } from "@/lib/components/elements/Modal";
import { DocumentChangeList } from "@/lib/vcs/DocumentChangeList";
import { documentNameOf, documentNameSourcesFor, numberRepeatedNames, renderDocumentName, type DocumentName, type DocumentNameContext } from "@/lib/vcs/documentName";
import { containsGeneratedIdentifier, elideGeneratedIdentifiers, readableStoragePath, revisionAuthorLabel } from "@/lib/vcs/identifierDisplay";
import { useDocumentNames } from "@/lib/vcs/nameSources";
import { listProjectHistory } from "@/lib/team/teamCall";
import { useTeamConnection, useTeamTopics } from "@/lib/team/useTeam";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { TeamDocumentsService, TeamVersionComparison } from "@/lib/workspace/services/teamDocs/TeamDocumentsService";
import type { TeamDocConflict, TeamDocView } from "@/lib/workspace/services/teamDocs/teamDocSync";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { Translator } from "@shared/i18n";
import { liveDocumentPath } from "@shared/live/sharedDocuments";
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
    const [saveFailed, setSaveFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [older, setOlder] = useState<VcsServerRevision[]>([]);
    const [more, setMore] = useState(false);
    const [comparison, setComparison] = useState<{ revision: VcsServerRevision; rows: TeamVersionComparison[] } | null>(null);
    const historyGeneration = useRef(0);

    const read = useCallback(
        () => listProjectHistory(target?.remoteOrigin ?? "", target?.project ?? "", { limit: PAGE }),
        [target],
    );
    const history = useTeamTopics(
        target?.remoteOrigin ?? null,
        target === null ? [] : [teamProjectDocTopic(target.project)],
        read,
    );
    const connection = useTeamConnection(target?.remoteOrigin ?? null);
    const conflictPaths = useMemo(
        () => (view?.conflicts ?? []).map(conflictPath),
        [view?.conflicts],
    );
    const comparisonPaths = useMemo(() => comparison?.rows.map(row => row.path) ?? [], [comparison]);
    const nameSources = useMemo(() => documentNameSourcesFor([...conflictPaths, ...comparisonPaths]), [conflictPaths, comparisonPaths]);
    const names = useDocumentNames(target && view && nameSources.size > 0 ? { before: null, after: { at: "working-tree" } } : null, {
        sources: nameSources,
        refreshKey: view?.seq,
    });
    const conflictNames = useMemo(() => {
        const storyTitles = new Map(names.storyTitles);
        for (const conflict of view?.conflicts ?? []) {
            if (conflict.kind !== "story" || storyTitles.has(conflict.storyId)) continue;
            const name = conflict.mine?.name ?? (conflict.op.op === "create-story" ? conflict.op.entry.name : undefined);
            if (name?.trim()) storyTitles.set(conflict.storyId, name);
        }
        return visibleDocumentNames(conflictPaths, { ...names, storyTitles }, t);
    }, [conflictPaths, names, t, view?.conflicts]);
    const comparisonNames = useMemo(() => visibleDocumentNames(comparisonPaths, names, t), [comparisonPaths, names, t]);
    useEffect(() => {
        // A new first page (a version was saved) starts the older pages again.
        historyGeneration.current += 1;
        setOlder([]);
        setMore(history.value?.more ?? false);
    }, [history.value, target?.remoteOrigin, target?.project]);

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
        const generation = historyGeneration.current;
        const page = await listProjectHistory(target.remoteOrigin, target.project, { limit: PAGE, before: last.id });
        if (generation === historyGeneration.current && page.ok) {
            setOlder(current => [...current, ...(page.value.revisions ?? [])]);
            setMore(page.value.more);
        }
    });

    const save = () => run(async () => {
        const trimmed = label.trim();
        setSaveFailed(false);
        const saved = await service.saveVersion(trimmed === "" ? undefined : trimmed).catch(() => null);
        if (saved === null || !saved.ok) {
            setSaveFailed(true);
            return;
        }
        setLabel("");
        history.refresh();
    });

    const restore = (revision: VcsServerRevision, label: string) => run(async () => {
        const ui = context?.services.get<UIService>(Services.UI);
        const confirmed = ui === undefined
            ? false
            : await ui.showConfirm(t("workspace.shell.team.docs.restoreConfirm"), label);
        if (!confirmed) return;
        await service.restoreVersion(revision.id);
        history.refresh();
    });

    const preview = (revision: VcsServerRevision, label: string) => run(() => service.previewVersion(revision.id, label));
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
    const account = connection.remoteOrigin === target.remoteOrigin && connection.account
        ? { userId: connection.account.id, identity: connection.account.displayName.trim() || connection.account.username }
        : null;
    const summaries = view.conflicts.map((conflict, index) => conflictSummary(conflict, conflictNames.get(conflictPaths[index]!)!, context, t));
    const summaryCounts = new Map<string, number>();
    for (const summary of summaries) summaryCounts.set(summary, (summaryCounts.get(summary) ?? 0) + 1);
    const summaryOrdinals = new Map<string, number>();

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
                <section className="px-3 py-2 border-b border-edge bg-primary/10" data-team-docs-previewing>
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
                        {view.conflicts.map((_, index) => {
                            const summary = summaries[index]!;
                            const ordinal = (summaryOrdinals.get(summary) ?? 0) + 1;
                            summaryOrdinals.set(summary, ordinal);
                            const label = (summaryCounts.get(summary) ?? 0) > 1
                                ? t("documentDiff.name.numbered", { name: summary, index: String(ordinal) })
                                : summary;
                            return (
                                <li key={index} className="flex items-start gap-2">
                                    <span id={`team-conflict-${index}`} className="flex-1 whitespace-pre-wrap break-words">{label}</span>
                                    <Button size="sm" variant="ghost" aria-describedby={`team-conflict-${index}`} disabled={busy || !online} onClick={() => void run(() => service.overrideConflict(index))}>
                                        {t("workspace.shell.team.docs.override")}
                                    </Button>
                                </li>
                            );
                        })}
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
                        onChange={event => { setLabel(event.target.value); setSaveFailed(false); }}
                        disabled={busy || !online}
                    />
                    <Button size="sm" variant="primary" disabled={busy || !online} onClick={() => void save()}>
                        {t("workspace.shell.team.docs.saveVersion")}
                    </Button>
                    {saveFailed && <p role="alert" className="text-xs text-danger">{t("workspace.shell.statusBar.saveFailed")}</p>}
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
                {history.value?.revisions !== undefined && revisions.length === 0 && (
                    <li className="px-3 py-4 text-xs text-fg-muted">{t("workspace.shell.team.docs.noVersions")}</li>
                )}
                {revisions.map((revision, index) => {
                    const name = versionName(revision);
                    const label = name === null
                        ? t("documentDiff.name.numbered", { name: t("workspace.shell.team.docs.automatic"), index: String(index + 1) })
                        : elideGeneratedIdentifiers(name);
                    const rawAuthor = revisionAuthorLabel(revision.by, account);
                    const author = rawAuthor !== null && !containsGeneratedIdentifier(rawAuthor) ? rawAuthor : null;
                    const onScreen = previewing === revision.id;
                    return (
                        <li key={revision.id} className={onScreen ? "px-3 py-2 border-b border-edge bg-primary/10" : "px-3 py-2 border-b border-edge"} data-team-version={revision.id}>
                            <div className="text-sm text-fg truncate">{label}</div>
                            <div className="text-xs text-fg-muted flex flex-wrap items-center gap-x-2">
                                <span>{revision.at === undefined ? "" : new Date(revision.at).toLocaleString()}</span>
                                {author !== null && <span>{t("workspace.shell.team.docs.savedBy", { name: author })}</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                                <Button size="sm" variant="ghost" disabled={busy || !online || onScreen} onClick={() => void preview(revision, label)}>
                                    {t("workspace.shell.team.docs.preview")}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void compare(revision)}>
                                    {t("workspace.shell.team.docs.compare")}
                                </Button>
                                {view.mayEdit && (
                                    <Button size="sm" variant="ghost" disabled={busy || !online || previewing !== null} onClick={() => void restore(revision, label)}>
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
                        <div className="text-xs text-fg-muted mb-1">{comparisonNames.get(row.path)}</div>
                        {row.kind === "added" && <div className="text-sm">{t("workspace.shell.team.docs.documentAdded")}</div>}
                        {row.kind === "removed" && <div className="text-sm">{t("workspace.shell.team.docs.documentRemoved")}</div>}
                        {row.kind === "changed" && row.diff !== undefined && <DocumentChangeList diff={row.diff} limit={60} />}
                    </section>
                ))}
            </Modal>
        </aside>
    );
}

function conflictPath(conflict: TeamDocConflict): string {
    return conflict.kind === "file" ? conflict.path : liveDocumentPath({ doc: "story", storyId: conflict.storyId });
}

function visibleDocumentNames(paths: readonly string[], names: DocumentNameContext, t: Translator["t"]): Map<string, string> {
    const unique = [...new Set(paths)];
    const resolved = unique.map(path => {
        const name = documentNameOf(path, names);
        return name.source === "file" && readableStoragePath(name.path) === null
            ? { source: "unnamed", key: "workspace.shell.team.docs.conflictItem" } as DocumentName
            : name;
    });
    const numbered = numberRepeatedNames(resolved);
    return new Map(unique.map((path, index) => [path, elideGeneratedIdentifiers(renderDocumentName(numbered[index]!, t))]));
}

/** The text a story row carries, when the operation has a text segment. */
function payloadText(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) return null;
    const fields = payload as Record<string, unknown>;
    const segment = fields["text"] ?? fields["prompt"];
    if (typeof segment !== "object" || segment === null) return null;
    const value = (segment as { value?: unknown }).value;
    return typeof value === "string" && value.trim() ? value : null;
}

function conflictSummary(conflict: TeamDocConflict, document: string, context: WorkspaceContext | null, t: Translator["t"]): string {
    if (conflict.kind === "file") {
        return `${document} · ${t(conflict.mine === null ? "workspace.shell.team.docs.conflictRemoved" : "workspace.shell.team.docs.conflictChanged")}`;
    }
    const op = conflict.op;
    let sceneId: string | null = "sceneId" in op ? op.sceneId : null;
    if (op.op === "create-scene") sceneId = op.scene.id;
    if (op.op === "update-blocks" && op.edits.length > 0 && op.edits.every(edit => edit.sceneId === op.edits[0]!.sceneId)) {
        sceneId = op.edits[0]!.sceneId;
    }
    let sceneName: string | undefined;
    if (sceneId !== null) {
        try {
            sceneName = context?.services.get<StoryService>(Services.Story).getLoadedStoryDocument(conflict.storyId)?.scenes[sceneId]?.name;
        } catch {
            // The saved offline story can still name a scene that is no longer open.
        }
        sceneName = sceneName?.trim() ? sceneName : conflict.mine?.scenes[sceneId]?.name;
        if (!sceneName?.trim() && op.op === "create-scene") sceneName = op.scene.name;
        if (!sceneName?.trim()) sceneName = t("storyComments.unknownScene");
    }

    const oldRowText = (scene: string, block: string) => payloadText(conflict.mine?.scenes[scene]?.blocks[block]?.payload);
    let action: string;
    let details: (string | null)[] = [];
    switch (op.op) {
        case "insert-block":
            action = t("documentDiff.story.blockAdded");
            details = [payloadText(op.block.payload)];
            break;
        case "update-block":
            action = t("documentDiff.story.blockChanged");
            details = [payloadText(op.payload)];
            break;
        case "delete-block":
            action = t("documentDiff.story.blockRemoved");
            details = [oldRowText(op.sceneId, op.blockId)];
            break;
        case "move-block":
            action = t("documentDiff.story.blockMoved");
            details = [oldRowText(op.sceneId, op.blockId)];
            break;
        case "set-block-disabled":
            action = t(op.disabled ? "documentDiff.story.blockDisabled" : "documentDiff.story.blockEnabled");
            details = [oldRowText(op.sceneId, op.blockId)];
            break;
        case "insert-blocks":
            action = `${t("workspace.shell.team.docs.conflictRowsAdded")} (${op.inserts.length})`;
            details = op.inserts.map(entry => payloadText(entry.block.payload));
            break;
        case "update-blocks":
            action = `${t("workspace.shell.team.docs.conflictRowsChanged")} (${op.edits.length})`;
            details = op.edits.map(entry => payloadText(entry.payload));
            break;
        case "delete-blocks":
            action = `${t("workspace.shell.team.docs.conflictRowsRemoved")} (${op.blockIds.length})`;
            details = op.blockIds.map(id => oldRowText(op.sceneId, id));
            break;
        case "move-blocks": {
            const ids = op.moves.flatMap(move => move.blockIds);
            action = `${t("workspace.shell.team.docs.conflictRowsMoved")} (${ids.length})`;
            details = ids.map(id => oldRowText(op.sceneId, id));
            break;
        }
        case "rename-scene": action = t("workspace.shell.team.docs.conflictSceneRenamed"); details = [op.name]; break;
        case "set-entry-scene": action = t("workspace.shell.team.docs.conflictStartingScene"); break;
        case "rename-story": action = t("documentDiff.story.renamed"); details = [op.name]; break;
        case "reorder-chapters": action = t("documentDiff.story.chapterOrder"); break;
        case "create-scene": action = t("workspace.shell.team.docs.conflictSceneAdded"); break;
        case "delete-scene": action = t("workspace.shell.team.docs.conflictSceneRemoved"); break;
        case "update-scene": action = t("documentDiff.story.sceneChanged"); break;
        case "move-scene": action = t("workspace.shell.team.docs.conflictSceneMoved"); break;
        case "set-scene-snapshots": action = t("workspace.shell.team.docs.conflictSnapshots"); break;
        case "set-scene-layers": action = t("workspace.shell.team.docs.conflictLayers"); break;
        case "create-chapter": action = t("documentDiff.story.chapterAdded"); details = [op.chapter.name]; break;
        case "rename-chapter": action = t("documentDiff.story.chapterRenamed"); details = [op.name]; break;
        case "delete-chapter":
            action = t("documentDiff.story.chapterRemoved");
            details = [conflict.mine?.chapters?.find(chapter => chapter.id === op.chapterId)?.name ?? null];
            break;
        case "create-story": action = t("documentDiff.storyIndex.added"); break;
        case "delete-story": action = t("documentDiff.storyIndex.removed"); break;
        default: action = t("documentDiff.storyIndex.changed");
    }
    const location = [document, sceneName, action].filter(Boolean).join(" · ");
    const text = details.filter((value): value is string => Boolean(value?.trim())).join("\n");
    return elideGeneratedIdentifiers(text ? `${location}: ${text}` : location);
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
