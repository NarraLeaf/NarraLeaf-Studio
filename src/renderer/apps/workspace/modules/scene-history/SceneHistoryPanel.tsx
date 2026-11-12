/**
 * Scene History panel (right dock): the content snapshots of the focused scene, automatic and
 * manual, with a filter, a comparison against the current scene, and restore.
 *
 * It follows the focused scene through the payload the scene tab already publishes for the Scene
 * Snapshot panel, rather than asking the tab to publish a second copy: both panels answer "which
 * scene is in front of the author", and one answer cannot disagree with itself.
 *
 * Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompareArrows, History, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Button, EmptyState, Select, type SelectOption } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useWorkspace } from "@/apps/workspace/context";
import { usePanels } from "@/apps/workspace/hooks/useUIService";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { SceneHistoryService } from "@/lib/workspace/services/story/sceneHistory/SceneHistoryService";
import {
    diffScenes,
    type SceneDiffSummary,
    type SceneHistoryEntryMeta,
} from "@/lib/workspace/services/story/sceneHistory/sceneHistoryModel";
import { STORY_SNAPSHOT_PANEL_ID, type StorySnapshotPanelPayload } from "../story-snapshots/storySnapshotPanelId";
import { formatHistoryTime, historyRowText, TextDiffView } from "./sceneHistoryView";

type KindFilter = "all" | "auto" | "manual";

/** How many changed rows a comparison lists before it stops; the counts above it stay exact. */
const COMPARE_ROW_LIMIT = 30;

