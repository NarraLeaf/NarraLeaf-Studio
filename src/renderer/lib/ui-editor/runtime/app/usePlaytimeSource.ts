import { useState } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import {
    runtimeCoreIsFor,
    type BlueprintRuntimeCore,
    type BlueprintRuntimeCoreOptions,
} from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

/** Identify the inputs that own a core until its replacement is published. */
export function usePlaytimeSource(
    core: BlueprintRuntimeCore | null,
    bundle: DevModeBundle,
    options: BlueprintRuntimeCoreOptions,
) {
    const inputs = {
        persistenceAdapter: options.persistenceAdapter ?? null,
        onDebugEvent: options.onDebugEvent,
        disposeMessage: options.disposeMessage ?? "Blueprint runtime disposed",
        debuggerEnabled: options.debuggerEnabled ?? false,
        onScriptIssue: options.onScriptIssue,
    };
    const [owner, setOwner] = useState(() => ({ core, inputs, invalidated: !runtimeCoreIsFor(core, bundle) }));
    const original = owner.core === core ? owner.inputs : inputs;
    const matches = runtimeCoreIsFor(core, bundle)
        && original.persistenceAdapter === inputs.persistenceAdapter
        && original.onDebugEvent === inputs.onDebugEvent
        && original.disposeMessage === inputs.disposeMessage
        && original.debuggerEnabled === inputs.debuggerEnabled
        && original.onScriptIssue === inputs.onScriptIssue;

    // React retries this render with the adjusted owner; an abandoned render keeps the committed one.
    if (owner.core !== core) {
        setOwner({ core, inputs, invalidated: !matches });
    } else if (!matches && !owner.invalidated) {
        setOwner({ ...owner, invalidated: true });
    }
    return core && matches && !(owner.core === core && owner.invalidated) ? core.scopeBridge : null;
}
