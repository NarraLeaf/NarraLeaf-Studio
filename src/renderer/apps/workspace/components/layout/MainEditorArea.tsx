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
            <div className="h-full flex items-center justify-center bg-[#0f1115]">
                <div className="text-center text-gray-500">
                    <FileCode className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">No editor open</p>
                    <p className="text-sm mt-2">Open a file from the sidebar to start editing</p>
                </div>
            </div>
        );
    }

    return <div className="h-full bg-[#0f1115]">{renderLayout(editorLayout)}</div>;
}

