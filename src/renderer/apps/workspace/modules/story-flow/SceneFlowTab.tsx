import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { SceneFlowCanvas } from "./SceneFlowCanvas";
import {
    buildSceneFlowGraph,
    type SceneFlowConnectionRejection,
    type SceneFlowEdgeModel,
} from "./sceneFlowModel";
import {
    createJumpBlock,
    deleteJumpBlocks,
    edgeDeletionNeedsConfirm,
    retargetJumpBlocks,
    type SceneFlowJumpOpsDeps,
} from "./sceneFlowJumpOps";
import type { SceneFlowTabPayload, SceneFlowViewport } from "./sceneFlowTabId";

/**
 * Read-only map of a story's scenes and the jumps between them. Double-clicking a scene opens its
 * editor, so this is a navigation surface as much as a diagnostic one.
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

    // Transient one-liner under the header: what the last edit did, or why one was refused.
    const [status, setStatus] = useState<{ text: string; tone: "info" | "warning" } | null>(null);
    const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showStatus = useCallback((text: string, tone: "info" | "warning" = "info") => {
        setStatus({ text, tone });
        if (statusTimerRef.current) {
            clearTimeout(statusTimerRef.current);
        }
        statusTimerRef.current = setTimeout(() => setStatus(null), 4000);
    }, []);
    useEffect(() => () => {
        if (statusTimerRef.current) {
            clearTimeout(statusTimerRef.current);
        }
    }, []);

    const jumpOps = useMemo<SceneFlowJumpOpsDeps | null>(() => {
        if (!context || !storyService || !storyId) {
            return null;
        }
        const uuidService = context.services.get<UuidService>(Services.Uuid);
        return { storyService, storyId, generateId: () => uuidService.generate() };
    }, [context, storyId, storyService]);

    const sceneName = useCallback(
        (sceneId: StorySceneId) => document?.scenes[sceneId]?.name ?? sceneId,
        [document],
    );

    const handleCreateJump = useCallback((source: StorySceneId, target: StorySceneId) => {
        if (!jumpOps) {
            return;
        }
        createJumpBlock(jumpOps, source, target);
        showStatus(t("story.flow.status.jumpCreated", { source: sceneName(source), target: sceneName(target) }));
    }, [jumpOps, sceneName, showStatus, t]);

    const handleRetargetJump = useCallback((edge: SceneFlowEdgeModel, next: StorySceneId) => {
        if (!jumpOps || !document) {
            return;
        }
        retargetJumpBlocks(jumpOps, document, edge, next);
        showStatus(t("story.flow.status.jumpRetargeted", { source: sceneName(edge.source), target: sceneName(next) }));
    }, [document, jumpOps, sceneName, showStatus, t]);

    const handleConfirmDeleteJump = useCallback(async (edge: SceneFlowEdgeModel) => {
        if (!context) {
            return false;
        }
        if (!edgeDeletionNeedsConfirm(edge)) {
            return true;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        return uiService.showConfirm(
            t("story.flow.confirm.deleteJump", { source: sceneName(edge.source), target: sceneName(edge.target) }),
            edge.jumps.some(jump => jump.conditional)
                ? t("story.flow.confirm.deleteJumpConditional", { count: String(edge.jumps.length) })
                : t("story.flow.confirm.deleteJumpMultiple", { count: String(edge.jumps.length) }),
        );
    }, [context, sceneName, t]);

    const handleDeleteJump = useCallback((edge: SceneFlowEdgeModel) => {
        if (!jumpOps) {
            return;
        }
        deleteJumpBlocks(jumpOps, edge);
        showStatus(t("story.flow.status.jumpDeleted", { source: sceneName(edge.source), target: sceneName(edge.target) }));
    }, [jumpOps, sceneName, showStatus, t]);

    const handleConnectionRejected = useCallback((reason: SceneFlowConnectionRejection) => {
        const messages: Record<SceneFlowConnectionRejection, string> = {
            selfJump: t("story.flow.reject.selfJump"),
            duplicate: t("story.flow.reject.duplicate"),
            sourceLocked: t("story.flow.reject.sourceLocked"),
            unknownScene: t("story.flow.reject.unknownScene"),
        };
        showStatus(messages[reason], "warning");
    }, [showStatus, t]);

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
                    {status ? (
                        <span className={cn("text-2xs", status.tone === "warning" ? "text-warning" : "text-fg-muted")}>
                            {status.text}
                        </span>
                    ) : (
                        <span className="text-2xs text-fg-subtle">{t("story.flow.hint.edit")}</span>
                    )}
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
                        onCreateJump={handleCreateJump}
                        onRetargetJump={handleRetargetJump}
                        onDeleteJump={handleDeleteJump}
                        onConfirmDeleteJump={handleConfirmDeleteJump}
                        onConnectionRejected={handleConnectionRejected}
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
