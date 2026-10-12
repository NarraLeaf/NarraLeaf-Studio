import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DevTools } from "narraleaf-react";
import { followPress } from "./followPress";
import {
    panPreviewCamera,
    previewCameraPose,
    previewCameraProps,
    withPreviewCameraPose,
    zoomPreviewCameraAt,
    type PreviewCameraPose,
    type PreviewCameraRowPayload,
} from "./storyPreviewCameraModel";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";

/** The camera row the docked preview frames: the selected row, when it is one that states a pose. */
export type StoryPreviewCameraApi = {
    blockId: string;
    payload: PreviewCameraRowPayload;
    /** Writes the row. Called once per gesture: on release, or once the wheel has rested. */
    commit: (payload: PreviewCameraRowPayload) => void;
};

/** How far a press may travel and still be the click that steps the story (the pane's own slop). */
const DRAG_SLOP_PX = 4;
/** How long the wheel rests before a zoom is written: a turn of several notches is one change. */
const WHEEL_REST_MS = 450;
/** How much one pixel of wheel travel zooms; a notch (about 100) is a step of about a sixth. */
const WHEEL_ZOOM_PER_PX = 0.0015;

type StageHandle = {
    /** The row the gesture writes, as it stood when the gesture began. */
    api: StoryPreviewCameraApi;
    pose: PreviewCameraPose;
    /** Whether the frame opened on the row's end rather than playing its move. */
    settled: boolean;
    stage: { left: number; top: number; width: number; height: number };
    put: (pose: PreviewCameraPose) => void;
};

/**
 * Framing a camera row on the preview's stage: a drag moves the picture with the pointer, the wheel
 * pushes in or pulls out about the pointer, and the row is written once per gesture.
 *
 * While the gesture runs, the pose goes straight onto the running preview's camera - and with it the
 * layers at their distances - because a rebuild per pointer move would take hundreds of milliseconds
 * each and replay the row's move from the previous pose every time. Once written, the preview is
 * told to open on this row's end frame (`holdTargetEnd`), so the rebuild that follows shows the frame
 * the gesture left rather than playing the move again.
 *
 * A press that does not travel stays the pane's click: the reader's "next".
 */
