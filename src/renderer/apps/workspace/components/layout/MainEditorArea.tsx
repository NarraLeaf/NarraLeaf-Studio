import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRegistry } from "../../registry";
import { useWorkspace } from "../../context";
import { EditorGroup as EditorGroupType, EditorSplit } from "../../registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { EditorGroup } from "./EditorGroup";
import { MainEditorEmptyDropZone } from "./MainEditorEmptyDropZone";
import { WorkspacePanelErrorBoundary } from "../WorkspacePanelErrorBoundary";
import {
    EDITOR_DEFAULT_SPLIT_RATIO,
    EDITOR_SASH_SIZE,
    leadingPaneBasis,
    nudgeSplitRatio,
    resolveSplitRatio,
} from "./editorSplitResize";
import { useTranslation } from "@/lib/i18n";

/** px a single arrow key press moves a focused sash. */
const KEYBOARD_STEP_PX = 24;

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

    const containerSize = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return 0;
        }
        return isHorizontal ? rect.width : rect.height;
    }, [isHorizontal]);

    const commitRatio = useCallback(
        (next: number) => {
            if (!context) {
                return;
            }
            context.services.get<UIService>(Services.UI).getStore().setEditorSplitRatio(split.id, next);
        },
        [context, split.id],
    );

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const sash = e.currentTarget;
            sash.setPointerCapture(e.pointerId);

            // The pointer keeps its grab offset within the sash, so the gutter tracks the cursor
            // instead of jumping to centre itself under it on the first move.
            const sashRect = sash.getBoundingClientRect();
            const grabOffset = isHorizontal
                ? e.clientX - (sashRect.left + sashRect.width / 2)
                : e.clientY - (sashRect.top + sashRect.height / 2);

            // A drag that leaves the sash would otherwise select text and flip the cursor over
            // whatever it passes; both are pinned for the duration.
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
            document.body.style.userSelect = "none";

            let latest = ratio;

            const onMove = (moveEvent: PointerEvent) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) {
                    return;
                }
                const size = isHorizontal ? rect.width : rect.height;
                const offset = isHorizontal
                    ? moveEvent.clientX - rect.left - grabOffset
                    : moveEvent.clientY - rect.top - grabOffset;
                latest = resolveSplitRatio(size, offset);
                setDragRatio(latest);
            };

            const onUp = () => {
                sash.removeEventListener("pointermove", onMove);
                sash.removeEventListener("pointerup", onUp);
                sash.removeEventListener("pointercancel", onUp);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                setDragRatio(null);
                commitRatio(latest);
            };

            sash.addEventListener("pointermove", onMove);
            sash.addEventListener("pointerup", onUp);
            sash.addEventListener("pointercancel", onUp);
        },
        [commitRatio, isHorizontal, ratio],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const decrease = isHorizontal ? "ArrowLeft" : "ArrowUp";
            const increase = isHorizontal ? "ArrowRight" : "ArrowDown";
            if (e.key !== decrease && e.key !== increase) {
                return;
            }
            e.preventDefault();
            const delta = e.key === increase ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
            commitRatio(nudgeSplitRatio(split.ratio, containerSize(), delta));
        },
        [commitRatio, containerSize, isHorizontal, split.ratio],
    );

    return (
        <div ref={containerRef} className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
            <div className="min-w-0 min-h-0" style={{ flex: `0 0 ${leadingPaneBasis(ratio)}` }}>
                {first}
            </div>
            <div
                role="separator"
                tabIndex={0}
                aria-orientation={isHorizontal ? "vertical" : "horizontal"}
                aria-valuenow={Math.round(ratio * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("workspace.shell.resizeSplit")}
                onPointerDown={handlePointerDown}
                onDoubleClick={() => commitRatio(EDITOR_DEFAULT_SPLIT_RATIO)}
                onKeyDown={handleKeyDown}
                style={{ flex: `0 0 ${EDITOR_SASH_SIZE}px` }}
                className={`
                    relative z-10 bg-edge outline-none group/sash
                    ${isHorizontal ? "cursor-col-resize" : "cursor-row-resize"}
                `}
            >
                {/*
                  * The grab area reaches past the 4px gutter into both panes, so the sash is easy to
                  * hit without widening the line the user sees. The highlight is on this element
                  * rather than the gutter so it lights up the moment the pointer is close enough to
                  * actually grab.
                  */}
                <span
                    className={`
                        absolute transition-colors duration-100
                        ${isHorizontal ? "-left-1 -right-1 inset-y-0" : "-top-1 -bottom-1 inset-x-0"}
                        ${dragRatio !== null ? "bg-primary" : "hover:bg-primary/50 group-focus/sash:bg-primary/50"}
                    `}
                    aria-hidden
                />
            </div>
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
