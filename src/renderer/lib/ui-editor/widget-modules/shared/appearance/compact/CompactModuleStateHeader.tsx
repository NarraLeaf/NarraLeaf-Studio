import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ConfirmModal } from "@/lib/components/elements/Modal";
import type { AppearanceVariant } from "@shared/types/ui-editor/appearance";
import { InlineMenuTriggerButton } from "@/lib/ui-editor/widget-modules/shared/chrome/InlineMenuTriggerButton";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import {
    ensureModuleExclusiveState,
    listModuleExclusiveStatesPresent,
    moduleFullyHasExclusiveState,
    removeModuleExclusiveState,
    type ModuleEditMode,
    SYSTEM_STATE_KEYS,
    type SystemStateKey,
} from "./appearanceModuleState";

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    moduleKeys: readonly string[];
    mode: ModuleEditMode;
    onModeChange: (next: ModuleEditMode) => void;
};

function chipClass(active: boolean): string {
    return [
        // `cursor-default` because these are `<span role="button">`s: a span over text would
        // otherwise show the I-beam a `<button>` never does. Same for every other chrome in here.
        "rounded-md px-1.5 py-0.5 text-2xs font-medium border transition shrink-0 cursor-default",
        active
            ? "border-primary/60 bg-primary/15 text-primary"
            : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
    ].join(" ");
}

/**
 * Per compact module: switch default vs exclusive system-state rows; add/remove state rows via context menu.
 *
 * **The chips only switch which rows the module SHOWS**, so they are {@link InspectOnlyButton}s and
 * survive the `<fieldset disabled>` a frozen workspace puts around this field - reading what an
 * element looks like when hovered is reading. The menu beside them adds and removes overrides, which
 * writes the document, so it stays an ordinary button and the clamp reaches it.
 */
export function CompactModuleStateHeader({ variant, commitVariant, moduleKeys, mode, onModeChange }: Props) {
    const { t } = useTranslation();
    const stateLabel = (state: SystemStateKey): string => t(`widgetAppearance.states.${state}`);
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
                label: exists
                    ? t("widgetAppearance.states.removeOverride", { state: stateLabel(state) })
                    : t("widgetAppearance.states.addOverride", { state: stateLabel(state) }),
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
    }, [variant, moduleKeys, commitVariant, onModeChange, t]);

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
                    <InspectOnlyButton
                        className={chipClass(mode === "default")}
                        onClick={() => onModeChange("default")}
                    >
                        {t("widgetAppearance.states.default")}
                    </InspectOnlyButton>
                ) : null}
                {presentStates.map(s => (
                    <InspectOnlyButton key={s} className={chipClass(mode === s)} onClick={() => onModeChange(s)}>
                        {stateLabel(s)}
                    </InspectOnlyButton>
                ))}
                <InlineMenuTriggerButton
                    menu={menu}
                    ariaLabel={t("widgetAppearance.states.addRemoveAria")}
                    className="shrink-0"
                />
            </div>
            <ConfirmModal
                isOpen={pendingRemove !== null}
                onClose={() => setPendingRemove(null)}
                onConfirm={handleConfirmRemove}
                title={t("widgetAppearance.states.removeOverrideTitle")}
                message={
                    pendingRemove
                        ? t("widgetAppearance.states.removeConfirm", { state: stateLabel(pendingRemove) })
                        : ""
                }
                confirmText={t("common.remove")}
                cancelText={t("common.cancel")}
                variant="danger"
            />
        </>
    );
}
