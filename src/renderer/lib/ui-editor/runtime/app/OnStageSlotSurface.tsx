import type { ReactNode } from "react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

/**
 * Renders the Game UI on-stage slot surface as NarraLeaf `<Player>` children (mounted inside the
 * player's RootLayout for the whole session). The surface shell is click-through
 * (`surfacePointerEvents: "none"`): empty areas keep stage/dialog interaction working, while
 * rendered elements re-enable pointer events themselves via their node wrappers. NLR's RootLayout
 * host forces `pointer-events: auto` on all descendants through a universal-selector CSS rule, so
 * the click-through must be applied as an inline style on the shell (see GameSurfaceRenderer).
 * A full-surface interactive container would still block stage clicks — documented caveat.
 */
export function OnStageSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
}) {
    const { options, surface } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "onStage" });
    return (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} data-element-type="studio-on-stage">
            <StageSlotSurfaceBody
                options={options}
                surface={surface}
                runtime={runtime}
                surfacePointerEvents="none"
            />
        </div>
    );
}

export function createOnStageSlotNode(options: GameUiSlotHostOptions, surface: UIStageSurface): ReactNode {
    return <OnStageSlotSurface options={options} surface={surface} />;
}
