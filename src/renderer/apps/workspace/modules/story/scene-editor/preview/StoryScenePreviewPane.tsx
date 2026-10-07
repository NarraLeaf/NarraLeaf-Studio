import { Loader2, MonitorPlay, PanelRight, PictureInPicture2, X, Zap } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { NlrStageLayer } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { GAME_STAGE_BASE_CLASS_NAME } from "@/lib/ui-editor/runtime/app/gameStageBase";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import type { StoryScenePreviewPaneMode } from "./storyScenePreviewSessionStore";

const NOOP = () => undefined;

/** An option that is on, in the accent: `ToolbarButton`'s own `active` is too close to its hover. */
const ACTIVE_TOGGLE_CLASS = "bg-primary/15 text-primary";

/** Keeps a press on a header control from starting a window drag. */
const stopPointerDown = (event: ReactPointerEvent) => event.stopPropagation();

/**
 * How far a press on the stage may travel and still be a click. Windows' own `SM_CXDRAG`, the number
 * the story rows and the interface editor use for the same question (see `storyRowSelectionGesture`
 * and `lib/ui-editor/interaction/gestureDeadzone`): a press that moves further is a drag, and a drag
 * never steps the story.
 */
const STAGE_CLICK_SLOP_PX = 4;

/**
 * The story editor's live-preview pane: an embedded NLR stage rendering the settled state of the
 * currently selected row, with a status/diagnostics strip underneath. The stage is always frozen —
 * it shows *what the stage looks like at this row*, never a playable session. Interactive
 * "play from here" lives in Dev Mode, launched from a row's ▶ button.
 *
 * A click on the stage is the reader's "next": it steps the editor's cursor to the next row the game
 * stops on, and the stage follows the cursor there (see `advanceFromStage`). The game's own controls
 * on the stage take no press, apart from the options of a menu.
 *
 * The same pane is reused whether it is docked in the split-pane or floating as a
 * picture-in-picture window; `mode` only affects the header controls, and
 * `onHeaderPointerDown` (supplied by the floating shell) turns the header into a drag handle.
 */
