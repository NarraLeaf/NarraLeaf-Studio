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
import { useRegistry } from "../../registry";
import { PanelPosition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { ProjectSettingsService } from "@/lib/workspace/services/ProjectSettingsService";

interface WorkspaceLayoutProps {
    title: string;
    iconSrc: string;
}

// Default sizes (in pixels)
const DEFAULT_LEFT_SIDEBAR_WIDTH = 320;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 256;

// Min/Max constraints (in pixels)
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const MIN_BOTTOM_PANEL_HEIGHT = 150;
const MAX_BOTTOM_PANEL_HEIGHT = 600;

// Settings keys for persistence
const SETTINGS_KEYS = {
    LEFT_SIDEBAR_VISIBLE: "ui.leftSidebar.visible",
    LEFT_SIDEBAR_WIDTH: "ui.leftSidebar.width",
    LEFT_SIDEBAR_ACTIVE_PANEL: "ui.leftSidebar.activePanel",
    RIGHT_SIDEBAR_VISIBLE: "ui.rightSidebar.visible",
    RIGHT_SIDEBAR_WIDTH: "ui.rightSidebar.width",
    RIGHT_SIDEBAR_ACTIVE_PANEL: "ui.rightSidebar.activePanel",
    BOTTOM_PANEL_VISIBLE: "ui.bottomPanel.visible",
    BOTTOM_PANEL_HEIGHT: "ui.bottomPanel.height",
    BOTTOM_PANEL_ACTIVE_PANEL: "ui.bottomPanel.activePanel",
};

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

    // Sidebar sizes
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT);

    // Settings service
    const settingsService = context?.services.get<ProjectSettingsService>(Services.ProjectSettings);

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
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_VISIBLE]: rightSidebarVisible,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_WIDTH]: rightSidebarWidth,
                    [SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL]: activeRightPanelId,
                    [SETTINGS_KEYS.BOTTOM_PANEL_VISIBLE]: bottomPanelVisible,
                    [SETTINGS_KEYS.BOTTOM_PANEL_HEIGHT]: bottomPanelHeight,
                    [SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL]: activeBottomPanelId,
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
    ]);

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
                const leftPanel = await settingsService.get<string | null>(SETTINGS_KEYS.LEFT_SIDEBAR_ACTIVE_PANEL);
                const rightPanel = await settingsService.get<string | null>(SETTINGS_KEYS.RIGHT_SIDEBAR_ACTIVE_PANEL);
                const bottomPanel = await settingsService.get<string | null>(SETTINGS_KEYS.BOTTOM_PANEL_ACTIVE_PANEL);

                // Only update if values exist in settings
                if (leftVisible !== undefined) setLeftSidebarVisible(leftVisible);
                if (rightVisible !== undefined) setRightSidebarVisible(rightVisible);
                if (bottomVisible !== undefined) setBottomPanelVisible(bottomVisible);
                if (leftWidth !== undefined) setLeftSidebarWidth(leftWidth);
                if (rightWidth !== undefined) setRightSidebarWidth(rightWidth);
                if (bottomHeight !== undefined) setBottomPanelHeight(bottomHeight);
                if (leftPanel !== undefined) setActiveLeftPanelId(leftPanel);
                if (rightPanel !== undefined) setActiveRightPanelId(rightPanel);
                if (bottomPanel !== undefined) setActiveBottomPanelId(bottomPanel);

                setSettingsLoaded(true);
                console.log("[WorkspaceLayout] Settings loaded successfully");
            } catch (error) {
                console.error("Failed to load workspace layout settings:", error);
                setSettingsLoaded(true); // Mark as loaded even on error to allow saving
            }
        };

        loadSettings();
    }, [settingsService]);

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
            if (leftSidebarVisible && leftSidebarWidth > maxSidebarWidth) {
                setLeftSidebarWidth(maxSidebarWidth);
            }
            if (rightSidebarVisible && rightSidebarWidth > maxSidebarWidth) {
                setRightSidebarWidth(maxSidebarWidth);
            }

            // Adjust bottom panel height if it exceeds available space
            if (bottomPanelVisible && bottomPanelHeight > maxPanelHeight) {
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
    const handleLeftSidebarResize = useCallback((delta: number) => {
        // Calculate dynamic max width based on window size
        const minEditorWidth = 400;
        const availableWidth = Math.max(0, window.innerWidth - minEditorWidth);
        const dynamicMaxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(availableWidth / 2));

        const newWidth = Math.min(dynamicMaxWidth, Math.max(MIN_SIDEBAR_WIDTH, leftSidebarWidth + delta));
        const didResize = newWidth !== leftSidebarWidth;
        setLeftSidebarWidth(newWidth);
        return didResize;
    }, [leftSidebarWidth]);

    const handleRightSidebarResize = useCallback((delta: number) => {
        // Calculate dynamic max width based on window size
        const minEditorWidth = 400;
        const availableWidth = Math.max(0, window.innerWidth - minEditorWidth);
        const dynamicMaxWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(availableWidth / 2));

        const newWidth = Math.min(dynamicMaxWidth, Math.max(MIN_SIDEBAR_WIDTH, rightSidebarWidth - delta));
        const didResize = newWidth !== rightSidebarWidth;
        setRightSidebarWidth(newWidth);
        return didResize;
    }, [rightSidebarWidth]);

    const handleBottomPanelResize = useCallback((delta: number) => {
        // Calculate dynamic max height based on window size
        const titleBarHeight = 40;
        const availableHeight = Math.max(0, window.innerHeight - titleBarHeight - 100);
        const dynamicMaxHeight = Math.min(MAX_BOTTOM_PANEL_HEIGHT, availableHeight);

        const newHeight = Math.min(dynamicMaxHeight, Math.max(MIN_BOTTOM_PANEL_HEIGHT, bottomPanelHeight - delta));
        const didResize = newHeight !== bottomPanelHeight;
        setBottomPanelHeight(newHeight);
        return didResize;
    }, [bottomPanelHeight]);

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

    return (
        <div className="h-screen w-screen flex flex-col bg-[#0f1115] text-gray-200">
            {/* Title Bar with Action Bar and Control Bar */}
            <TitleBar
                title=""
                iconSrc={iconSrc}
                actionBar={<ActionBar />}
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

                {/* Left Sidebar */}
                {leftSidebarVisible && activeLeftPanelId && (
                    <>
                        <LeftSidebar 
                            panelId={activeLeftPanelId} 
                            onClose={() => setLeftSidebarVisible(false)}
                            width={leftSidebarWidth}
                        />
                        <ResizableHandle
                            direction="horizontal"
                            onResize={handleLeftSidebarResize}
                            className="w-1 border-r border-white/10 hover:bg-blue-500/20"
                        />
                    </>
                )}

                {/* Center Area */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Main Editor and Bottom Panel */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Main Editor Area */}
                        <div className={`${bottomPanelVisible ? "flex-1" : "flex-1"} overflow-hidden`}>
                            <MainEditorArea />
                        </div>

                        {/* Bottom Panel */}
                        {bottomPanelVisible && activeBottomPanelId && (
                            <div 
                                className="border-t border-white/10"
                                style={{ height: `${bottomPanelHeight}px` }}
                            >
                                <ResizableHandle
                                    direction="vertical"
                                    onResize={handleBottomPanelResize}
                                    className="h-1 border-t border-white/10 hover:bg-blue-500/20"
                                />
                                <BottomPanel
                                    panelId={activeBottomPanelId}
                                    onClose={() => setBottomPanelVisible(false)}
                                    height={bottomPanelHeight}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar */}
                {rightSidebarVisible && activeRightPanelId && (
                    <>
                        <ResizableHandle
                            direction="horizontal"
                            onResize={handleRightSidebarResize}
                            className="w-1 border-l border-white/10 hover:bg-blue-500/20"
                        />
                        <RightSidebar 
                            panelId={activeRightPanelId} 
                            onClose={() => setRightSidebarVisible(false)}
                            width={rightSidebarWidth}
                        />
                    </>
                )}

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
                />
            </div>

            {/* UI Overlays */}
            <NotificationContainer />
            <DialogContainer />
        </div>
    );
}

