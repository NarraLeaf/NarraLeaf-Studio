import { useMemo } from "react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";
import { stageElementRuntimeScopeId } from "./stageSlots";

/**
 * A Game UI surface drawn inside a stage element's box.
 *
 * The five Game UI slots put a surface at a fixed place over the whole stage. This one is placed by
 * the story instead: the engine owns the box — where it sits, which layer it is on, its transform,
 * its opacity and its entry in a saved game — and the surface paints the inside. Nothing about the
 * surface itself changes; it is the same document, the same widgets and the same blueprint runtime
 * the slots use, which is the point.
 *
 * Two decisions worth keeping:
 *
 * **Scale is applied here, not through `GameSurfaceRenderer`'s `scale`.** The surface keeps laying
 * out at its own design size, and only the painted result is fitted into the box, so an author who
 * draws a 400×400 frame gets the same frame at every stage size.
 *
 * **Passive by default.** Anything drawn here sits over the stage, and `pointer-events: none` does
 * not survive `EditorNodeWrapper` — every non-root node writes `pointerEvents: "auto"` back. So a
 * frame with a full-size container in it would silently eat the click that advances the line. The
 * surface is therefore marked passive, which is the mechanism (`SurfacePassiveContext`) that
 * actually reaches the widgets.
 */
export function EmbeddedStageSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    /** The stage object this instance belongs to; scopes its runtime state. */
    objectName: string;
    size: { width: number; height: number };
}) {
    const { options, surface, objectName, size } = props;
    const runtimeScopeIdOverride = useMemo(
        () => stageElementRuntimeScopeId(options.sessionId, objectName, surface.id),
        [options.sessionId, objectName, surface.id],
    );
    const runtime = useStageSlotSurfaceRuntime({
        options,
        surface,
        slotId: "onStage",
        runtimeScopeIdOverride,
    });
    const scale = Math.min(
        size.width / Math.max(1, surface.designSize.width),
        size.height / Math.max(1, surface.designSize.height),
    );
    return (
        <div
            style={{ position: "absolute", inset: 0, overflow: "hidden" }}
            data-element-type="studio-embedded-surface"
            data-embedded-surface-id={surface.id}
        >
            <div
                style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: `${surface.designSize.width}px`,
                    height: `${surface.designSize.height}px`,
                    transform: `translate(-50%, -50%) scale(${scale})`,
                }}
            >
                <StageSlotSurfaceBody
                    options={options}
                    surface={surface}
                    runtime={runtime}
                    passive
                />
            </div>
        </div>
    );
}
