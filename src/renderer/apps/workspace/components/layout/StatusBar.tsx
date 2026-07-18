import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BookText, CircleDot, Keyboard, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useWorkspace } from "../../context";
import { useStatusBarItems } from "../../hooks/useUIService";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { StatusBarAlignment, type StatusBarItem } from "@/lib/workspace/services/ui/types";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { getInterface } from "@/lib/app/bridge";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "../../modules/actions/runtimeActionStatus";
import { openKeybindingCheatSheet } from "./KeybindingCheatSheet";
import { openDashboardTab } from "../../modules/dashboard";
import { NOTIFICATIONS_PANEL_ID } from "../../modules/notifications";
import { computeProjectStatsSnapshot } from "@/lib/workspace/stats/projectStatsSnapshot";
import { LOCALE_META, SUPPORTED_LOCALES, type Locale } from "@shared/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";

/** Fixed bar height; the dock solver subtracts this from the viewport it lays out into. */
export const STATUS_BAR_HEIGHT = 24;

const ZOOM_SETTINGS_KEY = "ui.zoomPercent";
const THEME_SETTINGS_KEY = "ui.themeMode";

type ThemeMode = "auto" | "light" | "dark";
const THEME_CYCLE: ThemeMode[] = ["auto", "light", "dark"];
const THEME_META: Record<ThemeMode, { icon: React.ReactNode; labelKey: TranslationKey }> = {
    auto: { icon: <Monitor className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.auto" as TranslationKey },
    light: { icon: <Sun className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.light" as TranslationKey },
    dark: { icon: <Moon className="h-3 w-3" />, labelKey: "settings.items.themeMode.options.dark" as TranslationKey },
};

function StatusEntry({
    onClick,
    title,
    children,
    emphasis = false,
}: {
    onClick?: () => void;
    title?: string;
    children: React.ReactNode;
    emphasis?: boolean;
}) {
    const className = `flex h-full items-center gap-1.5 px-2 text-2xs ${
        emphasis ? "text-fg-muted" : "text-fg-subtle"
    } ${onClick ? "cursor-default transition-colors hover:bg-fill hover:text-fg" : ""}`;
    if (!onClick) {
        return (
            <span className={className} title={title}>
                {children}
            </span>
        );
    }
    return (
        <button type="button" onClick={onClick} title={title} className={className}>
            {children}
        </button>
    );
}

/**
 * The workspace status bar: one quiet strip along the bottom. Built-in signals only appear when
 * they carry information (a runtime actually running, a build in flight, unsaved story changes,
 * a non-default zoom) — an idle workspace shows nothing but the shortcut hint. Items registered
 * on the StatusBarService (plugins, modules) render alongside, split by alignment.
 */
export function StatusBar() {
    const { t, locale, setLocale } = useTranslation();
    const { context } = useWorkspace();
    const serviceItems = useStatusBarItems();

    const [devModeStatus, setDevModeStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
    const [building, setBuilding] = useState(false);
    const [storyDirty, setStoryDirty] = useState(false);
    const [zoomPercent, setZoomPercent] = useState(100);
    const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
    const [totalWords, setTotalWords] = useState<number | null>(null);

    // Notification bell: unread state shared with the notifications panel (service-owned).
    const uiService = context ? context.services.get<UIService>(Services.UI) : null;
    const unread = useSyncExternalStore(
        listener => uiService?.notifications.onHistoryChanged(listener) ?? (() => {}),
        () => uiService?.notifications.getUnreadCount() ?? 0,
    );

    // Project word count: computed from the same snapshot the dashboard uses, refreshed on story
    // edits with a long debounce — this is ambient information, not a live counter.
    const wordCountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            if (wordCountTimer.current) {
                clearTimeout(wordCountTimer.current);
            }
            wordCountTimer.current = setTimeout(recompute, 2000);
        });
        return () => {
            mounted = false;
            unsubscribe();
            if (wordCountTimer.current) {
                clearTimeout(wordCountTimer.current);
            }
        };
    }, [context]);

    useEffect(() => {
        if (!context) {
            return;
        }
        const devMode = context.services.get<DevModeService>(Services.DevMode);
        const preview = context.services.get<PreviewService>(Services.Preview);
        const build = context.services.get<BuildService>(Services.Build);
        const story = context.services.get<StoryService>(Services.Story);
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);

        setDevModeStatus(devMode.getStatus());
        setPreviewStatus(preview.getStatus());
        setBuilding(build.isBuilding());
        setStoryDirty(story.isDirty());
        setZoomPercent(Number(settings.getSync(ZOOM_SETTINGS_KEY)) || 100);
        setThemeMode((settings.getSync(THEME_SETTINGS_KEY) as ThemeMode) || "auto");

        const unsubs = [
            devMode.onStatusChanged(setDevModeStatus),
            preview.onStatusChanged(setPreviewStatus),
            build.onStateChanged(state =>
                setBuilding(state.status === "preparing" || state.status === "compiling" || state.status === "packaging"),
            ),
            story.onDirtyChanged(setStoryDirty),
        ];
        const zoomToken = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === ZOOM_SETTINGS_KEY) {
                setZoomPercent(Number(change.value) || 100);
            } else if (change.key === THEME_SETTINGS_KEY) {
                setThemeMode((change.value as ThemeMode) || "auto");
            }
        });
        return () => {
            unsubs.forEach(unsub => unsub());
            zoomToken?.cancel();
        };
    }, [context]);

    const renderServiceItems = (alignment: StatusBarAlignment) =>
        serviceItems
            .filter(item => item.visible !== false && item.alignment === alignment)
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map((item: StatusBarItem) => (
                <StatusEntry key={item.id} onClick={item.command} title={item.tooltip}>
                    {item.icon}
                    <span className="truncate">{item.text}</span>
                </StatusEntry>
            ));

    return (
        <div
            // Extra side padding keeps entries clear of the window's rounded corners.
            className="flex shrink-0 items-stretch justify-between overflow-hidden border-t border-edge bg-surface-sunken px-3"
            style={{ height: STATUS_BAR_HEIGHT }}
        >
            <div className="flex min-w-0 items-stretch">
                {isDevModeRuntimeActive(devModeStatus) && (
                    <StatusEntry emphasis title={t("workspace.shell.statusBar.devModeRunning")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        <span>{t("workspace.shell.statusBar.devMode")}</span>
                    </StatusEntry>
                )}
                {isPreviewRuntimeActive(previewStatus) && (
                    <StatusEntry emphasis title={t("workspace.shell.statusBar.previewRunning")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        <span>{t("workspace.shell.statusBar.preview")}</span>
                    </StatusEntry>
                )}
                {building && (
                    <StatusEntry emphasis title={t("workspace.shell.statusBar.building")}>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t("workspace.shell.statusBar.building")}</span>
                    </StatusEntry>
                )}
                {storyDirty && (
                    <StatusEntry
                        title={t("workspace.shell.statusBar.saveNow")}
                        onClick={() => {
                            void context?.services.get<StoryService>(Services.Story).flushPendingChanges();
                        }}
                    >
                        <CircleDot className="h-3 w-3" />
                        <span>{t("workspace.shell.statusBar.unsavedChanges")}</span>
                    </StatusEntry>
                )}
                {totalWords !== null && (
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
                )}
                {renderServiceItems(StatusBarAlignment.Left)}
            </div>

            <div className="flex min-w-0 items-stretch">
                {renderServiceItems(StatusBarAlignment.Right)}
                {zoomPercent !== 100 && (
                    <StatusEntry
                        title={t("workspace.shell.statusBar.resetZoom")}
                        onClick={() => {
                            void getInterface().app.state.setGlobalState(ZOOM_SETTINGS_KEY, 100);
                        }}
                    >
                        <span className="tabular-nums">{zoomPercent}%</span>
                    </StatusEntry>
                )}
                <StatusEntry
                    title={LOCALE_META[SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale as Locale) + 1) % SUPPORTED_LOCALES.length]].nativeName}
                    onClick={() => {
                        const next = SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale as Locale) + 1) % SUPPORTED_LOCALES.length];
                        setLocale(next);
                    }}
                >
                    <span className="tabular-nums">{LOCALE_META[locale as Locale]?.nativeName ?? locale}</span>
                </StatusEntry>
                <StatusEntry
                    title={t(THEME_META[themeMode].labelKey)}
                    onClick={() => {
                        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
                        void getInterface().app.state.setGlobalState(THEME_SETTINGS_KEY, next);
                    }}
                >
                    {THEME_META[themeMode].icon}
                </StatusEntry>
                <StatusEntry
                    title={t("workspace.shell.notifications.title")}
                    onClick={() => {
                        uiService?.getStore().setPanelVisibility(NOTIFICATIONS_PANEL_ID, true);
                    }}
                >
                    <span className="relative flex items-center">
                        <Bell className="h-3 w-3" />
                        {unread > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none text-white">
                                {unread > 9 ? "9+" : unread}
                            </span>
                        )}
                    </span>
                </StatusEntry>
                <StatusEntry title={t("workspace.shell.statusBar.shortcuts")} onClick={openKeybindingCheatSheet}>
                    <Keyboard className="h-3 w-3" />
                </StatusEntry>
            </div>
        </div>
    );
}
