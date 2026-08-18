import type { UIStageSurface } from "@shared/types/ui-editor/document";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

/**
 * SPIKE (2026-08-17): a Game UI surface rendered inside a stage element's box.
 *
 * The five Game UI slots put a surface at a fixed place over the whole stage. This renders the same
 * surface body into a box the engine owns, to find out whether an element-mounted surface inherits
 * position, layer order, transitions and save/restore from the element for free.
 *
 * Scale is applied here rather than through `GameSurfaceRenderer`'s own `scale`, so the surface
 * keeps laying out at its design size and only the painted result is fitted to the box.
 */
export function EmbeddedStageSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    size: { width: number; height: number };
}) {
    const { options, surface, size } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "onStage" });
    const scale = Math.min(
        size.width / surface.designSize.width,
        size.height / surface.designSize.height,
    );
    return (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }} data-element-type="studio-embedded-surface">
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${surface.designSize.width}px`,
                    height: `${surface.designSize.height}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                }}
            >
                <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} />
            </div>
        </div>
    );
}
