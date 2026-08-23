import { useMemo } from "react";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
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
 * canvas → create a compatible node" flow. Each follows the global-state broadcast, so a change
 * made in the separate Settings window reaches the open canvas at once (see
 * {@link useGlobalSetting}).
 */
export function useBlueprintDragConnectSettings(): BlueprintDragConnectEnablement {
    const execOutput = useGlobalSetting(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.execOutput,
        stored => readBool(stored, DEFAULTS.execOutput));
    const dataOutput = useGlobalSetting(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.dataOutput,
        stored => readBool(stored, DEFAULTS.dataOutput));
    const input = useGlobalSetting(BLUEPRINT_DRAG_CONNECT_SETTING_KEYS.input,
        stored => readBool(stored, DEFAULTS.input));

    return useMemo(() => ({ execOutput, dataOutput, input }), [execOutput, dataOutput, input]);
}
