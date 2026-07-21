import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BookText, CircleDot, Keyboard, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { getInterface } from "@/lib/app/bridge";
import { countSceneTextStats } from "@/lib/workspace/stats/storyTextStats";
import { getSceneName } from "../story/scene-editor/storySceneBlockUtils";
import type { StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "../actions/runtimeActionStatus";
import { openKeybindingCheatSheet } from "../../components/layout/KeybindingCheatSheet";
import { openDashboardTab } from "../dashboard";
import { NOTIFICATIONS_PANEL_ID } from "../notifications";
import { StatusEntry } from "./StatusEntry";
import type { TranslationKey } from "@shared/i18n";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";

const ZOOM_SETTINGS_KEY = "ui.zoomPercent";
const THEME_SETTINGS_KEY = "ui.themeMode";

type ThemeMode = "auto" | "light" | "dark";
const THEME_CYCLE: ThemeMode[] = ["auto", "light", "dark"];
const THEME_META: Record<ThemeMode, { icon: React.ReactNode; labelKey: TranslationKey }> = {
    auto: { icon: <Monitor className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.auto" as TranslationKey },
    light: { icon: <Sun className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.light" as TranslationKey },
    dark: { icon: <Moon className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.dark" as TranslationKey },
};

/**
 * Built-in entries are *conditional*: several return null while they have nothing to report, so an
 * idle workspace shows a nearly empty strip. Being enabled in the toggle menu only means an entry
 * is allowed to speak — not that it always occupies a cell.
 */

export function DevModeEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [status, setStatus] = useState<DevModeStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const devMode = context.services.get<DevModeService>(Services.DevMode);
        setStatus(devMode.getStatus());
        return devMode.onStatusChanged(setStatus);
    }, [context]);

    if (!isDevModeRuntimeActive(status)) {
        return null;
    }
    return (
        <StatusEntry emphasis title={t("workspace.shell.statusBar.devModeRunning")}>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span>{t("workspace.shell.statusBar.devMode")}</span>
        </StatusEntry>
    );
}

export function PreviewEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [status, setStatus] = useState<PreviewStatus>("idle");

    useEffect(() => {
        if (!context) {
            return;
        }
        const preview = context.services.get<PreviewService>(Services.Preview);
        setStatus(preview.getStatus());
        return preview.onStatusChanged(setStatus);
    }, [context]);

    if (!isPreviewRuntimeActive(status)) {
        return null;
    }
    return (
        <StatusEntry emphasis title={t("workspace.shell.statusBar.previewRunning")}>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span>{t("workspace.shell.statusBar.preview")}</span>
        </StatusEntry>
    );
}

export function BuildEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [building, setBuilding] = useState(false);

    useEffect(() => {
        if (!context) {
            return;
        }
        const build = context.services.get<BuildService>(Services.Build);
        setBuilding(build.isBuilding());
        return build.onStateChanged(state =>
            setBuilding(state.status === "preparing" || state.status === "compiling" || state.status === "packaging"),
        );
    }, [context]);

    if (!building) {
        return null;
    }
    return (
        <StatusEntry emphasis title={t("workspace.shell.statusBar.building")}>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{t("workspace.shell.statusBar.building")}</span>
        </StatusEntry>
    );
}

export function UnsavedChangesEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!context) {
            return;
        }
        const story = context.services.get<StoryService>(Services.Story);
        setDirty(story.isDirty());
        return story.onDirtyChanged(setDirty);
    }, [context]);

    if (!dirty) {
        return null;
    }
    return (
        <StatusEntry
            title={t("workspace.shell.statusBar.saveNow")}
            onClick={() => {
                void context?.services.get<StoryService>(Services.Story).flushPendingChanges();
            }}
        >
            <CircleDot className="h-3 w-3" />
            <span>{t("workspace.shell.statusBar.unsavedChanges")}</span>
        </StatusEntry>
    );
}

type SceneRef = { storyId: StoryId; sceneId: StorySceneId };
type SceneStats = { name: string; words: number; lines: number };

const sameScene = (a: SceneRef | null, b: SceneRef | null): boolean =>
    a?.storyId === b?.storyId && a?.sceneId === b?.sceneId;

/**
 * Reports the scene the user is currently editing: its outline name (e.g. "Scene 1"), word/字 count
 * and line count. The "current" scene is the most-recently-focused open scene-editor tab, so it
 * follows focus between scenes but survives stepping onto a non-scene tab (the scene-flow map, the
 * dashboard, an asset preview); only when no scene editor is open at all does it read "no story
 * open". Counts cover that one scene and match the "N 行" the story panel shows for it. Recomputed
 * on edits with a debounce — ambient information, not a live counter.
 */
