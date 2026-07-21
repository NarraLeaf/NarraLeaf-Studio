import React, { useState, useCallback, useEffect, useRef } from "react";
import { TitleBar } from "@/lib/components/layout";
import { LeftSidebarSelector } from "./LeftSidebarSelector";
import { BottomPanelSelector } from "./BottomPanelSelector";
import { RightSidebarSelector } from "./RightSidebarSelector";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { BottomPanel } from "./BottomPanel";
import { MainEditorArea } from "./MainEditorArea";
import { ActionBar } from "./ActionBar";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ControlBar } from "./ControlBar";
import { NotificationContainer } from "../ui/NotificationContainer";
import { DialogContainer } from "../ui/DialogContainer";
import { ResizableHandle } from "../ui/ResizableHandle";
import { EditorClosedTabsKeybinding } from "./EditorClosedTabsKeybinding";
import { WorkspaceEditorQuickSwitch } from "./WorkspaceEditorQuickSwitch";
import { CommandPalette } from "./CommandPalette";
import { EditorCommands } from "./EditorCommands";
import { KeybindingCheatSheet } from "./KeybindingCheatSheet";
import { TitleBarSearchBox } from "./TitleBarSearchBox";
import { StatusBar, STATUS_BAR_HEIGHT } from "./StatusBar";
import { QuickOpenPicker } from "./QuickOpenPicker";
import { BackgroundImageDialog } from "./BackgroundImageDialog";
import { useWorkspaceBackgroundImage } from "./useWorkspaceBackgroundImage";
import { backgroundLayerStyle } from "@/lib/workspace/services/ui/backgroundSettings";
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { getInterface } from "@/lib/app/bridge";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isMacPlatform } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import { WorkspaceMenuAction } from "@shared/types/menu";
import {
    DOCK_REGIONS,
    EDITOR_FLOOR,
    applyResize,
    resolveDock,
    type DockEnv,
} from "./dockLayoutModel";

interface WorkspaceLayoutProps {
    title: string;
    iconSrc: string;
}


// Region sizing lives in ./dockLayoutModel (constraint table + solver). The persisted values
// below are the user's *intended* sizes; the *effective* rendered sizes are derived each render
// via resolveDock(), so nothing is mutated on window resize.

// Settings keys for persistence
const SETTINGS_KEYS = {
    LEFT_SIDEBAR_VISIBLE: "ui.leftSidebar.visible",
    LEFT_SIDEBAR_WIDTH: "ui.leftSidebar.width",
    LEFT_SIDEBAR_ACTIVE_PANEL: "ui.leftSidebar.activePanel",
    LEFT_SIDEBAR_ORDER: "ui.leftSidebar.order",
    RIGHT_SIDEBAR_VISIBLE: "ui.rightSidebar.visible",
    RIGHT_SIDEBAR_WIDTH: "ui.rightSidebar.width",
    RIGHT_SIDEBAR_ACTIVE_PANEL: "ui.rightSidebar.activePanel",
    RIGHT_SIDEBAR_ORDER: "ui.rightSidebar.order",
    BOTTOM_PANEL_VISIBLE: "ui.bottomPanel.visible",
    BOTTOM_PANEL_HEIGHT: "ui.bottomPanel.height",
    BOTTOM_PANEL_ACTIVE_PANEL: "ui.bottomPanel.activePanel",
    BOTTOM_PANEL_ORDER: "ui.bottomPanel.order",
};

const ORDER_SETTINGS_KEY_BY_POSITION: Record<PanelPosition, string> = {
    [PanelPosition.Left]: SETTINGS_KEYS.LEFT_SIDEBAR_ORDER,
    [PanelPosition.Right]: SETTINGS_KEYS.RIGHT_SIDEBAR_ORDER,
    [PanelPosition.Bottom]: SETTINGS_KEYS.BOTTOM_PANEL_ORDER,
};

const REMOVED_PANEL_IDS = new Set(["narraleaf-studio:running-tasks"]);

/** The dock toggles this layout publishes; a private id, since the group declares its own slot. */
const PANEL_TOGGLES_GROUP_ID = "narraleaf-studio:window-panels";

function normalizeStoredPanelId(panelId: string | null | undefined): string | null | undefined {
    if (panelId && REMOVED_PANEL_IDS.has(panelId)) {
        return null;
    }
    return panelId;
}

