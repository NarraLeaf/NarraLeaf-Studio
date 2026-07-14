import { useEffect } from "react";
import { useDialog } from "narraleaf-react";
import { BLUEPRINT_GAME_NAMETAG_STATE_KEY } from "@shared/types/blueprint/hostApi";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

/**
 * Mirrors the NarraLeaf dialog state (speaker nametag) into the blueprint
 * global scope and flushes dialog-bound elements whenever the dialog text,
 * speaker, or completion state changes. Must render inside <NlrDialog>.
 */
export function DialogStateBridge(props: {
    core: BlueprintRuntimeCore | null;
    getCurrentNametag: () => string | null;
    flushDialogElements: () => void;
}) {
    const { core, getCurrentNametag, flushDialogElements } = props;
    const dialog = useDialog();

    useEffect(() => {
        if (!core) {
            return;
        }
        const nametag = dialog.isNarrator ? null : getCurrentNametag();
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NAMETAG_STATE_KEY, nametag);
        flushDialogElements();
    }, [core, dialog.done, dialog.isNarrator, dialog.text, flushDialogElements, getCurrentNametag]);

    return null;
}