export function WordCountEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [stats, setStats] = useState<SceneStats | null>(null);

    const activeScene = useRef<SceneRef | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!context) {
            return;
        }
        let mounted = true;
        const uiService = context.services.get<UIService>(Services.UI);
        const storyService = context.services.get<StoryService>(Services.Story);

        // The most-recently-focused scene-editor tab still open. A scene editor carries both storyId
        // and sceneId; the scene-flow map and other tabs do not, so they are skipped and the last
        // edited scene stays on the readout instead of blanking it.
        const resolveScene = (): SceneRef | null => {
            for (const tab of uiService.getStore().getEditorTabsByRecency()) {
                const payload = tab.payload as { storyId?: StoryId; sceneId?: StorySceneId } | undefined;
                if (payload?.storyId && payload.sceneId && storyService.getStoryEntry(payload.storyId)) {
                    return { storyId: payload.storyId, sceneId: payload.sceneId };
                }
            }
            return null;
        };

        const computeFor = (target: SceneRef | null) => {
            if (!mounted) {
                return;
            }
            if (!target) {
                setStats(null);
                return;
            }
            let doc: StoryDocument;
            try {
                doc = storyService.getStoryDocument(target.storyId);
            } catch {
                // The tab is open but its document is not in memory yet (e.g. right after a session
                // restore). Pull it in and recompute once it lands, leaving the readout untouched
                // meanwhile rather than flashing "no story open".
                void storyService
                    .loadStory(target.storyId)
                    .then(() => {
                        if (mounted && sameScene(activeScene.current, target)) {
                            computeFor(target);
                        }
                    })
                    .catch(() => undefined);
                return;
            }
            const scene = doc.scenes[target.sceneId];
            if (!scene) {
                setStats(null);
                return;
            }
            const counts = countSceneTextStats(scene);
            setStats({ name: getSceneName(doc.scenes, target.sceneId), words: counts.words, lines: counts.lines });
        };

        // Recompute only when the active scene actually changes, so unrelated layout noise (a split
        // sash drag, a non-scene tab gaining focus) does not walk the document.
        const syncActiveScene = () => {
            const target = resolveScene();
            if (sameScene(target, activeScene.current)) {
                return;
            }
            activeScene.current = target;
            computeFor(target);
        };

        syncActiveScene();

        const unsubscribeLayout = uiService.getEvents().on("editorLayoutChanged", syncActiveScene);
        const unsubscribeDoc = storyService.onDocumentChanged(event => {
            if (event.storyId !== activeScene.current?.storyId) {
                return;
            }
            if (timer.current) {
                clearTimeout(timer.current);
            }
            timer.current = setTimeout(() => computeFor(activeScene.current), 800);
        });

        return () => {
            mounted = false;
            unsubscribeLayout();
            unsubscribeDoc();
            if (timer.current) {
                clearTimeout(timer.current);
            }
        };
    }, [context]);

    const openDashboard = () => {
        if (context) {
            openDashboardTab(context);
        }
    };

    if (!stats) {
        return (
            <StatusEntry title={t("workspace.shell.statusBar.openDashboard")} onClick={openDashboard}>
                <BookText className="h-3 w-3" />
                <span>{t("workspace.shell.statusBar.noStoryOpen")}</span>
            </StatusEntry>
        );
    }
    return (
        <StatusEntry title={t("workspace.shell.statusBar.openDashboard")} onClick={openDashboard}>
            <BookText className="h-3 w-3 shrink-0" />
            <span className="max-w-[16ch] truncate">{stats.name}</span>
            <span className="tabular-nums">
                {t("workspace.shell.statusBar.words", { count: stats.words.toLocaleString() })}
            </span>
            <span className="tabular-nums">
                {t("workspace.shell.statusBar.lines", { count: stats.lines.toLocaleString() })}
            </span>
        </StatusEntry>
    );
}

export function ZoomEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [zoomPercent, setZoomPercent] = useState(100);

    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setZoomPercent(Number(settings.getSync(ZOOM_SETTINGS_KEY)) || 100);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === ZOOM_SETTINGS_KEY) {
                setZoomPercent(Number(change.value) || 100);
            }
        });
        return () => token?.cancel();
    }, [context]);

    // At 100% the readout would only ever say "100%" — silence is the more useful signal.
    if (zoomPercent === 100) {
        return null;
    }
    return (
        <StatusEntry
            title={t("workspace.shell.statusBar.resetZoom")}
            onClick={() => {
                void getInterface().app.state.setGlobalState(ZOOM_SETTINGS_KEY, 100);
            }}
        >
            <span className="tabular-nums">{zoomPercent}%</span>
        </StatusEntry>
    );
}

export function ThemeEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [themeMode, setThemeMode] = useState<ThemeMode>("auto");

    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setThemeMode((settings.getSync(THEME_SETTINGS_KEY) as ThemeMode) || "auto");
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === THEME_SETTINGS_KEY) {
                setThemeMode((change.value as ThemeMode) || "auto");
            }
        });
        return () => token?.cancel();
    }, [context]);

    return (
        <StatusEntry
            title={t(THEME_META[themeMode].labelKey)}
            onClick={() => {
                const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
                void getInterface().app.state.setGlobalState(THEME_SETTINGS_KEY, next);
            }}
        >
            {THEME_META[themeMode].icon}
        </StatusEntry>
    );
}

export function NotificationsEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const uiService = context ? context.services.get<UIService>(Services.UI) : null;
    const unread = useSyncExternalStore(
        listener => uiService?.notifications.onHistoryChanged(listener) ?? (() => {}),
        () => uiService?.notifications.getUnreadCount() ?? 0,
    );

    return (
        <StatusEntry
            title={t("workspace.shell.notifications.title")}
            onClick={() => {
                uiService?.getStore().setPanelVisibility(NOTIFICATIONS_PANEL_ID, true);
            }}
        >
            <span className="relative flex items-center">
                <Bell className="h-3 w-3" />
                {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none text-on-primary">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </span>
        </StatusEntry>
    );
}

export function ShortcutsEntry() {
    const { t } = useTranslation();
    return (
        <StatusEntry title={t("workspace.shell.statusBar.shortcuts")} onClick={openKeybindingCheatSheet}>
            <Keyboard className="h-3 w-3" />
        </StatusEntry>
    );
}
