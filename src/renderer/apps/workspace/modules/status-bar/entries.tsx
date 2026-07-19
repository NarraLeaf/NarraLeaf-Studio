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
import { computeProjectStatsSnapshot } from "@/lib/workspace/stats/projectStatsSnapshot";
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

export function WordCountEntry() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [totalWords, setTotalWords] = useState<number | null>(null);

    // Computed from the same snapshot the dashboard uses, refreshed on story edits with a long
    // debounce — this is ambient information, not a live counter.
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!context) {
            return;
        }
        let mounted = true;
        const recompute = () => {
            void computeProjectStatsSnapshot(context)
                .then(snapshot => {
                    if (mounted) {
                        setTotalWords(snapshot.scale.totalWords);
                    }
                })
                .catch(() => undefined);
        };
        recompute();
        const storyService = context.services.get<StoryService>(Services.Story);
        const unsubscribe = storyService.onDocumentChanged(() => {
            if (timer.current) {
                clearTimeout(timer.current);
            }
            timer.current = setTimeout(recompute, 2000);
        });
        return () => {
            mounted = false;
            unsubscribe();
            if (timer.current) {
                clearTimeout(timer.current);
            }
        };
    }, [context]);

    if (totalWords === null) {
        return null;
    }
    return (
        <StatusEntry
            title={t("workspace.shell.statusBar.openDashboard")}
            onClick={() => {
                if (context) {
                    openDashboardTab(context);
                }
            }}
        >
            <BookText className="h-3 w-3" />
            <span className="tabular-nums">
                {t("workspace.shell.statusBar.words", { count: totalWords.toLocaleString() })}
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
