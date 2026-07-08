import { Loader2, MonitorPlay, X } from "lucide-react";
import { NlrStageLayer } from "@/lib/ui-editor/runtime/game/NlrStageLayer";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";

const NOOP = () => undefined;

/**
 * The story editor's live-preview pane: an embedded NLR stage rendering the state of the
 * currently selected row, with a status/diagnostics strip underneath.
 */
export function StoryScenePreviewPane(props: {
    controller: StoryScenePreviewController;
    onClose: () => void;
}) {
    const { controller, onClose } = props;
    const busy = controller.phase === "compiling" || controller.phase === "mounting" || controller.phase === "starting";
    const showSceneStartHint = controller.session !== null && controller.targetBlockId === null && !busy && controller.phase !== "error";
    const notes = [
        ...controller.diagnostics.map(diagnostic => ({ level: diagnostic.level, message: diagnostic.message })),
        ...controller.issues,
    ];

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
            <div className="flex min-h-[36px] items-center gap-2 border-b border-edge px-3">
                <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-xs font-medium text-fg">Live Preview</span>
                {/* Refreshes keep the previous frame visible; the spinner is the only indicator. */}
                {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" /> : null}
                <div className="flex-1" />
                <button
                    type="button"
                    className="rounded p-1 text-fg-muted hover:bg-fill hover:text-fg"
                    onClick={onClose}
                    title="Close live preview"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
                <NlrStageLayer
                    session={controller.session}
                    interactive={false}
                    renderOnStage
                    onLiveGameReady={controller.onLiveGameReady}
                    onEnvironmentReady={NOOP}
                    onFirstSceneReady={NOOP}
                    onError={controller.onStageError}
                />
                {controller.session === null && controller.phase === "idle" ? (
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-subtle">
                        Select a story row to preview its stage state.
                    </div>
                ) : null}
                {controller.phase === "error" ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
                        <div className="max-w-full text-center">
                            <div className="text-xs font-medium text-red-400">Preview failed</div>
                            <div className="mt-1 break-words text-2xs text-fg-muted">{controller.errorMessage}</div>
                        </div>
                    </div>
                ) : null}
                {showSceneStartHint ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-center text-2xs text-fg-muted">
                        Previewing the scene start — select a row to preview its state.
                    </div>
                ) : null}
            </div>

            {notes.length > 0 ? (
                <div className="max-h-28 shrink-0 overflow-auto border-t border-edge px-3 py-1.5">
                    {notes.map((note, index) => (
                        <div
                            key={index}
                            className={`truncate text-2xs leading-5 ${note.level === "error" ? "text-red-400" : "text-amber-300"}`}
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