/**
 * Main workspace layout container
 * Provides VSCode/IDEA-like layout with:
 * - Title bar containing action bar (left) and control bar (right) with window controls
 * - Left sidebar with selector (resizable)
 * - Right sidebar with selector (resizable)
 * - Bottom panel with selector (resizable)
 * - Main editor area with tabs and split support
 */
export function WorkspaceLayout({ title, iconSrc }: WorkspaceLayoutProps) {
    const { getPanelsByPosition, registerActionGroup, unregisterActionGroup } = useRegistry();
    const { context } = useWorkspace();
    const { t } = useTranslation();

    // Sidebar visibility states
    const [leftSidebarVisible, setLeftSidebarVisible] = useState(false);
    const [rightSidebarVisible, setRightSidebarVisible] = useState(false);
    const [bottomPanelVisible, setBottomPanelVisible] = useState(false);

    // Active panel IDs
    const [activeLeftPanelId, setActiveLeftPanelId] = useState<string | null>(null);
    const [activeRightPanelId, setActiveRightPanelId] = useState<string | null>(null);
    const [activeBottomPanelId, setActiveBottomPanelId] = useState<string | null>(null);

    // User-defined panel ordering per dock area (mirror of UIStore, persisted here)
    const [panelOrders, setPanelOrders] = useState<Partial<Record<PanelPosition, string[]>>>({});

    // Intended region sizes (the user's last drag target). Effective rendered sizes are derived
    // from these via resolveDock() below — these are never mutated on window resize.
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DOCK_REGIONS.left.default);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DOCK_REGIONS.right.default);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(DOCK_REGIONS.bottom.default);

    // Status bar visibility (global setting); its height is only carved out of the dock layout
    // while it is actually shown.
    const [statusBarVisible, setStatusBarVisible] = useState(true);
    // The title-bar search box is optional too; hiding it moves the palette's input into its own card.
    const [titleBarSearchVisible, setTitleBarSearchVisible] = useState(true);
    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setStatusBarVisible(settings.getSync("ui.statusBar.visible") !== false);
        setTitleBarSearchVisible(settings.getSync("ui.titleBarSearch.visible") !== false);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === "ui.statusBar.visible") {
                setStatusBarVisible(change.value !== false);
            }
            if (change.key === "ui.titleBarSearch.visible") {
                setTitleBarSearchVisible(change.value !== false);
            }
        });
        return () => token?.cancel();
    }, [context]);
    const statusBarHeight = statusBarVisible ? STATUS_BAR_HEIGHT : 0;

    // Live viewport dimensions; drives the derived effective sizes so the layout reflows with the
    // window. Height excludes the status bar — the dock solver lays out into what is left above it.
    const [viewport, setViewport] = useState(() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 1280,
        height: (typeof window !== "undefined" ? window.innerHeight : 800) - STATUS_BAR_HEIGHT,
    }));

    // Refs mirror the intended sizes for synchronous reads during fast dragging.
    const leftSidebarWidthRef = useRef(DOCK_REGIONS.left.default);
    const rightSidebarWidthRef = useRef(DOCK_REGIONS.right.default);
    const bottomPanelHeightRef = useRef(DOCK_REGIONS.bottom.default);
    const activeLeftPanelIdRef = useRef<string | null>(null);
    const activeRightPanelIdRef = useRef<string | null>(null);
    const activeBottomPanelIdRef = useRef<string | null>(null);
    // Visibility mirrors, read by the resize handlers when computing cross-axis drag bounds.
    const leftSidebarVisibleRef = useRef(false);
    const rightSidebarVisibleRef = useRef(false);

    // Settings service
    const settingsService = context?.services.get<GlobalSettingsService>(Services.GlobalSettings);

    // Track whether settings have been loaded
    const [settingsLoaded, setSettingsLoaded] = useState(false);

    // Debounced save settings to reduce file system access
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const debouncedSaveSettings = useCallback(async () => {
        // Clear existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Set new timeout with 500ms delay
        saveTimeoutRef.current = setTimeout(async () => {
            if (!settingsService) return;

            try {
                const settings = {
                    [SETTINGS_KEYS.LEFT_SIDEBAR_VISIBLE]: leftSidebarVisible,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_WIDTH]: leftSidebarWidth,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_ACTIVE_PANEL]: activeLeftPanelId,
                    [SETTINGS_KEYS.LEFT_SIDEBAR_ORDER]: panelOrders[PanelPosition.Left] ?? null,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_VISIBLE]: rightSidebarVisible,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_WIDTH]: rightSidebarWidth,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL]: activeRightPanelId,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_ORDER]: panelOrders[PanelPosition.Right] ?? null,
                    [SETTINGS_KEYS.BOTTOM_PANEL_VISIBLE]: bottomPanelVisible,
                    [SETTINGS_KEYS.BOTTOM_PANEL_HEIGHT]: bottomPanelHeight,
                    [SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL]: activeBottomPanelId,
                    [SETTINGS_KEYS.BOTTOM_PANEL_ORDER]: panelOrders[PanelPosition.Bottom] ?? null,
                };

                await settingsService.setBatch(settings);
            } catch (error) {
                console.error("Failed to save workspace layout settings:", error);
            }
        }, 500);
    }, [
        settingsService,
        leftSidebarVisible,
        leftSidebarWidth,
        activeLeftPanelId,
        rightSidebarVisible,
        rightSidebarWidth,
        activeRightPanelId,
        bottomPanelVisible,
        bottomPanelHeight,
        activeBottomPanelId,
        panelOrders,
    ]);

    useEffect(() => {
        activeLeftPanelIdRef.current = activeLeftPanelId;
    }, [activeLeftPanelId]);

    useEffect(() => {
        activeRightPanelIdRef.current = activeRightPanelId;
    }, [activeRightPanelId]);

    useEffect(() => {
        activeBottomPanelIdRef.current = activeBottomPanelId;
    }, [activeBottomPanelId]);

    useEffect(() => {
        leftSidebarVisibleRef.current = leftSidebarVisible;
    }, [leftSidebarVisible]);

    useEffect(() => {
        rightSidebarVisibleRef.current = rightSidebarVisible;
    }, [rightSidebarVisible]);

    // Load saved state on mount
    useEffect(() => {
        if (!settingsService) return;

        const loadSettings = async () => {
            try {
                // Load sidebar visibility
                const leftVisible = await settingsService.get<boolean>(SETTINGS_KEYS.LEFT_SIDEBAR_VISIBLE);
                const rightVisible = await settingsService.get<boolean>(SETTINGS_KEYS.RIGHT_SIDEBAR_VISIBLE);
                const bottomVisible = await settingsService.get<boolean>(SETTINGS_KEYS.BOTTOM_PANEL_VISIBLE);

                // Load sidebar sizes
                const leftWidth = await settingsService.get<number>(SETTINGS_KEYS.LEFT_SIDEBAR_WIDTH);
                const rightWidth = await settingsService.get<number>(SETTINGS_KEYS.RIGHT_SIDEBAR_WIDTH);
                const bottomHeight = await settingsService.get<number>(SETTINGS_KEYS.BOTTOM_PANEL_HEIGHT);

                // Load active panels
                const leftPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.LEFT_SIDEBAR_ACTIVE_PANEL));
                const rightPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL));
                const bottomPanel = normalizeStoredPanelId(await settingsService.get<string | null>(SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL));

                // Only update if values exist in settings
                if (leftVisible !== undefined) setLeftSidebarVisible(Boolean(leftVisible && leftPanel !== null));
                if (rightVisible !== undefined) setRightSidebarVisible(Boolean(rightVisible && rightPanel !== null));
                if (bottomVisible !== undefined) setBottomPanelVisible(Boolean(bottomVisible && bottomPanel !== null));
                if (leftWidth !== undefined) {
                    setLeftSidebarWidth(leftWidth);
                    leftSidebarWidthRef.current = leftWidth;
                }
                if (rightWidth !== undefined) {
                    setRightSidebarWidth(rightWidth);
                    rightSidebarWidthRef.current = rightWidth;
                }
                if (bottomHeight !== undefined) {
                    setBottomPanelHeight(bottomHeight);
                    bottomPanelHeightRef.current = bottomHeight;
                }
                if (leftPanel !== undefined) setActiveLeftPanelId(leftPanel);
                if (rightPanel !== undefined) setActiveRightPanelId(rightPanel);
                if (bottomPanel !== undefined) setActiveBottomPanelId(bottomPanel);

                // Load persisted panel ordering and apply it to the UIStore (source of truth).
                const store = context?.services.get<UIService>(Services.UI).getStore();
                const loadedOrders: Partial<Record<PanelPosition, string[]>> = {};
                for (const position of [PanelPosition.Left, PanelPosition.Right, PanelPosition.Bottom]) {
                    const savedOrder = await settingsService.get<string[]>(ORDER_SETTINGS_KEY_BY_POSITION[position]);
                    if (Array.isArray(savedOrder) && savedOrder.length > 0) {
                        loadedOrders[position] = savedOrder;
                        store?.setPanelOrder(position, savedOrder);
                    }
                }
                setPanelOrders(loadedOrders);

                setSettingsLoaded(true);
                console.log("[WorkspaceLayout] Settings loaded successfully");
            } catch (error) {
                console.error("Failed to load workspace layout settings:", error);
                setSettingsLoaded(true); // Mark as loaded even on error to allow saving
            }
        };

        loadSettings();
    }, [settingsService, context]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    // Track the live viewport so the derived effective sizes reflow with the window. Unlike the
    // old clamp-on-resize logic, this never mutates the intended sizes — a panel clamped down on a
    // small window grows back toward its intent when space returns.
    useEffect(() => {
        const handleWindowResize = () => {
            setViewport({ width: window.innerWidth, height: window.innerHeight - statusBarHeight });
        };
        handleWindowResize();
        window.addEventListener("resize", handleWindowResize);
        return () => {
            window.removeEventListener("resize", handleWindowResize);
        };
    }, [statusBarHeight]);

    // Save state when it changes (but only after initial load)
    useEffect(() => {
        if (!settingsService || !settingsLoaded) return;

        // Trigger debounced save
        debouncedSaveSettings();
    }, [
        settingsService,
        settingsLoaded,
        debouncedSaveSettings,
    ]);

    // Live environment for the sizing solver, rebuilt from the current viewport + visibility.
    const dockEnv: DockEnv = {
        windowWidth: viewport.width,
        windowHeight: viewport.height,
        leftVisible: leftSidebarVisible,
        rightVisible: rightSidebarVisible,
    };

    // Effective (rendered) sizes derived from the intended sizes. Sidebars are protected from
    // eating the editor floor (clamp); the bottom panel may cover it (clip).
    const effective = resolveDock(
        { left: leftSidebarWidth, right: rightSidebarWidth, bottom: bottomPanelHeight },
        dockEnv,
    );

    // Resize handlers. Refs give synchronous reads during fast drags; applyResize enforces the
    // region constraints and returns the position correction ResizableHandle expects.
    const currentEnv = useCallback(
        (): DockEnv => ({
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            leftVisible: leftSidebarVisibleRef.current,
            rightVisible: rightSidebarVisibleRef.current,
        }),
        []
    );

    const handleLeftSidebarResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "left", leftSidebarWidthRef.current, delta, currentEnv(), rightSidebarWidthRef.current
        );
        leftSidebarWidthRef.current = next;
        setLeftSidebarWidth(next);
        return correction;
    }, [currentEnv]);

    const handleRightSidebarResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "right", rightSidebarWidthRef.current, delta, currentEnv(), leftSidebarWidthRef.current
        );
        rightSidebarWidthRef.current = next;
        setRightSidebarWidth(next);
        return correction;
    }, [currentEnv]);

    const handleBottomPanelResize = useCallback((delta: number) => {
        const { next, correction } = applyResize(
            "bottom", bottomPanelHeightRef.current, delta, currentEnv(), 0
        );
        bottomPanelHeightRef.current = next;
        setBottomPanelHeight(next);
        return correction;
    }, [currentEnv]);

    // The first panel that would actually show in a dock's rail: not hidden, and not a (bodyless)
    // rail action — so opening a sidebar with no active panel never lands on a hidden or empty one.
    const firstVisiblePanelId = (position: PanelPosition): string | null => {
        const visibility = context?.services.get<UIService>(Services.UI).getStore().getPanelVisibility() ?? {};
        const first = getPanelsByPosition(position).find(
            panel => !panel.railAction && visibility[panel.id] !== false,
        );
        return first?.id ?? null;
    };

    // Enhanced toggle functions that auto-select first panel if none is active
    const toggleLeftSidebar = () => {
        if (!leftSidebarVisible && !activeLeftPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Left);
            if (firstId) {
                setActiveLeftPanelId(firstId);
            }
        }
        setLeftSidebarVisible(!leftSidebarVisible);
    };

    const toggleRightSidebar = () => {
        if (!rightSidebarVisible && !activeRightPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Right);
            if (firstId) {
                setActiveRightPanelId(firstId);
            }
        }
        setRightSidebarVisible(!rightSidebarVisible);
    };

    const toggleBottomPanel = () => {
        if (!bottomPanelVisible && !activeBottomPanelId) {
            const firstId = firstVisiblePanelId(PanelPosition.Bottom);
            if (firstId) {
                setActiveBottomPanelId(firstId);
            }
        }
        setBottomPanelVisible(!bottomPanelVisible);
    };

    // The toggles close over render-scoped state, so the menu calls them through refs rather
    // than re-registering the group on every render.
    const panelTogglesRef = useRef({ toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar });
    panelTogglesRef.current = { toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar };

    // One command table for the dock toggles, consumed by every surface: the CommandService (so
    // the palette reaches them on every platform) and — on macOS only — the Window menu group,
    // generated from the same definitions. ControlBar buttons stay the pointer-first entry point.
    useEffect(() => {
        const toggleDefs = [
            {
                id: WorkspaceMenuAction.ToggleLeftSidebar,
                labelKey: "menu.window.leftSidebar" as const,
                checked: leftSidebarVisible,
                run: () => panelTogglesRef.current.toggleLeftSidebar(),
            },
            {
                id: WorkspaceMenuAction.ToggleBottomPanel,
                labelKey: "menu.window.bottomPanel" as const,
                checked: bottomPanelVisible,
                run: () => panelTogglesRef.current.toggleBottomPanel(),
            },
            {
                id: WorkspaceMenuAction.ToggleRightSidebar,
                labelKey: "menu.window.rightSidebar" as const,
                checked: rightSidebarVisible,
                run: () => panelTogglesRef.current.toggleRightSidebar(),
            },
        ];

        const commandService = context?.services.get<CommandService>(Services.Command);
        const disposeCommands = commandService?.registerMany(
            toggleDefs.map(def => ({
                id: def.id,
                titleKey: def.labelKey,
                categoryKey: "workspace.shell.commandPalette.categoryView" as const,
                run: () => def.run(),
            })),
        );

        // The in-app dropdown would only duplicate the ControlBar buttons, so the group goes to
        // the native menu bar alone — which exists on macOS only.
        if (isMacPlatform()) {
            registerActionGroup({
                id: PANEL_TOGGLES_GROUP_ID,
                label: t("menu.window.title"),
                menuSlot: "window",
                items: toggleDefs.map((def, order) => ({
                    id: def.id,
                    label: t(def.labelKey),
                    checked: def.checked,
                    onClick: def.run,
                    order,
                })),
            });
        }

        return () => {
            disposeCommands?.();
            if (isMacPlatform()) {
                unregisterActionGroup(PANEL_TOGGLES_GROUP_ID);
            }
        };
    }, [t, context, leftSidebarVisible, bottomPanelVisible, rightSidebarVisible, registerActionGroup, unregisterActionGroup]);

    const activateLeftPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveLeftPanelId(panelId);
            setLeftSidebarVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
            }
        },
        [context]
    );

    const activateRightPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveRightPanelId(panelId);
            setRightSidebarVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.RightPanel, panelId);
            }
        },
        [context]
    );

    const activateBottomPanelForDrop = useCallback(
        (panelId: string) => {
            setActiveBottomPanelId(panelId);
            setBottomPanelVisible(true);
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                uiService.focus.setFocus(FocusArea.BottomPanel, panelId);
            }
        },
        [context]
    );

    useEffect(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        const panelsByPosition = (position: PanelPosition) => {
            return store.getPanels().filter(panel => panel.position === position);
        };

        const showPanel = (panel: PanelDefinition) => {
            // A rail action has no body — restoring its visibility just brings the rail icon back;
            // it must not become the active panel or open the sidebar onto nothing.
            if (panel.railAction) {
                return;
            }
            if (panel.position === PanelPosition.Left) {
                setActiveLeftPanelId(panel.id);
                setLeftSidebarVisible(true);
            } else if (panel.position === PanelPosition.Right) {
                setActiveRightPanelId(panel.id);
                setRightSidebarVisible(true);
            } else {
                setActiveBottomPanelId(panel.id);
                setBottomPanelVisible(true);
            }
        };

        const hidePanel = (panel: PanelDefinition) => {
            // Pick a replacement among the panels that are still visible (rail actions excluded —
            // they have no body). Prefer the nearest one before the hidden panel, else the one after.
            const visibility = store.getPanelVisibility();
            const panels = panelsByPosition(panel.position);
            const isReplacement = (candidate: PanelDefinition) =>
                candidate.id !== panel.id && !candidate.railAction && visibility[candidate.id] !== false;
            const targetIndex = panels.findIndex(entry => entry.id === panel.id);
            const before = panels.slice(0, Math.max(targetIndex, 0)).filter(isReplacement).at(-1);
            const after = panels.slice(targetIndex + 1).find(isReplacement);
            const fallbackId = (before ?? after)?.id ?? null;
            if (panel.position === PanelPosition.Left && activeLeftPanelIdRef.current === panel.id) {
                setActiveLeftPanelId(fallbackId);
                setLeftSidebarVisible(Boolean(fallbackId));
            } else if (panel.position === PanelPosition.Right && activeRightPanelIdRef.current === panel.id) {
                setActiveRightPanelId(fallbackId);
                setRightSidebarVisible(Boolean(fallbackId));
            } else if (panel.position === PanelPosition.Bottom && activeBottomPanelIdRef.current === panel.id) {
                setActiveBottomPanelId(fallbackId);
                setBottomPanelVisible(Boolean(fallbackId));
            }
        };

        const handlePanelVisibilityChanged = ({ panelId, visible }: { panelId: string; visible: boolean }) => {
            const panel = store.getPanels().find(item => item.id === panelId);
            if (!panel) {
                return;
            }
            visible ? showPanel(panel) : hidePanel(panel);
        };

        const handlePanelUnregistered = (panelId: string) => {
            if (activeLeftPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Left).at(-1)?.id ?? null;
                setActiveLeftPanelId(fallbackId);
                setLeftSidebarVisible(Boolean(fallbackId));
            }
            if (activeRightPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Right).at(-1)?.id ?? null;
                setActiveRightPanelId(fallbackId);
                setRightSidebarVisible(Boolean(fallbackId));
            }
            if (activeBottomPanelIdRef.current === panelId) {
                const fallbackId = panelsByPosition(PanelPosition.Bottom).at(-1)?.id ?? null;
                setActiveBottomPanelId(fallbackId);
                setBottomPanelVisible(Boolean(fallbackId));
            }
        };

        const handlePanelOrderChanged = ({ position, order }: { position: string; order: string[] }) => {
            setPanelOrders(prev => ({ ...prev, [position as PanelPosition]: order }));
        };

        const unsubscribeVisibility = uiService.getEvents().on("panelVisibilityChanged", handlePanelVisibilityChanged);
        const unsubscribeUnregistered = uiService.getEvents().on("panelUnregistered", handlePanelUnregistered);
        const unsubscribeOrder = uiService.getEvents().on("panelOrderChanged", handlePanelOrderChanged);
        return () => {
            unsubscribeVisibility();
            unsubscribeUnregistered();
            unsubscribeOrder();
        };
    }, [context]);

    const isMac = isMacPlatform();

    // Custom workspace background. Rendered as ONE pre-composited backdrop behind all chrome: the
    // surface colour with the wallpaper already blended in at its configured strength (the 2–40%
    // "opacity" the dialog exposes). When it is active, `nl-has-workspace-bg` makes every base
    // `bg-surface` fill fully TRANSPARENT (see styles.css), so the panels AND the seams between them
    // reveal this single layer uniformly. Because no element ever paints the raw picture, there is
    // no bright bleed through the gaps; and text, icons, borders, raised/overlay surfaces and content
    // images all keep their own opaque paints, so real content never reads as see-through.
    const { settings: backgroundSettings, url: backgroundUrl } = useWorkspaceBackgroundImage();

    return (
        <div
            className={`relative isolate h-screen w-screen flex flex-col bg-surface text-fg${backgroundUrl ? " nl-has-workspace-bg" : ""}`}
        >
            {backgroundUrl && (
                <div
                    aria-hidden
                    className="pointer-events-none fixed inset-0 overflow-hidden"
                    style={{ zIndex: -1, backgroundColor: "rgb(var(--nl-surface))" }}
                >
                    <div className="absolute" style={backgroundLayerStyle(backgroundSettings, backgroundUrl)} />
                </div>
            )}
            {/* Title Bar with Action Bar and Control Bar */}
            <TitleBar
                title=""
                iconSrc={iconSrc}
                center={titleBarSearchVisible ? <TitleBarSearchBox /> : undefined}
                actionBar={
                    <div className="flex items-center gap-0.5">
                        <ProjectSwitcher />
                        <ActionBar hideAllGroups={isMac} />
                    </div>
                }
                controlBar={
                    <ControlBar
                        leftSidebarVisible={leftSidebarVisible}
                        rightSidebarVisible={rightSidebarVisible}
                        bottomPanelVisible={bottomPanelVisible}
                        onToggleLeftSidebar={toggleLeftSidebar}
                        onToggleRightSidebar={toggleRightSidebar}
                        onToggleBottomPanel={toggleBottomPanel}
                    />
                }
            />

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Sidebar Selector */}
                <LeftSidebarSelector
                    visible={leftSidebarVisible}
                    activeId={activeLeftPanelId}
                    onToggleVisibility={() => setLeftSidebarVisible(!leftSidebarVisible)}
                    onSelectPanel={setActiveLeftPanelId}
                />

                {/* Left Sidebar - Always rendered, controlled by CSS visibility */}
                <div 
                    className={leftSidebarVisible && activeLeftPanelId ? "flex" : "hidden"}
                >
                    <LeftSidebar
                        panelId={activeLeftPanelId || ""}
                        onClose={() => setLeftSidebarVisible(false)}
                        width={effective.left}
                    />
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handleLeftSidebarResize}
                        className="w-1 border-r border-edge hover:bg-primary/20"
                    />
                </div>

                {/* Center Area (min-w-0/min-h-0 so it can shrink below content in the flex chain) */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                    {/* Main Editor Area — its layout box may shrink to any size (even 0 when the
                        bottom panel covers it), but the editor CONTENT is floored at EDITOR_FLOOR
                        and cropped by overflow-hidden, so it is never rendered at a deformed size. */}
                    <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
                        <div
                            className="w-full h-full overflow-hidden"
                            style={{ minWidth: EDITOR_FLOOR.width, minHeight: EDITOR_FLOOR.height }}
                        >
                            <MainEditorArea />
                        </div>
                    </div>

                    {/* Bottom Panel - Always rendered, controlled by CSS visibility. shrink-0 keeps
                        its height so the editor above yields space instead of the panel collapsing. */}
                    <div
                        className={bottomPanelVisible && activeBottomPanelId ? "shrink-0 border-t border-edge" : "hidden"}
                        style={{ height: bottomPanelVisible && activeBottomPanelId ? `${effective.bottom}px` : 0 }}
                    >
                        <ResizableHandle
                            direction="vertical"
                            onResize={handleBottomPanelResize}
                            className="h-1 border-t border-edge hover:bg-primary/20"
                        />
                        <BottomPanel
                            panelId={activeBottomPanelId || ""}
                            onClose={() => setBottomPanelVisible(false)}
                            height={effective.bottom}
                        />
                    </div>
                </div>

                {/* Right Sidebar - Always rendered, controlled by CSS visibility */}
                <div 
                    className={rightSidebarVisible && activeRightPanelId ? "flex" : "hidden"}
                >
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handleRightSidebarResize}
                        className="w-1 border-l border-edge hover:bg-primary/20"
                    />
                    <RightSidebar
                        panelId={activeRightPanelId || ""}
                        onClose={() => setRightSidebarVisible(false)}
                        width={effective.right}
                    />
                </div>

                {/* Right Sidebar Selector */}
                <RightSidebarSelector
                    visible={rightSidebarVisible}
                    activeId={activeRightPanelId}
                    onToggleVisibility={() => setRightSidebarVisible(!rightSidebarVisible)}
                    onSelectPanel={setActiveRightPanelId}
                />
            </div>

            {/* Status Bar */}
            {statusBarVisible && <StatusBar />}

            {/* Bottom Panel Selector (overlays left selector, just above the status bar) */}
            <div className="absolute left-0" style={{ bottom: statusBarHeight }}>
                <BottomPanelSelector
                    visible={bottomPanelVisible}
                    activeId={activeBottomPanelId}
                    onToggleVisibility={() => setBottomPanelVisible(!bottomPanelVisible)}
                    onSelectPanel={setActiveBottomPanelId}
                    onActivatePanelForDrop={activateBottomPanelForDrop}
                />
            </div>

            {/* UI Overlays */}
            <BackgroundImageDialog />
            <WorkspaceEditorQuickSwitch />
            <CommandPalette />
            <QuickOpenPicker />
            <EditorCommands />
            <KeybindingCheatSheet />
            <EditorClosedTabsKeybinding />
            <NotificationContainer />
            <DialogContainer />
        </div>
    );
}
