import { useEffect, useState } from "react";
import type { UIStageSlotId, UIStageSurfaceMount } from "@shared/types/ui-editor/document";

import { DEFAULT_STAGE_SLOT_ID, STAGE_MOUNT_OPTIONS, STAGE_SLOT_OPTIONS } from "../constants";

type StageSlotSelectionProps = {
    value: UIStageSlotId;
    onChange: (value: UIStageSlotId) => void;
};

const StageSlotSelection = ({ value, onChange }: StageSlotSelectionProps) => (
    <div className="space-y-3">
        <div className="text-sm text-gray-400">
            Choose the slot that determines how this stage surface is injected.
        </div>
        <div className="grid gap-2">
            {STAGE_SLOT_OPTIONS.map(option => {
                const isActive = value === option.value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                            isActive
                                ? "border-primary bg-primary/10 text-white"
                                : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                        }`}
                    >
                        <div className="font-semibold">{option.label}</div>
                        <div className="text-[11px] text-gray-400">{option.description}</div>
                    </button>
                );
            })}
        </div>
    </div>
);

type StageMountDialogContentProps = {
    initial?: UIStageSurfaceMount;
    onChange: (value: UIStageSurfaceMount) => void;
};

export function StageMountDialogContent({ initial, onChange }: StageMountDialogContentProps) {
    const [selectedKind, setSelectedKind] = useState<UIStageSurfaceMount["kind"]>(initial?.kind ?? "persistent");
    const [selectedSlot, setSelectedSlot] = useState<UIStageSlotId>(
        initial?.kind === "slot" ? initial.slotId : DEFAULT_STAGE_SLOT_ID
    );

    useEffect(() => {
        const nextMount =
            selectedKind === "slot"
                ? { kind: "slot", slotId: selectedSlot }
                : ({ kind: selectedKind } as UIStageSurfaceMount);
        onChange(nextMount as UIStageSurfaceMount);
    }, [onChange, selectedKind, selectedSlot]);

    return (
        <div className="space-y-4">
            <div className="text-sm text-gray-400">
                Choose how this stage surface is mounted inside the player.
            </div>
            <div className="grid gap-2">
                {STAGE_MOUNT_OPTIONS.map(option => {
                    const isActive = selectedKind === option.kind;
                    return (
                        <button
                            key={option.kind}
                            type="button"
                            onClick={() => setSelectedKind(option.kind)}
                            className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                                isActive
                                    ? "border-primary bg-primary/10 text-white"
                                    : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                            }`}
                        >
                            <div className="font-semibold">{option.label}</div>
                            <div className="text-[11px] text-gray-400">{option.description}</div>
                        </button>
                    );
                })}
            </div>
            {selectedKind === "slot" && <StageSlotSelection value={selectedSlot} onChange={setSelectedSlot} />}
        </div>
    );
}
