import React from "react";
import { useRegistry } from "../../registry";
import { EditorGroup as EditorGroupType, EditorSplit } from "../../registry/types";
import { EditorGroup } from "./EditorGroup";
import { FileCode } from "lucide-react";

/**
 * Main editor area component
 * Renders editor groups with tab support and split view
 */
export function MainEditorArea() {
    const { editorLayout } = useRegistry();

    const renderLayout = (layout: EditorGroupType | EditorSplit): React.ReactNode => {
        // Single editor group
        if ("tabs" in layout) {
            return <EditorGroup group={layout} />;
        }

        // Split view
        const { direction, ratio, first, second } = layout;
        const isHorizontal = direction === "horizontal";
        const firstSize = `${ratio * 100}%`;
        const secondSize = `${(1 - ratio) * 100}%`;

        return (
            <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} h-full`}>
                <div style={{ [isHorizontal ? "width" : "height"]: firstSize }}>
                    {renderLayout(first)}
                </div>
                <div
                    className={`
                        ${isHorizontal ? "w-[2px]" : "h-[2px]"}
                        bg-white/10
                        hover:bg-blue-500/50
                        cursor-${isHorizontal ? "col" : "row"}-resize
                        transition-colors
                    `}
                />
                <div style={{ [isHorizontal ? "width" : "height"]: secondSize }}>
                    {renderLayout(second)}
                </div>
            </div>
        );
    };

    // Empty state when no tabs are open
    if ("tabs" in editorLayout && editorLayout.tabs.length === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5"></div>
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl"></div>

                <div className="text-center text-gray-500 relative z-10">
                    {/* Logo with enhanced styling */}
                    <div className="relative mb-8">
                        <img
                            src="/img/narraleaf-studio/logo-icon-white.png"
                            className="w-64 h-64 mx-auto opacity-5"
                            alt="NarraLeaf Studio Logo"
                        />
                        {/* Glow effect */}
                        {/* <div className="absolute inset-0 w-48 h-48 mx-auto bg-blue-400/10 rounded-full blur-xl"></div> */}
                    </div>

                    {/* Welcome text */}
                    <div className="space-y-4">
                        <h1 className="text-4xl font-light text-white/5">NarraLeaf Studio</h1>
                        {/* <p className="text-lg text-white/20 max-w-md mx-auto leading-relaxed">
                            Plan, Create, and Share
                        </p> */}
                    </div>
                </div>
            </div>
        );
    }

    return <div className="h-full bg-[#0f1115]">{renderLayout(editorLayout)}</div>;
}