export function useStoryPreviewCameraFraming(options: {
    camera: StoryPreviewCameraApi | null;
    controller: StoryScenePreviewController;
    stageElement: HTMLDivElement | null;
}): {
    /** The pose while a gesture runs, for the pane to read out; null otherwise. */
    readout: PreviewCameraPose | null;
    dragging: boolean;
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
    const { camera, controller, stageElement } = options;
    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    const controllerRef = useRef(controller);
    controllerRef.current = controller;
    const [readout, setReadout] = useState<PreviewCameraPose | null>(null);
    const [dragging, setDragging] = useState(false);
    const endPressRef = useRef<(() => void) | null>(null);
    // A zoom the wheel has made and not yet written, the row it was made on, and the timer that writes it.
    const wheelRef = useRef<{ api: StoryPreviewCameraApi; pose: PreviewCameraPose; timer: ReturnType<typeof setTimeout> } | null>(null);

    /** The running preview's camera at this row, or null while it is not the row's or not running. */
    const stageHandle = (): StageHandle | null => {
        const api = cameraRef.current;
        const context = controllerRef.current.getStageContext();
        if (!api || !context || context.targetBlockId !== api.blockId || !stageElement) {
            return null;
        }
        const frames = stageElement.querySelectorAll<HTMLElement>(":scope > [data-story-preview-frame]");
        const frame = frames.length > 0 ? frames[frames.length - 1] : null;
        // The camera's own box carries its zoom; the box it sits in is the stage as drawn.
        const box = frame?.querySelector<HTMLElement>("[data-element-type=\"camera\"]")?.parentElement;
        if (!box) {
            return null;
        }
        const rect = box.getBoundingClientRect();
        return {
            api,
            pose: previewCameraPose(context.targetCamera, api.payload),
            settled: context.settledTarget,
            stage: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            put: pose => putPose(api.blockId, pose),
        };
    };

    /**
     * The pose onto the camera of the frame on screen now - looked up each time, since a rebuild may
     * swap the frame in the middle of a gesture.
     */
    const putPose = (blockId: string, pose: PreviewCameraPose) => {
        const context = controllerRef.current.getStageContext();
        if (!context || context.targetBlockId !== blockId) {
            return;
        }
        const gameState = context.liveGame.getGameState();
        const displayable = context.compiled.story.camera;
        if (!gameState || !displayable) {
            return;
        }
        try {
            DevTools.setDisplayableTransformProps(gameState, displayable as never, previewCameraProps(pose));
        } catch {
            // The row's move is still playing and holds the camera; the next pose lands once it is done.
        }
    };

    /**
     * A gesture begun while the frame still plays the row's move: the move holds the camera, so the
     * frame is rebuilt onto the row's end at once rather than the gesture waiting for it to finish.
     */
    const settleFor = (handle: StageHandle) => {
        if (!handle.settled) {
            controllerRef.current.holdTargetEnd(handle.api.blockId, { now: true });
        }
    };

    const write = (api: StoryPreviewCameraApi, pose: PreviewCameraPose, changed: { position: boolean; zoom: boolean }) => {
        controllerRef.current.holdTargetEnd(api.blockId);
        const next = withPreviewCameraPose(api.payload, pose, changed);
        if (JSON.stringify(next) !== JSON.stringify(api.payload)) {
            api.commit(next);
        }
    };

    const flushWheel = () => {
        const pending = wheelRef.current;
        if (!pending) {
            return;
        }
        clearTimeout(pending.timer);
        wheelRef.current = null;
        setReadout(null);
        write(pending.api, pending.pose, { position: true, zoom: true });
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!cameraRef.current || event.button !== 0 || !event.isPrimary) {
            return;
        }
        // A zoom still resting is written first, so the drag starts from it.
        flushWheel();
        const startX = event.clientX;
        const startY = event.clientY;
        let handle: StageHandle | null = null;
        let pose: PreviewCameraPose | null = null;
        endPressRef.current?.();
        endPressRef.current = followPress(
            event,
            move => {
                const dx = move.clientX - startX;
                const dy = move.clientY - startY;
                if (!handle) {
                    if (Math.hypot(dx, dy) < DRAG_SLOP_PX) {
                        return;
                    }
                    handle = stageHandle();
                    if (!handle) {
                        return;
                    }
                    settleFor(handle);
                    setDragging(true);
                }
                pose = panPreviewCamera(handle.pose, dx, dy, handle.stage);
                handle.put(pose);
                setReadout(pose);
            },
            released => {
                endPressRef.current = null;
                setDragging(false);
                setReadout(null);
                if (released && handle && pose) {
                    write(handle.api, pose, { position: true, zoom: false });
                } else if (handle && pose) {
                    // Called off: the frame goes back to what the row says.
                    handle.put(handle.pose);
                }
            },
        );
    };

    // The wheel, on the stage itself: React's wheel listener is passive and cannot keep the page from
    // scrolling, so this one is added by hand and only takes the wheel while a camera row is framed.
    useEffect(() => {
        if (!stageElement) {
            return;
        }
        const handleWheel = (event: WheelEvent) => {
            if (!cameraRef.current || event.ctrlKey) {
                return;
            }
            const handle = stageHandle();
            if (!handle) {
                return;
            }
            event.preventDefault();
            if (!wheelRef.current) {
                settleFor(handle);
            }
            const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? handle.stage.height : 1;
            const factor = Math.exp(-event.deltaY * lines * WHEEL_ZOOM_PER_PX);
            const base = wheelRef.current?.api.blockId === handle.api.blockId ? wheelRef.current.pose : handle.pose;
            const pose = zoomPreviewCameraAt(
                base,
                factor,
                { x: event.clientX - handle.stage.left, y: event.clientY - handle.stage.top },
                handle.stage,
                controllerRef.current.designSize,
            );
            handle.put(pose);
            setReadout(pose);
            if (wheelRef.current) {
                clearTimeout(wheelRef.current.timer);
            }
            wheelRef.current = { api: wheelRef.current?.api.blockId === handle.api.blockId ? wheelRef.current.api : handle.api, pose, timer: setTimeout(flushWheel, WHEEL_REST_MS) };
        };
        stageElement.addEventListener("wheel", handleWheel, { passive: false });
        return () => stageElement.removeEventListener("wheel", handleWheel);
        // The handlers read the live row and controller through refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stageElement]);

    // A different row, or none: a zoom still resting is written to the row it was made on, and a
    // drag in progress is called off.
    const blockId = camera?.blockId ?? null;
    useEffect(() => () => {
        flushWheel();
        endPressRef.current?.();
        // Only the row's identity matters; the flush reads the row it was made on through the ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId]);

    return { readout, dragging, onPointerDown };
}
