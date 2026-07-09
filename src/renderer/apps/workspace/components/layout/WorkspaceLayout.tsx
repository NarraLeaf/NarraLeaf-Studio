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
import { ControlBar } from "./ControlBar";
import { NotificationContainer } from "../ui/NotificationContainer";
import { DialogContainer } from "../ui/DialogContainer";
import { ResizableHandle } from "../ui/ResizableHandle";
import { WorkspaceEditorQuickSwitch } from "./WorkspaceEditorQuickSwitch";
import { useRegistry } from "../../registry";
import { PanelPosition, type PanelDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isMacPlatform } from "@/lib/app/platform";

interface WorkspaceLayoutProps {
    title: string;
    iconSrc: string;
}

const MACOS_NATIVE_MENU_GROUP_IDS = ["narraleaf-studio:file", "narraleaf-studio:help"];

// Default sizes (in pixels)
const DEFAULT_LEFT_SIDEBAR_WIDTH = 320;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 256;

// Min/Max constraints (in pixels)
const MIN_SIDEBAR_WIDTH = 300;
const MAX_SIDEBAR_WIDTH = 800;
const MIN_BOTTOM_PANEL_HEIGHT = 150;
const MAX_BOTTOM_PANEL_HEIGHT = 600;

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
    const { getPanelsByPosition } = useRegistry();
    const { context } = useWorkspace();

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

    // Sidebar sizes
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT);

    // Use refs to track current sizes synchronously (avoid async state update issues during fast dragging)
    const leftSidebarWidthRef = useRef(DEFAULT_LEFT_SIDEBAR_WIDTH);
    const rightSidebarWidthRef = useRef(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    const bottomPanelHeightRef = useRef(DEFAULT_BOTTOM_PANEL_HEIGHT);
    const activeLeftPanelIdRef = useRef<string | null>(null);
    const activeRightPanelIdRef = useRef<string | null>(null);
    const activeBottomPanelIdRef = useRef<string | null>(null);

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

    // Handle window resize to ensure panels don't exceed available space
    useEffect(() => {
        const handleWindowResize = () => {
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            // Reserve some space for minimum editor area (at least 400px)
            const minEditorWidth = 400;
            const titleBarHeight = 40; // Approximate title bar height

            // Calculate available space for sidebars
            const availableWidth = Math.max(0, windowWidth - minEditorWidth);
            const maxSidebarWidth = Math.floor(availableWidth / 2); // Split equally between left and right

            // Calculate available height for bottom panel
            const availableHeight = Math.max(0, windowHeight - titleBarHeight - 100); // Reserve space for content
            const maxPanelHeight = Math.min(MAX_BOTTOM_PANEL_HEIGHT, availableHeight);

            // Adjust sidebar widths if they exceed available space
            if (leftSidebarVisible && leftSidebarWidthRef.current > maxSidebarWidth) {
                leftSidebarWidthRef.current = maxSidebarWidth;
                setLeftSidebarWidth(maxSidebarWidth);
            }
            if (rightSidebarVisible && rightSidebarWidthRef.current > maxSidebarWidth) {
                rightSidebarWidthRef.current = maxSidebarWidth;
                setRightSidebarWidth(maxSidebarWidth);
            }

            // Adjust bottom panel height if it exceeds available space
            if (bottomPanelVisible && bottomPanelHeightRef.current > maxPanelHeight) {
                bottomPanelHeightRef.current = maxPanelHeight;
                setBottomPanelHeight(maxPanelHeight);
            }
        };

        // Initial check
        handleWindowResize();

        // Listen for window resize
        window.addEventListener('resize', handleWindowResize);

        return () => {
            window.removeEventListener('resize', handleWindowResize);
        };
    }, [leftSidebarVisible, leftSidebarWidth, rightSidebarVisible, rightSidebarWidth, bottomPanelVisible, bottomPanelHeight]);

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

    // Resize handlers
    // Use refs for synchronous updates to avoid issues with fast mouse movements
    const handleLeftSidebarResize = useCallback((delta: number) => {
        // Calculate dynamic max width based on current window size
        const minEditorWidth = 400;
        const availableWidth = Math.max(0, window.innerWidth - minEditorWidth);
        const dynamicMaxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(availableWidth / 2));

        const currentWidth = leftSidebarWidthRef.current;
        const newWidth = Math.min(dynamicMaxWidth, Math.max(MIN_SIDEBAR_WIDTH, currentWidth + delta));
        const actualDelta = newWidth - currentWidth;

        // Update ref immediately (synchronous)
        leftSidebarWidthRef.current = newWidth;
        // Update state (asynchronous, for rendering)
        setLeftSidebarWidth(newWidth);

        // Result = actualDelta - delta, so startPosRef only advances by actualDelta
        return actualDelta - delta;
    }, []);

    const handleRightSidebarResize = useCallback((delta: number) => {
        const minEditorWidth = 400;
        const availableWidth = Math.max(0, window.innerWidth - minEditorWidth);
        const dynamicMaxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(availableWidth / 2));

        const currentWidth = rightSidebarWidthRef.current;
        const newWidth = Math.min(dynamicMaxWidth, Math.max(MIN_SIDEBAR_WIDTH, currentWidth - delta));
        const actualDelta = newWidth - currentWidth;

        rightSidebarWidthRef.current = newWidth;
        setRightSidebarWidth(newWidth);

        return -actualDelta - delta;
    }, []);

    const handleBottomPanelResize = useCallback((delta: number) => {
        const minEditorHeight = 200;
        const availableHeight = Math.max(0, window.innerHeight - minEditorHeight);
        const dynamicMaxHeight = Math.min(MAX_BOTTOM_PANEL_HEIGHT, Math.floor(availableHeight / 2));

        const currentHeight = bottomPanelHeightRef.current;
        const newHeight = Math.min(dynamicMaxHeight, Math.max(MIN_BOTTOM_PANEL_HEIGHT, currentHeight - delta));
        const actualDelta = newHeight - currentHeight;

        bottomPanelHeightRef.current = newHeight;
        setBottomPanelHeight(newHeight);
        
        return -actualDelta - delta;
    }, []);

    // Enhanced toggle functions that auto-select first panel if none is active
    const toggleLeftSidebar = () => {
        if (!leftSidebarVisible && !activeLeftPanelId) {
            const leftPanels = getPanelsByPosition(PanelPosition.Left);
            if (leftPanels.length > 0) {
                setActiveLeftPanelId(leftPanels[0].id);
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
    const hiddenActionGroupIds = isMac ? MACOS_NATIVE_MENU_GROUP_IDS : undefined;

    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            {/* Title Bar with Action Bar and Control Bar */}
            <TitleBar
                title=""
                iconSrc={iconSrc}
                actionBar={<ActionBar hiddenGroupIds={hiddenActionGroupIds} />}
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
                        width={leftSidebarWidth}
                    />
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handleLeftSidebarResize}
                        className="w-1 border-r border-edge hover:bg-primary/20"
                    />
                </div>

                {/* Center Area */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Main Editor and Bottom Panel */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Main Editor Area */}
                        <div className="flex-1 overflow-hidden">
                            <MainEditorArea />
                        </div>

                        {/* Bottom Panel - Always rendered, controlled by CSS visibility */}
                        <div 
                            className={bottomPanelVisible && activeBottomPanelId ? "border-t border-edge" : "hidden"}
                            style={{ height: bottomPanelVisible && activeBottomPanelId ? `${bottomPanelHeight}px` : 0 }}
                        >
                            <ResizableHandle
                                direction="vertical"
                                onResize={handleBottomPanelResize}
                                className="h-1 border-t border-edge hover:bg-primary/20"
                            />
                            <BottomPanel
                                panelId={activeBottomPanelId || ""}
                                onClose={() => setBottomPanelVisible(false)}
                                height={bottomPanelHeight}
                            />
                        </div>
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
                        width={rightSidebarWidth}
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
            <NotificationContainer />
            <DialogContainer />
        </div>
    );
}
