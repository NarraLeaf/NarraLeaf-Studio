import { Loader2, MonitorPlay, PanelRight, PictureInPicture2, Play, RotateCcw, Square, Volume2, VolumeX, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { NlrStageLayer } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import { useTranslation } from "@/lib/i18n";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import type { StoryScenePreviewPaneMode } from "./storyScenePreviewSessionStore";

const NOOP = () => undefined;

/**
 * The story editor's live-preview pane: an embedded NLR stage rendering the state of the
 * currently selected row, with a status/diagnostics strip underneath.
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
}) {
    const { t } = useTranslation();
    const { controller, onClose, mode = "dock", onToggleFloat, onHeaderPointerDown } = props;
    const busy = controller.phase === "compiling" || controller.phase === "mounting" || controller.phase === "starting";
    const showSceneStartHint = controller.stageLayers.length > 0 && controller.targetBlockId === null && !busy && controller.phase !== "error";
    const playing = controller.mode === "play";
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
                <span className="truncate text-xs font-medium text-fg">{t("story.preview.title")}</span>
                {/* Refreshes keep the previous frame visible; the spinner is the only indicator. */}
                {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" /> : null}
                <div className="flex-1" />
                {onToggleFloat ? (
                    <button
                        type="button"
                        className="rounded p-1 text-fg-muted hover:bg-fill hover:text-fg"
                        // Keep header clicks on controls from starting a window drag.
                        onPointerDown={event => event.stopPropagation()}
                        onClick={onToggleFloat}
                        title={mode === "float" ? t("story.preview.dock") : t("story.preview.pip")}
                    >
                        {mode === "float"
                            ? <PanelRight className="h-3.5 w-3.5" />
                            : <PictureInPicture2 className="h-3.5 w-3.5" />}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="rounded p-1 text-fg-muted hover:bg-fill hover:text-fg"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={onClose}
                    title={t("story.preview.closePreview")}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
                {/* Double-buffered stage: array order is stacking order. During a rebuild the
                    incoming session paints beneath the held frame; the controller unmounts the
                    old buffer only once the new one is pixel-ready, so switches never flash. */}
                {controller.stageLayers.map(layer => (
                    <div key={layer.session.id} ref={layer.setRootElement} className="absolute inset-0">
                        <NlrStageLayer
                            session={layer.session}
                            // Playback hands the stage to the author: clicks advance lines and pick
                            // menu options. A held snapshot frame stays inert.
                            interactive={controller.interactive}
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
                {showSceneStartHint ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-center text-2xs text-fg-muted"></div>
                ) : null}
            </div>

            <PreviewTransport controller={controller} />

            {/* Docked (split-pane) keeps the inline diagnostics strip as-is; the picture-in-picture
                float drops it so problems don't eat the small preview's space — they still land in
                the bottom console's Story tab, which the preview controller feeds regardless of mode. */}
            {mode === "dock" && notes.length > 0 ? (
                <div className="max-h-28 shrink-0 overflow-auto border-t border-edge px-3 py-1.5">
                    {notes.map((note, index) => (
                        <div
                            key={index}
                            className={`truncate text-2xs leading-5 ${note.level === "error" ? "text-danger" : "text-warning"}`}
                            title={note.message}
                        >
                            {note.message}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/**
 * Transport strip: enters continuous playback from the selected row, and while playing offers
 * replay / stop / audio. It sits below the stage so it survives both the docked and floating shells
 * (the float drops the notes strip, and its header is a drag handle).
 */
function PreviewTransport(props: { controller: StoryScenePreviewController }) {
    const { t } = useTranslation();
    const { controller } = props;
    const playing = controller.mode === "play";

    const status = controller.phase === "ended"
        ? controller.playbackStop?.reason === "jump"
            ? t("story.preview.endedAtJump")
            : t("story.preview.ended")
        : controller.phase === "playing"
            ? t("story.preview.playing")
            : null;

    if (!playing) {
        return (
            <div className="flex min-h-[30px] shrink-0 items-center gap-2 border-t border-edge px-2">
                <TransportButton
                    icon={<Play className="h-3.5 w-3.5" />}
                    label={t("story.preview.playFromHere")}
                    onClick={controller.startPlaybackFromSelection}
                />
            </div>
        );
    }

    return (
        <div className="flex min-h-[30px] shrink-0 items-center gap-1 border-t border-edge px-2">
            <TransportButton
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                label={t("story.preview.restart")}
                onClick={controller.restartPlayback}
            />
            <TransportButton
                icon={<Square className="h-3.5 w-3.5" />}
                label={t("story.preview.stop")}
                onClick={controller.stopPlayback}
            />
            <TransportButton
                icon={controller.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                label={controller.muted ? t("story.preview.unmute") : t("story.preview.mute")}
                onClick={() => controller.setMuted(!controller.muted)}
                iconOnly
            />
            <div className="flex-1" />
            {status ? <span className="truncate text-2xs text-fg-muted">{status}</span> : null}
        </div>
    );
}

function TransportButton(props: { icon: ReactNode; label: string; onClick: () => void; iconOnly?: boolean }) {
    return (
        <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill hover:text-fg"
            // The floating shell turns the pane into a drag surface; controls must not start a move.
            onPointerDown={event => event.stopPropagation()}
            onClick={props.onClick}
            title={props.label}
            aria-label={props.label}
        >
            {props.icon}
            {props.iconOnly ? null : <span>{props.label}</span>}
        </button>
    );
}
