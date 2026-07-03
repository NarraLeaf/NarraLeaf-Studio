import { useEffect, useMemo, useState } from "react";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import type { UIStageSlotId, UISurfaceDesignSize, UISurfaceKind } from "@shared/types/ui-editor/document";
import { GAME_UI_SLOT_OPTIONS, STAGE_SLOT_LABELS } from "../constants";

export type CreateSurfaceDialogValue = {
    name: string;
    designSize?: UISurfaceDesignSize;
    slotId?: UIStageSlotId;
    valid: boolean;
};

type CreateSurfaceDialogContentProps = {
    kind: UISurfaceKind;
    defaultName: string;
    defaultDesignSize: UISurfaceDesignSize;
    defaultSlotId: UIStageSlotId;
    disabledSlotIds?: readonly UIStageSlotId[];
    onChange: (value: CreateSurfaceDialogValue) => void;
};

const parsePositiveInteger = (value: string): number | null => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
};

export function CreateSurfaceDialogContent({
    kind,
    defaultName,
    defaultDesignSize,
    defaultSlotId,
    disabledSlotIds = [],
    onChange,
}: CreateSurfaceDialogContentProps) {
    const [name, setName] = useState(defaultName);
    const [width, setWidth] = useState(String(defaultDesignSize.width));
    const [height, setHeight] = useState(String(defaultDesignSize.height));
    const [slotId, setSlotId] = useState<UIStageSlotId>(defaultSlotId);

    const widthValue = useMemo(() => parsePositiveInteger(width), [width]);
    const heightValue = useMemo(() => parsePositiveInteger(height), [height]);
    const isPage = kind === "appSurface";
    const pageValid = name.trim().length > 0 && widthValue != null && heightValue != null;
    const gameUiName = `${STAGE_SLOT_LABELS[slotId] ?? slotId} UI`;
    const disabledSlots = useMemo(() => new Set(disabledSlotIds), [disabledSlotIds]);
    const gameUiValid = !disabledSlots.has(slotId);

    useEffect(() => {
        onChange(
            isPage
                ? {
                      name: name.trim(),
                      designSize: widthValue != null && heightValue != null
                          ? { width: widthValue, height: heightValue }
                          : undefined,
                      valid: pageValid,
                  }
                : {
                      name: gameUiName,
                      slotId,
                      valid: gameUiValid,
                  },
        );
    }, [gameUiName, gameUiValid, heightValue, isPage, name, onChange, pageValid, slotId, widthValue]);

    if (!isPage) {
        return (
            <div className="space-y-4">
                <div className="text-sm text-gray-400">Choose where this Game UI belongs during gameplay.</div>
                <div className="grid gap-2">
                    {GAME_UI_SLOT_OPTIONS.map(option => {
                        const isActive = slotId === option.value;
                        const disabled = disabledSlots.has(option.value);
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                    if (!disabled) {
                                        setSlotId(option.value);
                                    }
                                }}
                                className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                                    isActive
                                        ? "border-primary bg-primary/10 text-white"
                                        : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                                } ${disabled ? "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-transparent" : ""}`}
                            >
                                <div className="font-semibold">{option.label}</div>
                                <div className="text-[11px] text-gray-400">
                                    {disabled ? "Already created. Open the existing Game UI from the list." : option.description}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="text-xs text-gray-500">
                    Game UI uses the project resolution: {defaultDesignSize.width}×{defaultDesignSize.height}.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <InputGroup label="Name" required error={name.trim().length === 0 ? "Name is required" : undefined}>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                    fullWidth
                    autoFocus
                />
            </InputGroup>
            <div className="grid grid-cols-2 gap-3">
                <InputGroup label="Width" required error={widthValue == null ? "Use a positive integer" : undefined}>
                    <Input
                        type="number"
                        min={1}
                        value={width}
                        onChange={event => setWidth(event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                        fullWidth
                    />
                </InputGroup>
                <InputGroup label="Height" required error={heightValue == null ? "Use a positive integer" : undefined}>
                    <Input
                        type="number"
                        min={1}
                        value={height}
                        onChange={event => setHeight(event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                        fullWidth
                    />
                </InputGroup>
            </div>
        </div>
    );
}
