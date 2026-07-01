import React from "react";
import { isMacPlatform } from "@/lib/app/platform";
import { TitleBar } from "@/lib/components/layout";
import { WindowControlPolicy } from "@shared/types/window";

export interface NavigationLayoutProps {
    title: string;
    iconSrc: string;
    navigation: React.ReactNode;
    children: React.ReactNode;
    navigationWidth?: string;
    className?: string;
}

/**
 * Launcher-specific layout with navigation sidebar
 * Private component for launcher app only
 */
export function NavigationLayout({
    title,
    iconSrc,
    navigation,
    children,
    navigationWidth = "240px",
    className = "",
}: NavigationLayoutProps) {
    const isMac = isMacPlatform();
    const windowControlPolicy = WindowControlPolicy.MacNativeOutsideTitleBar;

    return (
        <div className={`fixed inset-0 h-[100vh] w-[100vw] overflow-hidden text-gray-200 bg-[#0f1115] ${className}`}>
            <div
                className="grid h-full min-h-0 min-w-0 overflow-hidden"
                style={{
                    gridTemplateColumns: `${navigationWidth} 1fr`,
                    gridTemplateRows: "1fr",
                }}
            >
                {/* Navigation Sidebar - spans full height */}
                <aside className="flex min-h-0 flex-col border-r border-white/10 bg-white/5 overflow-hidden">
                    {isMac && windowControlPolicy === WindowControlPolicy.MacNativeOutsideTitleBar && (
                        <div className="titlebar-drag h-10 min-h-10 shrink-0 border-b border-white/5" />
                    )}
                    <div className="min-h-0 flex-1 overflow-hidden">
                        {navigation}
                    </div>
                </aside>

                {/* Right Panel */}
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                    {/* Title Bar - only on right side */}
                    <div className="flex-shrink-0">
                        <TitleBar title={title} iconSrc={iconSrc} windowControlPolicy={windowControlPolicy} />
                    </div>

                    {/* Main Content */}
                    <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
}
