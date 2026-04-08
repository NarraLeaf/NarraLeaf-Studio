import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import type { AppearanceModel, AppearancePropertyGroup, AppearanceVariant } from "@shared/types/ui-editor/appearance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import {
    addVariant,
    newVariantId,
    removeVariant,
    renameVariant,
    replaceVariant,
    setDefaultVariantId,
} from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { CompactContainerAppearance } from "./compact/CompactContainerAppearance";
import { CompactButtonAppearance } from "./compact/CompactButtonAppearance";
import type {
    ButtonAppearanceModuleId,
    ContainerAppearanceModuleId,
    ModuleEditMode,
} from "./compact/appearanceModuleState";

const DEFAULT_CONTAINER_MODULE_MODES: Record<ContainerAppearanceModuleId, ModuleEditMode> = {
    background: "default",
    stroke: "default",
    corners: "default",
};

const DEFAULT_BUTTON_MODULE_MODES: Record<ButtonAppearanceModuleId, ModuleEditMode> = {
    background: "default",
    border: "default",
    spacing: "default",
};

export type AppearanceAuthoringPanelProps = {
    kind: "container" | "button";
    appearance: AppearanceModel | null | undefined;
    onReplace: (next: AppearanceModel) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
};

function cloneVariantShallow(source: AppearanceVariant, id: string, name: string): AppearanceVariant {
    return {
        id,
        name,
        propertyGroups: JSON.parse(JSON.stringify(source.propertyGroups)) as AppearancePropertyGroup[],
    };
}

export function AppearanceAuthoringPanel({
    kind,
    appearance,
    onReplace,
    inspectorData,
    draftResetKey,
}: AppearanceAuthoringPanelProps) {
    const [selectedVariantId, setSelectedVariantId] = useState<string>(() =>
        isUsableAppearanceModel(appearance) ? appearance.defaultVariantId : ""
    );

    const [containerModuleModes, setContainerModuleModes] = useState(DEFAULT_CONTAINER_MODULE_MODES);
    const [buttonModuleModes, setButtonModuleModes] = useState(DEFAULT_BUTTON_MODULE_MODES);

    const setContainerModuleMode = useCallback((module: ContainerAppearanceModuleId, mode: ModuleEditMode) => {
        setContainerModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setButtonModuleMode = useCallback((module: ButtonAppearanceModuleId, mode: ModuleEditMode) => {
        setButtonModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    useEffect(() => {
        setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
        setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
    }, [draftResetKey, selectedVariantId]);

    useEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        setSelectedVariantId(prev =>
            appearance.variants.some(v => v.id === prev) ? prev : appearance.defaultVariantId
        );
    }, [appearance]);

    const model = appearance;
    const selectedVariant = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return null;
        }
        return model.variants.find(v => v.id === selectedVariantId) ?? model.variants[0] ?? null;
    }, [model, selectedVariantId]);

    const commitVariant = useCallback(
        (nextVariant: AppearanceVariant) => {
            if (!isUsableAppearanceModel(model) || !selectedVariant) {
                return;
            }
            onReplace(replaceVariant(model, selectedVariant.id, nextVariant));
        },
        [model, onReplace, selectedVariant]
    );

    if (!isUsableAppearanceModel(model)) {
        return (
            <p className="text-xs text-amber-200/90 leading-relaxed px-1 py-2">
                Appearance data is missing or invalid for this element. This editor requires a serialized appearance
                model. Create a new element from the palette to get a valid appearance block.
            </p>
        );
    }

    const variantOptions = model.variants.map(v => ({ value: v.id, label: v.name || v.id }));

    const handleAddVariant = () => {
        const base = selectedVariant ?? model.variants[0];
        if (!base) {
            return;
        }
        const id = newVariantId();
        const nextName = `Variant ${model.variants.length + 1}`;
        const variant = cloneVariantShallow(base, id, nextName);
        onReplace(addVariant(model, variant));
        setSelectedVariantId(id);
    };

    const handleRemoveVariant = () => {
        if (!selectedVariant || model.variants.length <= 1) {
            return;
        }
        const removedId = selectedVariant.id;
        const nextModel = removeVariant(model, removedId);
        onReplace(nextModel);
        setSelectedVariantId(nextModel.defaultVariantId);
    };

    const handleSetDefault = () => {
        if (!selectedVariant) {
            return;
        }
        onReplace(setDefaultVariantId(model, selectedVariant.id));
    };

    const handleRenameVariant = (raw: string) => {
        if (!selectedVariant) {
            return;
        }
        onReplace(renameVariant(model, selectedVariant.id, raw));
    };

    return (
        <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap gap-2 items-center min-w-0">
                <div className="flex-1 min-w-[8rem]">
                    <Select
                        value={selectedVariant?.id ?? ""}
                        options={variantOptions}
                        fullWidth
                        onChange={v => setSelectedVariantId(String(v))}
                    />
                </div>
                <button
                    type="button"
                    title="Add variant (duplicate current)"
                    onClick={handleAddVariant}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Set as default variant"
                    onClick={handleSetDefault}
                    disabled={!selectedVariant || model.defaultVariantId === selectedVariant.id}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40"
                >
                    <Star className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Delete variant"
                    onClick={handleRemoveVariant}
                    disabled={model.variants.length <= 1}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            <div className="min-w-0">
                <label className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">Variant name</label>
                <EnhancedInput
                    key={selectedVariant?.id}
                    value={selectedVariant?.name ?? ""}
                    onChange={handleRenameVariant}
                    className="text-xs"
                />
            </div>

            {selectedVariant && (
                <>
                    {kind === "container" ? (
                        <CompactContainerAppearance
                            variant={selectedVariant}
                            commitVariant={commitVariant}
                            inspectorData={inspectorData}
                            draftResetKey={draftResetKey}
                            onSaving={() => {}}
                            containerModuleModes={containerModuleModes}
                            setContainerModuleMode={setContainerModuleMode}
                        />
                    ) : (
                        <CompactButtonAppearance
                            variant={selectedVariant}
                            commitVariant={commitVariant}
                            draftResetKey={draftResetKey}
                            inspectorData={inspectorData}
                            onSaving={() => {}}
                            buttonModuleModes={buttonModuleModes}
                            setButtonModuleMode={setButtonModuleMode}
                        />
                    )}
                </>
            )}
        </div>
    );
}
