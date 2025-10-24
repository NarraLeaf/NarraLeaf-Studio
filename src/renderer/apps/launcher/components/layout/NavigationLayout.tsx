import React from "react";
import { TitleBar } from "@/lib/components/layout";

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
    return (
        <div className={`h-screen w-screen text-gray-200 bg-[#0f1115] ${className}`}>
            <div
                className="grid h-full"
                style={{
                    gridTemplateColumns: `${navigationWidth} 1fr`,
                    gridTemplateRows: "1fr",
                }}
            >
                {/* Navigation Sidebar - spans full height */}
                <aside className="border-r border-white/10 bg-white/5 overflow-y-auto">
                    {navigation}
                </aside>

                {/* Right Panel */}
                <div className="flex flex-col">
                    {/* Title Bar - only on right side */}
                    <div className="flex-shrink-0">
                        <TitleBar title={title} iconSrc={iconSrc} />
                    </div>

                    {/* Main Content */}
                    <main className="flex-1 overflow-auto">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
}
