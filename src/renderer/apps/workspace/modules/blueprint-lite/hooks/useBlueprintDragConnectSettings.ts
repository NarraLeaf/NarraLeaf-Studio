import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import {
    BLUEPRINT_DRAG_CONNECT_SETTING_KEYS,
    type BlueprintDragConnectEnablement,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintDragConnect";

const DEFAULTS: BlueprintDragConnectEnablement = { execOutput: true, dataOutput: true, input: true };

function readBool(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads the three `blueprint.dragConnect.*` toggles that gate the "drag off a pin onto empty
 * canvas → create a compatible node" flow. Re-reads when the window regains focus so a change
 * made in the separate Settings window applies on return (mirrors {@link useMaxActiveEditors}).
 */
export function useBlueprintDragConnectSettings(): BlueprintDragConnectEnablement {
    const [value, setValue] = useState<BlueprintDragConnectEnablement>(DEFAULTS);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const state = getInterface().app.state;
                const [execOutput, dataOutput, input] = await Promise.all([
                    state.getGlobalState(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.execOutput),
                    state.getGlobalState(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.dataOutput),
                    state.getGlobalState(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.input),
                ]);
                if (cancelled) {
                    return;
                }
                setValue({
                    execOutput: readBool(execOutput.success ? execOutput.data.value : undefined, DEFAULTS.execOutput),
                    dataOutput: readBool(dataOutput.success ? dataOutput.data.value : undefined, DEFAULTS.dataOutput),
                    input: readBool(input.success ? input.data.value : undefined, DEFAULTS.input),
                });
            } catch {
                // Keep the last known-good values on transient IPC failures.
            }
        };
        void load();
        const onFocus = () => { void load(); };
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    return value;
}
