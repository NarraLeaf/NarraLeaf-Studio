import type { ComponentProps } from "react";
import { Dialog as NlrDialog } from "narraleaf-react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { DialogStateBridge } from "./DialogStateBridge";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

/**
 * Renders the Game UI dialog slot surface inside the NarraLeaf <Dialog>
 * component, wiring its own blueprint host adapter scoped to the dialog
 * slot runtime scope and flushing dialog-bound elements on dialog changes.
 */
export function DialogSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    setDialogVirtualClickTarget: (target: HTMLElement | null) => void;
}) {
    const { options, surface, setDialogVirtualClickTarget } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "dialog" });

    return (
        <NlrDialog
            // The box a Game UI click is forwarded to. Handed over on mount and taken back on
            // detach, both by React; the host holds it by element, so a box leaving the stage
            // never takes another one's place with it - see `createDialogClickTargets`.
            ref={setDialogVirtualClickTarget}
            style={{ width: "100%", height: "100%", position: "relative" }}
        >
            <DialogStateBridge
                core={options.core}
                getCurrentNametag={options.host.onGetNametag}
                resolveAvatarAssetId={options.resolveAvatarAssetId}
                flushDialogElements={runtime.flushSlotElements}
            />
            <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} />
        </NlrDialog>
    );
}

export function createDialogSlotComponent(componentProps: ComponentProps<typeof DialogSlotSurface>) {
    return function DialogSlotGameUI() {
        return <DialogSlotSurface {...componentProps} />;
    };
}