export function StoryScenePreviewPane(props: {
    controller: StoryScenePreviewController;
    onClose: () => void;
    mode?: StoryScenePreviewPaneMode;
    onToggleFloat?: () => void;
    onHeaderPointerDown?: (event: ReactPointerEvent) => void;
    /**
     * The scene on the stage. The floating window names it, because it stays on screen over editors
     * that are not that scene's; the docked pane sits inside the scene's own editor and does not.
     */
    sceneName?: string | null;
    /**
     * Width over height of the stage, when the pane takes its height from its stage rather than the
     * other way round: docked under the script, it is as tall as the stage at the pane's width, and
     * the stage gives up height (letterboxing the game) only when the pane is held shorter than that.
     */
    stageAspectRatio?: number;
    /** Lines appear in full rather than typed out; shared by the docked pane and the window. */
    skipTyping?: boolean;
    onToggleSkipTyping?: () => void;
}) {
    const { t } = useTranslation();
    const { controller, onClose, mode = "dock", onToggleFloat, onHeaderPointerDown, sceneName, stageAspectRatio, skipTyping = false, onToggleSkipTyping } = props;
    const busy = controller.phase === "compiling" || controller.phase === "mounting" || controller.phase === "starting";
    /** Where the primary press on the stage went down, until it comes up. */
    const pressRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        pressRef.current = event.button === 0 && event.isPrimary
            ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
            : null;
    };
    // Only a press that went down on the stage and came up near where it went down. A window dragged
    // by its header or an edge and let go over the stage never went down here.
    const handleStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || press.pointerId !== event.pointerId) {
            return;
        }
        if (Math.abs(event.clientX - press.x) >= STAGE_CLICK_SLOP_PX || Math.abs(event.clientY - press.y) >= STAGE_CLICK_SLOP_PX) {
            return;
        }
        controller.advanceFromStage();
    };
    const handleStagePointerCancel = () => {
        pressRef.current = null;
    };
    const notes = [
        ...controller.diagnostics.map(diagnostic => ({ level: diagnostic.level, message: diagnostic.message })),
        ...controller.issues,
    ];

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
            <div
                className={`flex min-h-[36px] items-center gap-2 border-b border-edge px-3${onHeaderPointerDown ? " cursor-move select-none" : ""}`}
                onPointerDown={onHeaderPointerDown}
            >
                <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
                <span className="shrink-0 text-xs font-medium text-fg">{t("story.preview.title")}</span>
                {sceneName ? (
                    <span className="min-w-0 truncate text-xs text-fg-muted" data-story-preview-scene="">
                        {sceneName}
                    </span>
                ) : null}
                {/* Refreshes keep the previous frame visible; the spinner is the only indicator. */}
                {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" /> : null}
                <div className="flex-1" />
                {onToggleSkipTyping ? (
                    <ToolbarButton
                        size="xs"
                        className={cn("shrink-0", skipTyping && ACTIVE_TOGGLE_CLASS)}
                        onPointerDown={stopPointerDown}
                        onClick={onToggleSkipTyping}
                        active={skipTyping}
                        aria-pressed={skipTyping}
                        data-tip={t("story.preview.skipTyping")} aria-label={t("story.preview.skipTyping")}
                        data-story-preview-skip-typing=""
                    >
                        <Zap className="h-3.5 w-3.5" />
                    </ToolbarButton>
                ) : null}
                {onToggleFloat ? (
                    <ToolbarButton
                        size="xs"
                        className="shrink-0"
                        onPointerDown={stopPointerDown}
                        onClick={onToggleFloat}
                        data-tip={mode === "float" ? t("story.preview.dock") : t("story.preview.pip")} aria-label={mode === "float" ? t("story.preview.dock") : t("story.preview.pip")}
                    >
                        {mode === "float"
                            ? <PanelRight className="h-3.5 w-3.5" />
                            : <PictureInPicture2 className="h-3.5 w-3.5" />}
                    </ToolbarButton>
                ) : null}
                <ToolbarButton
                    size="xs"
                    className="shrink-0"
                    onPointerDown={stopPointerDown}
                    onClick={onClose}
                    data-tip={t("story.preview.closePreview")} aria-label={t("story.preview.closePreview")}
                >
                    <X className="h-3.5 w-3.5" />
                </ToolbarButton>
            </div>

            {/* The stage inherits what a shipped game's does, never Studio's theme. */}
            <div
                className={`relative min-h-0 ${stageAspectRatio ? "flex-initial" : "flex-1"} select-none overflow-hidden ${GAME_STAGE_BASE_CLASS_NAME}`}
                style={stageAspectRatio ? { aspectRatio: stageAspectRatio } : undefined}
                data-story-preview-stage=""
                onPointerDown={handleStagePointerDown}
                onPointerUp={handleStagePointerUp}
                onPointerCancel={handleStagePointerCancel}
            >
                {/* Double-buffered stage: array order is stacking order. During a rebuild the
                    incoming session paints beneath the held frame; the controller unmounts the
                    old buffer only once the new one is pixel-ready, so switches never flash. */}
                {controller.stageLayers.map(layer => (
                    <div key={layer.session.id} ref={layer.setRootElement} className="absolute inset-0">
                        <NlrStageLayer
                            session={layer.session}
                            // The state preview is inert: the stage is a still of the selected row,
                            // never a playable session. A press reaches the pane above it, and only a
                            // menu's options take one of their own (see `pressableSlots`).
                            interactive={false}
                            renderOnStage
                            onLiveGameReady={controller.onLiveGameReady}
                            onEnvironmentReady={NOOP}
                            onFirstSceneReady={NOOP}
                            onError={controller.onStageError}
                        />
                    </div>
                ))}
                {controller.stageLayers.length === 0 && controller.phase === "idle" ? (
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/50">
                        {t("story.preview.selectRow")}
                    </div>
                ) : null}
                {controller.phase === "error" ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
                        <div className="max-w-full text-center">
                            <div className="text-xs font-medium text-red-400">{t("story.preview.failed")}</div>
                            <div className="mt-1 break-words text-2xs text-white/70">{controller.errorMessage}</div>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* Docked (split-pane) keeps the inline diagnostics strip as-is; the picture-in-picture
                float drops it so problems don't eat the small preview's space — they still land in
                the bottom console's Story tab, which the preview controller feeds regardless of mode. */}
            {mode === "dock" && notes.length > 0 ? (
                <div className="max-h-28 shrink-0 overflow-auto border-t border-edge px-3 py-1.5">
                    {notes.map((note, index) => (
                        <div
                            key={index}
                            className={`truncate text-2xs leading-5 ${note.level === "error" ? "text-danger" : "text-warning"}`}
                            data-tip={note.message}
                        >
                            {note.message}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
