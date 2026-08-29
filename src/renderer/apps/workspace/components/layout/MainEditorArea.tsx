import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType, EditorSplit } from "../../registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { EditorGroup } from "./EditorGroup";
import { MainEditorEmptyDropZone } from "./MainEditorEmptyDropZone";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";
import { leadingPaneBasis } from "./editorSplitResize";
import { SplitSash } from "./SplitSash";
import { usePreviewTabPromotion } from "../../hooks/usePreviewTabPromotion";
import { useTranslation } from "@/lib/i18n";

function renderLayout(layout: EditorGroupType | EditorSplit): React.ReactNode {
    if ("tabs" in layout) {
        return <EditorGroup group={layout} />;
    }
    return <EditorSplitNode split={layout} />;
}

/**
 * One split node: two panes and the sash between them.
 *
 * The drag runs on local state and only commits to the store on release. Writing every pointermove
 * into the layout would push a new tree through the whole editor subtree — and through the session
 * save debounce — dozens of times a second, for frames the user never settles on.
 */
function EditorSplitNode({ split }: { split: EditorSplit }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [dragRatio, setDragRatio] = useState<number | null>(null);

    const isHorizontal = split.direction === "horizontal";
    const ratio = dragRatio ?? split.ratio;

    // Children are memoised on node identity so a drag — which re-renders this component on every
    // pointermove — reconciles the same elements instead of rebuilding both editor subtrees.
    const first = useMemo(() => renderLayout(split.first), [split.first]);
    const second = useMemo(() => renderLayout(split.second), [split.second]);

    const commitRatio = useCallback(
        (next: number) => {
            setDragRatio(null);
            if (!context) {
                return;
            }
            context.services.get<UIService>(Services.UI).getStore().setEditorSplitRatio(split.id, next);
        },
        [context, split.id],
    );

    return (
        <div ref={containerRef} className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
            <div className="min-w-0 min-h-0" style={{ flex: `0 0 ${leadingPaneBasis(ratio)}` }}>
                {first}
            </div>
            <SplitSash
                orientation={split.direction}
                ratio={ratio}
                containerRef={containerRef}
                onPreview={setDragRatio}
                onCommit={commitRatio}
                dragging={dragRatio !== null}
                label={t("workspace.shell.resizeSplit")}
            />
            <div className="min-w-0 min-h-0" style={{ flex: "1 1 0%" }}>
                {second}
            </div>
        </div>
    );
}

/**
 * Main editor area component
 * Renders editor groups with tab support and split view
 */
export function MainEditorArea() {
    const { t } = useTranslation();
    const { editorLayout } = useRegistry();
    // Mounted once for the whole editor area, because it watches the workspace's undo stacks rather
    // than any one pane: an edit anywhere promotes the preview tab it was made in.
    usePreviewTabPromotion();

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
