import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { SceneFlowCanvas } from "./SceneFlowCanvas";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import type { SceneFlowTabPayload, SceneFlowViewport } from "./sceneFlowTabId";

/**
 * Read-only map of a story's scenes and the jumps between them. Double-clicking a scene opens its
 * editor, so this is a navigation surface as much as a diagnostic one - nothing here writes to the
 * story. Layout and viewport are the only things the author can move, and both live on the tab
 * payload rather than in the document.
 */
export function SceneFlowTab({ tabId, payload }: EditorTabComponentProps<SceneFlowTabPayload | undefined>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const storyId = payload?.storyId;

    const storyService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<StoryService>(Services.Story);
    }, [context, isInitialized]);

    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!storyService || !storyId) {
            return undefined;
        }
        let cancelled = false;
        storyService
            .loadStory(storyId)
            .then(loaded => {
                if (!cancelled) {
                    setDocument(loaded);
                    setError(null);
                }
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            });
        // Edits anywhere in the story (a new jump, a renamed scene) reshape the map. The service
        // mutates its cached document in place and emits that same reference, so this has to clone:
        // handing the identical object back to `setDocument` is a no-op bail-out.
        const dispose = storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                setDocument({ ...event.document });
            }
        });
        return () => {
            cancelled = true;
            dispose();
        };
    }, [storyId, storyService]);

    const graph = useMemo(() => (document ? buildSceneFlowGraph(document) : null), [document]);

    // Layout tweaks and the viewport ride on the tab payload, so they survive a restart without
    // touching the story document.
    const [positions, setPositions] = useState<Record<StorySceneId, { x: number; y: number }>>(
        () => payload?.positions ?? {},
    );
    const initialViewportRef = useRef<SceneFlowViewport | undefined>(payload?.viewport);
    const viewportRef = useRef<SceneFlowViewport | undefined>(payload?.viewport);

    const persist = useCallback((next: Partial<SceneFlowTabPayload>) => {
        if (!context || !storyId) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().updateEditorTabPayload<SceneFlowTabPayload>(tabId, {
            storyId,
            positions,
            viewport: viewportRef.current,
            ...next,
        });
    }, [context, positions, storyId, tabId]);

    const handleMoveScene = useCallback((sceneId: StorySceneId, position: { x: number; y: number }) => {
        setPositions(current => {
            const next = { ...current, [sceneId]: position };
            persist({ positions: next });
            return next;
        });
    }, [persist]);

    const handleViewportChange = useCallback((viewport: SceneFlowViewport) => {
        viewportRef.current = viewport;
        persist({ viewport });
    }, [persist]);

    const handleResetLayout = useCallback(() => {
        setPositions({});
        persist({ positions: {} });
    }, [persist]);

    const handleOpenScene = useCallback((sceneId: StorySceneId) => {
        if (!document) {
            return;
        }
        const scene = document.scenes[sceneId];
        if (!scene) {
            return;
        }
        openEditorTab(createStorySceneEditorTab({ storyId: document.id, sceneId }, scene.name));
    }, [document, openEditorTab]);

    if (!storyId) {
        return <CenteredNotice text={t("story.flow.empty.noStory")} />;
    }
    if (error) {
        return <CenteredNotice text={error} />;
    }
    if (!graph || !document) {
        return <CenteredNotice text={t("story.panel.loadingStory")} />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center gap-3 border-b border-edge px-3 py-1.5">
                <span className="truncate text-xs font-medium text-fg">{document.name}</span>
                <span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
                    {tn("story.flow.summary.scenes", graph.nodes.length)}
                    {" · "}
                    {tn("story.flow.summary.jumps", graph.edges.length)}
                </span>
                {graph.danglingJumpCount > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {tn("story.flow.summary.dangling", graph.danglingJumpCount)}
                    </span>
                )}
                {graph.unreachableCount > 0 && (
                    <span className="shrink-0 text-2xs text-fg-subtle">
                        {tn("story.flow.summary.unreachable", graph.unreachableCount)}
                    </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <span className="text-2xs text-fg-subtle">{t("story.flow.hint.openScene")}</span>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!min-h-0 !px-2 !py-1"
                        title={t("story.flow.action.resetLayout")}
                        onClick={handleResetLayout}
                    >
                        <LayoutGrid className="mr-1 h-3.5 w-3.5 text-fg-muted" />
                        <span className="text-2xs text-fg-muted">{t("story.flow.action.resetLayout")}</span>
                    </Button>
                </div>
            </div>
            <div className="min-h-0 flex-1">
                {graph.nodes.length === 0 ? (
                    <CenteredNotice text={t("story.flow.empty.noScenes")} />
                ) : (
                    <SceneFlowCanvas
                        graph={graph}
                        positionOverrides={positions}
                        initialViewport={initialViewportRef.current}
                        onOpenScene={handleOpenScene}
                        onMoveScene={handleMoveScene}
                        onViewportChange={handleViewportChange}
                    />
                )}
            </div>
        </div>
    );
}

function CenteredNotice({ text }: { text: string }) {
    return (
        <div className="flex h-full items-center justify-center bg-surface p-6 text-center text-xs text-fg-subtle">
            {text}
        </div>
    );
}
