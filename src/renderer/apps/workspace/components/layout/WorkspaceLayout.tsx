import React, { useState } from "react";
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

interface WorkspaceLayoutProps {
    title: string;
    iconSrc: string;
}

/**
 * Main workspace layout container
 * Provides VSCode/IDEA-like layout with:
 * - Left sidebar with selector
 * - Right sidebar with selector
 * - Bottom panel with selector
 * - Main editor area with tabs and split support
 * - Action bar (top-left)
 * - Control bar (top-right)
 */
export function WorkspaceLayout({ title, iconSrc }: WorkspaceLayoutProps) {
    // Sidebar visibility states
    const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
    const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
    const [bottomPanelVisible, setBottomPanelVisible] = useState(false);

    // Active panel IDs
    const [activeLeftPanelId, setActiveLeftPanelId] = useState<string | null>(null);
    const [activeRightPanelId, setActiveRightPanelId] = useState<string | null>(null);
    const [activeBottomPanelId, setActiveBottomPanelId] = useState<string | null>(null);

    return (
        <div className="h-screen w-screen flex flex-col bg-[#0f1115] text-gray-200">
            {/* Title Bar */}
            <TitleBar title={title} iconSrc={iconSrc} />

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
                    <LeftSidebar panelId={activeLeftPanelId} onClose={() => setLeftSidebarVisible(false)} />
                )}

                {/* Center Area */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Top Bar */}
                    <div className="h-12 flex items-center justify-between bg-[#0b0d12] border-b border-white/10 px-2">
                        {/* Action Bar (Left) */}
                        <ActionBar />

                        {/* Control Bar (Right) */}
                        <ControlBar
                            leftSidebarVisible={leftSidebarVisible}
                            rightSidebarVisible={rightSidebarVisible}
                            bottomPanelVisible={bottomPanelVisible}
                            onToggleLeftSidebar={() => setLeftSidebarVisible(!leftSidebarVisible)}
                            onToggleRightSidebar={() => setRightSidebarVisible(!rightSidebarVisible)}
                            onToggleBottomPanel={() => setBottomPanelVisible(!bottomPanelVisible)}
                        />
                    </div>

                    {/* Main Editor and Bottom Panel */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Main Editor Area */}
                        <div className={`${bottomPanelVisible ? "flex-1" : "flex-1"} overflow-hidden`}>
                            <MainEditorArea />
                        </div>

                        {/* Bottom Panel */}
                        {bottomPanelVisible && activeBottomPanelId && (
                            <div className="h-64 border-t border-white/10">
                                <BottomPanel
                                    panelId={activeBottomPanelId}
                                    onClose={() => setBottomPanelVisible(false)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar */}
                {rightSidebarVisible && activeRightPanelId && (
                    <RightSidebar panelId={activeRightPanelId} onClose={() => setRightSidebarVisible(false)} />
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
        </div>
    );
}

