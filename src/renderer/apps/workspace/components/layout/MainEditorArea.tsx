import React from "react";
import { useRegistry } from "../../registry";
import { EditorGroup as EditorGroupType, EditorSplit } from "../../registry/types";
import { EditorGroup } from "./EditorGroup";
import { MainEditorEmptyDropZone } from "./MainEditorEmptyDropZone";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";
import { useTranslation } from "@/lib/i18n";

/**
 * Main editor area component
 * Renders editor groups with tab support and split view
 */
export function MainEditorArea() {
    const { t } = useTranslation();
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
                        bg-fill
                        hover:bg-primary/50
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
            <WorkspacePanelErrorBoundary regionLabel={t("workspace.shell.mainEditorRegion")} isolationKey="main-editor-empty">
                <MainEditorEmptyDropZone groupId={editorLayout.id} />
            </WorkspacePanelErrorBoundary>
        );
    }

    return (
        <WorkspacePanelErrorBoundary regionLabel={t("workspace.shell.mainEditorRegion")} isolationKey="main-editor-layout">
            <div className="h-full bg-surface">{renderLayout(editorLayout)}</div>
        </WorkspacePanelErrorBoundary>
    );
}

