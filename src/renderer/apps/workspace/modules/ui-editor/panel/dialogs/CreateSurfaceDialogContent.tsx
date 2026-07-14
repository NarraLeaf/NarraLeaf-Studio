import { useEffect, useMemo, useState } from "react";
import { Input, InputGroup } from "@/lib/components/elements/Input";
import type { UIStageSlotId, UISurfaceDesignSize, UISurfaceKind } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
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
    const { t } = useTranslation();
    const [name, setName] = useState(defaultName);
    const [width, setWidth] = useState(String(defaultDesignSize.width));
    const [height, setHeight] = useState(String(defaultDesignSize.height));
    const [slotId, setSlotId] = useState<UIStageSlotId>(defaultSlotId);

    const widthValue = useMemo(() => parsePositiveInteger(width), [width]);
    const heightValue = useMemo(() => parsePositiveInteger(height), [height]);
    const isPage = kind === "appSurface";
    const pageValid = name.trim().length > 0 && widthValue != null && heightValue != null;
    const gameUiName = t("uiEditor.naming.gameUi", { slot: STAGE_SLOT_LABELS[slotId] ?? slotId });
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
                <div className="text-sm text-fg-muted">{t("uiEditor.createDialog.slotIntro")}</div>
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
                                        : "border-edge text-fg-muted hover:border-edge-strong hover:bg-fill-subtle"
                                } ${disabled ? "cursor-not-allowed opacity-45 hover:border-edge hover:bg-transparent" : ""}`}
                            >
                                <div className="font-semibold">{option.label}</div>
                                <div className="text-2xs text-fg-muted">
                                    {disabled ? t("uiEditor.createDialog.slotAlreadyCreated") : option.description}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="text-xs text-fg-subtle">
                    {t("uiEditor.createDialog.resolutionNote", {
                        width: defaultDesignSize.width,
                        height: defaultDesignSize.height,
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <InputGroup label={t("common.name")} required error={name.trim().length === 0 ? t("uiEditor.createDialog.nameRequired") : undefined}>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    onKeyDown={event => event.stopPropagation()}
                    fullWidth
                    autoFocus
                />
            </InputGroup>
            <div className="grid grid-cols-2 gap-3">
                <InputGroup label={t("uiEditor.createDialog.width")} required error={widthValue == null ? t("uiEditor.createDialog.positiveIntegerError") : undefined}>
                    <Input
                        type="number"
                        min={1}
                        value={width}
                        onChange={event => setWidth(event.target.value)}
                        onKeyDown={event => event.stopPropagation()}
                        fullWidth
                    />
                </InputGroup>
                <InputGroup label={t("uiEditor.createDialog.height")} required error={heightValue == null ? t("uiEditor.createDialog.positiveIntegerError") : undefined}>
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
