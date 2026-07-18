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
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
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

    // Live viewport dimensions; drives the derived effective sizes so the layout reflows with the window.
    const [viewport, setViewport] = useState(() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 1280,
        height: typeof window !== "undefined" ? window.innerHeight : 800,
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
            setViewport({ width: window.innerWidth, height: window.innerHeight });
        };
        handleWindowResize();
        window.addEventListener("resize", handleWindowResize);
        return () => {
            window.removeEventListener("resize", handleWindowResize);
        };
    }, []);

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

    // Enhanced toggle functions that auto-select first panel if none is active
    const toggleLeftSidebar = () => {
        if (!leftSidebarVisible && !activeLeftPanelId) {
            // Rail actions occupy a rail slot but have no panel body, so selecting one would open
            // the sidebar onto nothing.
            const firstPanel = getPanelsByPosition(PanelPosition.Left).find(panel => !panel.railAction);
            if (firstPanel) {
                setActiveLeftPanelId(firstPanel.id);
            }
        }
        setLeftSidebarVisible(!leftSidebarVisible);
    };

    const toggleRightSidebar = () => {
        if (!rightSidebarVisible && !activeRightPanelId) {
            const rightPanels = getPanelsByPosition(PanelPosition.Right);
            if (rightPanels.length > 0) {
                setActiveRightPanelId(rightPanels[0].id);
            }
        }
        setRightSidebarVisible(!rightSidebarVisible);
    };

    const toggleBottomPanel = () => {
        if (!bottomPanelVisible && !activeBottomPanelId) {
            const bottomPanels = getPanelsByPosition(PanelPosition.Bottom);
            if (bottomPanels.length > 0) {
                setActiveBottomPanelId(bottomPanels[0].id);
            }
        }
        setBottomPanelVisible(!bottomPanelVisible);
    };

    // The toggles close over render-scoped state, so the menu calls them through refs rather
    // than re-registering the group on every render.
    const panelTogglesRef = useRef({ toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar });
    panelTogglesRef.current = { toggleLeftSidebar, toggleBottomPanel, toggleRightSidebar };

    // Publish the dock toggles to the macOS Window menu. Registered only on macOS: elsewhere the
    // ControlBar buttons are the only entry point and this group would just clutter the in-app
    // action bar.
    useEffect(() => {
        if (!isMacPlatform()) {
            return;
        }

        registerActionGroup({
            id: PANEL_TOGGLES_GROUP_ID,
            label: t("menu.window.title"),
            menuSlot: "window",
            items: [
                {
                    id: WorkspaceMenuAction.ToggleLeftSidebar,
                    label: t("menu.window.leftSidebar"),
                    checked: leftSidebarVisible,
                    onClick: () => panelTogglesRef.current.toggleLeftSidebar(),
                    order: 0,
                },
                {
                    id: WorkspaceMenuAction.ToggleBottomPanel,
                    label: t("menu.window.bottomPanel"),
                    checked: bottomPanelVisible,
                    onClick: () => panelTogglesRef.current.toggleBottomPanel(),
                    order: 1,
                },
                {
                    id: WorkspaceMenuAction.ToggleRightSidebar,
                    label: t("menu.window.rightSidebar"),
                    checked: rightSidebarVisible,
                    onClick: () => panelTogglesRef.current.toggleRightSidebar(),
                    order: 2,
                },
            ],
        });

        return () => {
            unregisterActionGroup(PANEL_TOGGLES_GROUP_ID);
        };
    }, [t, leftSidebarVisible, bottomPanelVisible, rightSidebarVisible, registerActionGroup, unregisterActionGroup]);

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

        const previousPanelId = (panels: PanelDefinition[], panelId: string) => {
            const currentIndex = panels.findIndex(panel => panel.id === panelId);
            if (currentIndex > 0) {
                return panels[currentIndex - 1].id;
            }
            return panels.find(panel => panel.id !== panelId)?.id ?? null;
        };

        const showPanel = (panel: PanelDefinition) => {
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
            const panels = panelsByPosition(panel.position);
            const fallbackId = previousPanelId(panels, panel.id);
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

    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            {/* Title Bar with Action Bar and Control Bar */}
            <TitleBar
                title=""
                iconSrc={iconSrc}
                center={<TitleBarSearchBox />}
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

            {/* Bottom Panel Selector (overlays left selector at bottom) */}
            <div className="absolute left-0 bottom-0">
                <BottomPanelSelector
                    visible={bottomPanelVisible}
                    activeId={activeBottomPanelId}
                    onToggleVisibility={() => setBottomPanelVisible(!bottomPanelVisible)}
                    onSelectPanel={setActiveBottomPanelId}
                    onActivatePanelForDrop={activateBottomPanelForDrop}
                />
            </div>

            {/* UI Overlays */}
            <WorkspaceEditorQuickSwitch />
            <CommandPalette />
            <EditorCommands />
            <KeybindingCheatSheet />
            <EditorClosedTabsKeybinding />
            <NotificationContainer />
            <DialogContainer />
        </div>
    );
}
