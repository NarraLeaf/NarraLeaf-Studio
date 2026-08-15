import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BookText, CircleDot, GitBranch, History, Keyboard, Loader2, Monitor, Moon, Sun, TriangleAlert } from "lucide-react";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { SaveStatusService } from "@/lib/workspace/services/autosave/SaveStatusService";
import { getInterface } from "@/lib/app/bridge";
import { countSceneTextStats } from "@/lib/workspace/stats/storyTextStats";
import { getSceneName } from "../story/scene-editor/storySceneBlockUtils";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import type { StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import { openKeybindingCheatSheet } from "../../components/layout/KeybindingCheatSheet";
import { openDashboardTab } from "../dashboard";
import { NOTIFICATIONS_PANEL_ID } from "../notifications";
import { StatusEntry } from "./StatusEntry";
import { useActiveRunMode } from "./useActiveRunMode";
import { useVersionSurface } from "../../hooks/useVersionSurface";
import { openVersionRail } from "../../components/layout/versionRailController";
import { versionFace } from "../../components/layout/versionRailModel";
import type { TranslationKey } from "@shared/i18n";

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

/**
 * The single run-status cell. While a mode runs it reads "<mode> | <phase>" (e.g. "Dev Mode |
 * Compiling…") and clicking it opens the console, where that mode's output lands. It renders nothing
 * when idle — the bar is back to its resting colour then, so there is no state to report. The
 * theme-colour wash over the whole bar (see {@link StatusBar}) is the "something is running" signal;
 * this cell says *what*, without a status dot.
 */
export function RunStatusEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const active = useActiveRunMode();

    if (!active) {
        return null;
    }

    const openConsole = () => {
        context?.services.get<UIService>(Services.UI).panels.show("narraleaf-studio:console");
    };

    return (
        <StatusEntry emphasis onClick={openConsole} tooltip={t("workspace.shell.statusBar.openConsole")}>
            {active.busy && <Loader2 className="h-3 w-3 animate-spin" />}
            <span className="font-medium">{t(active.labelKey)}</span>
            <span aria-hidden className="opacity-50">|</span>
            <span>{t(active.phaseKey)}</span>
        </StatusEntry>
    );
}

/**
 * The save readout. Silent while everything is on disk; otherwise it reports the worst state across
 * every auto-saving document store — not just the story, which is all it used to watch.
 *
 * `failed` is the state worth the pixels: a write that keeps being rejected retries on a backoff
 * that never gives up, but the user still needs to know it is happening (their disk is full, their
 * project lives on a volume that went away). Clicking retries immediately instead of waiting out the
 * backoff.
 */
export function SaveStatusEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const saveStatus = context ? context.services.get<SaveStatusService>(Services.SaveStatus) : null;
    const status = useSyncExternalStore(
        listener => saveStatus?.onChanged(listener) ?? (() => {}),
        () => saveStatus?.getStatus() ?? "clean",
    );

    if (status === "clean" || status === "saving") {
        // "Saving…" would flicker on every 800ms auto-save; the absence of the cell already means
        // "on disk", and a save in flight is a fraction of a second away from being exactly that.
        return null;
    }

    const failed = status === "failed";
    return (
        <StatusEntry
            emphasis={failed}
            tooltip={t(failed ? "workspace.shell.statusBar.retrySave" : "workspace.shell.statusBar.saveNow")}
            onClick={() => {
                void saveStatus?.retryNow();
            }}
        >
            {failed ? <TriangleAlert className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
            <span>{t(failed ? "workspace.shell.statusBar.saveFailed" : "workspace.shell.statusBar.unsavedChanges")}</span>
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

    // Reopen (or refocus) the scene this cell is reporting on — the most-recently-edited scene —
    // so the readout doubles as a jump-back-to-writing shortcut. Falls back to the dashboard when
    // no scene is being tracked, matching the empty-state cell below.
    const openCurrentScene = () => {
        const scene = activeScene.current;
        if (!context || !scene) {
            openDashboard();
            return;
        }
        context.services
            .get<UIService>(Services.UI)
            .editor.open(createStorySceneEditorTab(
                { storyId: scene.storyId, sceneId: scene.sceneId },
                stats?.name ?? "",
            ));
    };

    if (!stats) {
        return (
            <StatusEntry tooltip={t("workspace.shell.statusBar.openDashboard")} onClick={openDashboard}>
                <BookText className="h-3 w-3" />
                <span>{t("workspace.shell.statusBar.noStoryOpen")}</span>
            </StatusEntry>
        );
    }
    return (
        <StatusEntry tooltip={t("workspace.shell.statusBar.openCurrentScene")} onClick={openCurrentScene}>
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
            tooltip={t("workspace.shell.statusBar.resetZoom")}
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
            tooltip={t(THEME_META[themeMode].labelKey)}
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
            tooltip={t("workspace.shell.notifications.title")}
            onClick={() => {
                uiService?.getStore().setPanelVisibility(NOTIFICATIONS_PANEL_ID, true);
            }}
        >
            <span className="relative flex items-center">
                <Bell className="h-3 w-3" />
                {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-2xs leading-none text-on-primary">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </span>
        </StatusEntry>
    );
}

/**
 * The version cell: which version this window is a view of, click opens the rail.
 *
 * What it says comes from `versionFace`, shared with the switcher menu and the rail's focused
 * block - the three of them naming one version three ways is a contradiction an author reads as a
 * broken feature, and it has happened here before. Merges and ahead/behind markers are still
 * undecided; when they land, they land in that function.
 *
 * The width cap is a MAXIMUM, so it costs nothing in the ordinary case: `#12` is three characters
 * wide whatever the cap says. It only becomes real on a branch, and it is there to stop a long
 * branch name from pushing the cells beside this one off the bar.
 *
 * Silent in exactly two states: no version control on this host (it was never shipped for this
 * OS/arch, so a cell would be reporting on a feature that does not exist) and while the first probe
 * is still out. It speaks up for a project with no repository, because "not under version control"
 * is a thing the author needs to be able to notice.
 */
export function VersionEntry() {
    const { t } = useTranslation();
    // Its own reader rather than the layout's: this cell is not in the rail's tree, and the service
    // caches availability, so a second reader costs one `isRepository` and one `getInfo` round trip
    // at mount and nothing until a revision is recorded. Neither of them scans - see
    // useVersionSurface.
    const { state, branch } = useVersionSurface();

    if (state.kind === "unavailable" || state.kind === "probing") {
        return null;
    }
    const onRevision = state.kind === "revision";
    const face = versionFace({ state, branch }, t);

    return (
        <StatusEntry
            emphasis={onRevision}
            tooltip={onRevision
                // The UNCUT line, so a branch name this cell had to shorten is still readable.
                ? t("workspace.shell.versionControl.viewingVersion", { version: face.full })
                : face.full !== face.text ? face.full : t("workspace.shell.versionControl.open")}
            onClick={openVersionRail}
        >
            {onRevision ? <History className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
            <span className="max-w-[22ch] truncate tabular-nums">{face.text}</span>
        </StatusEntry>
    );
}

export function ShortcutsEntry() {
    const { t } = useTranslation();
    return (
        <StatusEntry tooltip={t("workspace.shell.statusBar.shortcuts")} onClick={openKeybindingCheatSheet}>
            <Keyboard className="h-3 w-3" />
        </StatusEntry>
    );
}