export function SceneHistoryPanel() {
    const { t, locale } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const panels = usePanels();
    const focused = panels.find(panel => panel.id === STORY_SNAPSHOT_PANEL_ID)?.payload as StorySnapshotPanelPayload | undefined;
    const storyId = focused?.storyId;
    const sceneId = focused?.sceneId;

    const services = useMemo(() => {
        if (!context || !isInitialized) return null;
        return {
            history: context.services.get<SceneHistoryService>(Services.SceneHistory),
            story: context.services.get<StoryService>(Services.Story),
            characters: context.services.get<CharacterService>(Services.Character),
            ui: context.services.get<UIService>(Services.UI),
        };
    }, [context, isInitialized]);

    const [entries, setEntries] = useState<SceneHistoryEntryMeta[] | null>(null);
    const [filter, setFilter] = useState<KindFilter>("all");
    const [comparing, setComparing] = useState<{ id: string; snapshot: StoryScene } | null>(null);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setComparing(null);
        if (!services || !storyId || !sceneId) {
            setEntries(null);
            return;
        }
        let alive = true;
        const read = () => void services.history.listEntries(storyId, sceneId).then(list => {
            if (alive) setEntries(list);
        });
        read();
        const off = services.history.onChanged(event => {
            if (event.storyId === storyId && event.sceneId === sceneId) read();
        });
        return () => {
            alive = false;
            off();
        };
    }, [services, storyId, sceneId]);

    // The current scene, for the comparison. Followed live so a comparison stays true while the
    // author keeps typing; only read while one is open.
    useEffect(() => {
        if (!services || !storyId || !comparing) {
            setDocument(null);
            return;
        }
        setDocument(services.story.getLoadedStoryDocument(storyId) ?? null);
        return services.story.onDocumentChanged(event => {
            if (event.storyId === storyId) setDocument({ ...event.document });
        });
    }, [services, storyId, comparing]);

    const filterOptions: SelectOption[] = useMemo(() => [
        { value: "all", label: t("sceneHistory.filterAll") },
        { value: "auto", label: t("sceneHistory.filterAuto") },
        { value: "manual", label: t("sceneHistory.filterManual") },
    ], [t]);

    const shown = useMemo(
        () => (entries ?? []).filter(entry => filter === "all" || entry.kind === filter),
        [entries, filter],
    );

    const saveNow = useCallback(async () => {
        if (!services || !storyId || !sceneId) return;
        setBusy(true);
        try {
            const entry = await services.history.createManualSnapshot(storyId, sceneId);
            if (!entry) services.ui.showNotification(t("sceneHistory.unchanged"), "info");
        } finally {
            setBusy(false);
        }
    }, [services, storyId, sceneId, t]);

    const restore = useCallback(async (entry: SceneHistoryEntryMeta) => {
        if (!services || !storyId || !sceneId) return;
        setBusy(true);
        try {
            const ok = await services.history.restoreSceneSnapshot(storyId, sceneId, entry.id);
            services.ui.showNotification(t(ok ? "sceneHistory.restored" : "sceneHistory.restoreFailed"), ok ? "success" : "error");
        } finally {
            setBusy(false);
        }
    }, [services, storyId, sceneId, t]);

    const toggleCompare = useCallback(async (entry: SceneHistoryEntryMeta) => {
        if (!services || !storyId || !sceneId) return;
        if (comparing?.id === entry.id) {
            setComparing(null);
            return;
        }
        const snapshot = await services.history.readSnapshotScene(storyId, sceneId, entry.id);
        setComparing(snapshot ? { id: entry.id, snapshot } : null);
    }, [services, storyId, sceneId, comparing]);

    if (!storyId || !sceneId) {
        return <EmptyState size="sm" className="h-full" icon={<History className="h-5 w-5" />} description={t("sceneHistory.empty")} />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-scene-history-panel>
            <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2.5">
                <Select
                    options={filterOptions}
                    value={filter}
                    onChange={value => setFilter(String(value) as KindFilter)}
                    size="sm"
                    className="min-w-0 flex-1"
                />
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void saveNow()}
                    disabled={busy}
                    className="shrink-0 gap-1"
                >
                    <Plus className="h-3.5 w-3.5" /> {t("sceneHistory.saveNow")}
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {entries === null ? (
                    <div className="p-3 text-2xs text-fg-subtle">{t("sceneHistory.loading")}</div>
                ) : shown.length === 0 ? (
                    <EmptyState
                        size="sm"
                        icon={<History className="h-5 w-5" />}
                        description={t(entries.length === 0 ? "sceneHistory.noEntries" : "sceneHistory.noMatches")}
                    />
                ) : (
                    <ul className="flex flex-col">
                        {shown.map(entry => {
                            const open = comparing?.id === entry.id;
                            const currentScene = open ? document?.scenes[sceneId] : undefined;
                            return (
                                <li key={entry.id} className="border-b border-edge px-3 py-2" data-scene-history-entry={entry.kind}>
                                    <div className="flex items-center gap-2">
                                        {entry.kind === "auto"
                                            ? <History className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                                            : <Save className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs text-fg">
                                                {formatHistoryTime(entry.createdAt, locale)}
                                                <span className="ml-2 text-fg-muted">
                                                    {entry.label ?? t(entry.kind === "auto" ? "sceneHistory.kindAuto" : "sceneHistory.kindManual")}
                                                </span>
                                            </div>
                                            <div className="text-2xs text-fg-subtle">{t("sceneHistory.rows", { count: entry.blockCount })}</div>
                                        </div>
                                        <ToolbarButton
                                            size="xs"
                                            active={open}
                                            aria-label={t(open ? "sceneHistory.hideCompare" : "sceneHistory.compare")}
                                            data-tip={t(open ? "sceneHistory.hideCompare" : "sceneHistory.compare")}
                                            onClick={() => void toggleCompare(entry)}
                                        >
                                            <GitCompareArrows className="h-3.5 w-3.5" />
                                        </ToolbarButton>
                                        <ToolbarButton
                                            size="xs"
                                            aria-label={t("sceneHistory.restore")}
                                            onClick={() => void restore(entry)}
                                            {...freeze.writes(busy, t("sceneHistory.restore"))}
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </ToolbarButton>
                                        <ToolbarButton
                                            size="xs"
                                            aria-label={t("sceneHistory.delete")}
                                            data-tip={t("sceneHistory.delete")}
                                            disabled={busy}
                                            onClick={() => void services?.history.deleteEntry(storyId, sceneId, entry.id)}
                                            className="hover:text-danger"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </ToolbarButton>
                                    </div>
                                    {open && comparing && currentScene ? (
                                        <SceneComparison
                                            snapshot={comparing.snapshot}
                                            current={currentScene}
                                            document={document}
                                            characters={services?.characters.listCharacter() ?? []}
                                        />
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

function SceneComparison({ snapshot, current, document, characters }: {
    snapshot: StoryScene;
    current: StoryScene;
    document: StoryDocument | null;
    characters: ReturnType<CharacterService["listCharacter"]>;
}) {
    const { t } = useTranslation();
    const summary: SceneDiffSummary = useMemo(() => diffScenes(snapshot, current), [snapshot, current, document]);
    const scenes = document?.scenes;
    const text = (scene: StoryScene, id: string) => historyRowText(scene.blocks[id], characters, scene, scenes);
    const total = summary.changed.length + summary.added.length + summary.removed.length;
    if (total === 0) {
        return <div className="mt-2 text-2xs text-fg-subtle">{t("sceneHistory.identical")}</div>;
    }
    const counts: [TranslationKey, number][] = [
        ["sceneHistory.changed" as TranslationKey, summary.changed.length],
        ["sceneHistory.added" as TranslationKey, summary.added.length],
        ["sceneHistory.removed" as TranslationKey, summary.removed.length],
    ];
    const rows = [
        ...summary.changed.map(id => ({ id, before: text(snapshot, id), after: text(current, id) })),
        ...summary.removed.map(id => ({ id, before: text(snapshot, id), after: "" })),
        ...summary.added.map(id => ({ id, before: "", after: text(current, id) })),
    ].slice(0, COMPARE_ROW_LIMIT);
    return (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-edge bg-surface-raised p-2" data-scene-history-compare>
            <div className="flex flex-wrap gap-x-3 text-2xs text-fg-muted">
                {counts.filter(([, count]) => count > 0).map(([key, count]) => (
                    <span key={key}>{t(key, { count })}</span>
                ))}
            </div>
            {rows.map(row => (
                <TextDiffView key={row.id} before={row.before} after={row.after} className="text-xs text-fg" />
            ))}
        </div>
    );
}
