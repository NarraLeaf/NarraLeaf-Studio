import { useMemo, useState } from "react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ConfirmModal } from "@/lib/components/elements/Modal";
import type { AppearanceVariant } from "@shared/types/ui-editor/appearance";
import { InlineMenuTriggerButton } from "@/lib/ui-editor/widget-modules/shared/chrome/InlineMenuTriggerButton";
import {
    ensureModuleExclusiveState,
    listModuleExclusiveStatesPresent,
    moduleFullyHasExclusiveState,
    removeModuleExclusiveState,
    type ModuleEditMode,
    SYSTEM_STATE_KEYS,
    type SystemStateKey,
} from "./appearanceModuleState";

function stateLabel(state: SystemStateKey): string {
    return state.charAt(0).toUpperCase() + state.slice(1);
}

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    moduleKeys: readonly string[];
    mode: ModuleEditMode;
    onModeChange: (next: ModuleEditMode) => void;
};

function chipClass(active: boolean): string {
    return [
        "rounded px-1.5 py-0.5 text-[10px] font-medium border transition shrink-0",
        active
            ? "border-primary/60 bg-primary/15 text-primary"
            : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200",
    ].join(" ");
}

/**
 * Per compact module: switch default vs exclusive system-state rows; add/remove state rows via context menu.
 */
export function CompactModuleStateHeader({ variant, commitVariant, moduleKeys, mode, onModeChange }: Props) {
    const [pendingRemove, setPendingRemove] = useState<SystemStateKey | null>(null);

    const presentStates = useMemo(
        () => listModuleExclusiveStatesPresent(variant, moduleKeys),
        [variant, moduleKeys]
    );

    // Hide the Default chip when it is the only option; still show if mode is stuck on a removed state.
    const showDefaultChip = presentStates.length > 0 || mode !== "default";

    const menu = useMemo((): ContextMenuDef => {
        return SYSTEM_STATE_KEYS.map(state => {
            const exists = moduleFullyHasExclusiveState(variant, moduleKeys, state);
            return {
                id: `state-${state}`,
                label: exists ? `Remove ${stateLabel(state)}` : `Add ${stateLabel(state)}`,
                onClick: () => {
                    if (exists) {
                        setPendingRemove(state);
                    } else {
                        const next = ensureModuleExclusiveState(variant, moduleKeys, state);
                        commitVariant(next);
                        onModeChange(state);
                    }
                },
            };
        });
    }, [variant, moduleKeys, commitVariant, onModeChange]);

    const handleConfirmRemove = () => {
        if (!pendingRemove) {
            return;
        }
        const next = removeModuleExclusiveState(variant, moduleKeys, pendingRemove);
        commitVariant(next);
        if (mode === pendingRemove) {
            onModeChange("default");
        }
        setPendingRemove(null);
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-1 justify-end min-w-0">
                {showDefaultChip ? (
                    <button
                        type="button"
                        className={chipClass(mode === "default")}
                        onClick={() => onModeChange("default")}
                    >
                        Default
                    </button>
                ) : null}
                {presentStates.map(s => (
                    <button key={s} type="button" className={chipClass(mode === s)} onClick={() => onModeChange(s)}>
                        {stateLabel(s)}
                    </button>
                ))}
                <InlineMenuTriggerButton menu={menu} ariaLabel="Add or remove state override" className="shrink-0" />
            </div>
            <ConfirmModal
                isOpen={pendingRemove !== null}
                onClose={() => setPendingRemove(null)}
                onConfirm={handleConfirmRemove}
                title="Remove state override"
                message={
                    pendingRemove
                        ? `Remove all ${stateLabel(pendingRemove)} overrides for this module? This cannot be undone.`
                        : ""
                }
                confirmText="Remove"
                cancelText="Cancel"
                variant="danger"
            />
        </>
    );
}
