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
                    gridTemplateRows: "40px 1fr",
                }}
            >
                {/* Title Bar - spans full width */}
                <div className="col-[1_/_span_2]">
                    <TitleBar title={title} iconSrc={iconSrc} />
                </div>

                {/* Navigation Sidebar */}
                <aside className="border-r border-white/10 bg-white/5 overflow-y-auto">
                    {navigation}
                </aside>

                {/* Main Content */}
                <main className="overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
