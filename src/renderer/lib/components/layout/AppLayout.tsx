import React from "react";
import { TitleBar } from "./TitleBar";

export interface AppLayoutProps {
    title: string;
    iconSrc: string;
    children: React.ReactNode;
    className?: string;
}

/**
 * Universal app layout component with title bar
 * Provides consistent structure across different applications
 * Does not include navigation - that's handled by NavigationLayout
 */
export function AppLayout({
    title,
    iconSrc,
    children,
    className = "",
}: AppLayoutProps) {
    return (
        <div className={`h-screen w-screen text-gray-200 bg-[#0f1115] ${className}`}>
            <div className="grid grid-rows-[40px,1fr] h-full">
                {/* Title Bar */}
                <div className="col-span-full">
                    <TitleBar title={title} iconSrc={iconSrc} />
                </div>

                {/* Main Content */}
                <main className="overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
