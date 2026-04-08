import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearancePropertyGroup,
    AppearancePropertyKey,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
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
    setGroupTransitionOnAllVariants,
} from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { CompactContainerAppearance } from "./compact/CompactContainerAppearance";
import { CompactButtonAppearance } from "./compact/CompactButtonAppearance";
import { moduleHasAnyAppearanceTransitionInModel } from "./appearanceMotion";
import { BUTTON_MODULE_KEYS as BUTTON_KEYS, CONTAINER_MODULE_KEYS as CONTAINER_KEYS } from "./compact/appearanceModuleState";
import type { ButtonAppearanceModuleId, ContainerAppearanceModuleId, ModuleEditMode } from "./compact/appearanceModuleState";

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

const DEFAULT_CONTAINER_MOTION_VISIBILITY: Record<ContainerAppearanceModuleId, boolean> = {
    background: false,
    stroke: false,
    corners: false,
};

const DEFAULT_BUTTON_MOTION_VISIBILITY: Record<ButtonAppearanceModuleId, boolean> = {
    background: false,
    border: false,
    spacing: false,
};

function deriveContainerMotionVisibility(model: AppearanceModel): Record<ContainerAppearanceModuleId, boolean> {
    return {
        background: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.background),
        stroke: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.stroke),
        corners: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.corners),
    };
}

function deriveButtonMotionVisibility(model: AppearanceModel): Record<ButtonAppearanceModuleId, boolean> {
    return {
        background: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.background),
        border: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.border),
        spacing: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.spacing),
    };
}

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
    const elementId = inspectorData.element.id;
    const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return "";
        }
        const cached = UIEditorStateService.getInstance().getAppearanceInspectorVariant(elementId);
        if (cached && appearance.variants.some(v => v.id === cached)) {
            return cached;
        }
        return appearance.defaultVariantId;
    });

    const [containerModuleModes, setContainerModuleModes] = useState(DEFAULT_CONTAINER_MODULE_MODES);
    const [buttonModuleModes, setButtonModuleModes] = useState(DEFAULT_BUTTON_MODULE_MODES);
    const [containerMotionVisibility, setContainerMotionVisibility] = useState(DEFAULT_CONTAINER_MOTION_VISIBILITY);
    const [buttonMotionVisibility, setButtonMotionVisibility] = useState(DEFAULT_BUTTON_MOTION_VISIBILITY);

    const setContainerModuleMode = useCallback((module: ContainerAppearanceModuleId, mode: ModuleEditMode) => {
        setContainerModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setButtonModuleMode = useCallback((module: ButtonAppearanceModuleId, mode: ModuleEditMode) => {
        setButtonModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setContainerMotionVisible = useCallback((module: ContainerAppearanceModuleId, visible: boolean) => {
        setContainerMotionVisibility(prev => ({ ...prev, [module]: visible }));
    }, []);

    const setButtonMotionVisible = useCallback((module: ButtonAppearanceModuleId, visible: boolean) => {
        setButtonMotionVisibility(prev => ({ ...prev, [module]: visible }));
    }, []);

    useEffect(() => {
        setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
        setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
    }, [draftResetKey, selectedVariantId]);

    useEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        setSelectedVariantId(prev => {
            if (appearance.variants.some(v => v.id === prev)) {
                return prev;
            }
            const cached = UIEditorStateService.getInstance().getAppearanceInspectorVariant(elementId);
            if (cached && appearance.variants.some(v => v.id === cached)) {
                return cached;
            }
            return appearance.defaultVariantId;
        });
    }, [appearance, elementId]);

    useEffect(() => {
        if (!isUsableAppearanceModel(appearance) || !selectedVariantId) {
            return;
        }
        if (!appearance.variants.some(v => v.id === selectedVariantId)) {
            return;
        }
        UIEditorStateService.getInstance().setAppearanceInspectorVariant(elementId, selectedVariantId);
    }, [appearance, selectedVariantId, elementId]);

    const model = appearance;
    const selectedVariant = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return null;
        }
        return model.variants.find(v => v.id === selectedVariantId) ?? model.variants[0] ?? null;
    }, [model, selectedVariantId]);

    const containerMotionFieldsConfigured = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return DEFAULT_CONTAINER_MOTION_VISIBILITY;
        }
        return deriveContainerMotionVisibility(model);
    }, [model]);

    const buttonMotionFieldsConfigured = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return DEFAULT_BUTTON_MOTION_VISIBILITY;
        }
        return deriveButtonMotionVisibility(model);
    }, [model]);

    useEffect(() => {
        if (!isUsableAppearanceModel(model)) {
            return;
        }
        setContainerMotionVisibility(deriveContainerMotionVisibility(model));
        setButtonMotionVisibility(deriveButtonMotionVisibility(model));
        // Intentionally omit `model` from deps: avoid resetting per-module "Animated fields" toggles on every
        // appearance edit; menu `hasConfiguredFields` still tracks the live model via `motionFieldsConfigured`.
    }, [draftResetKey, selectedVariantId]);

    const commitVariant = useCallback(
        (nextVariant: AppearanceVariant) => {
            if (!isUsableAppearanceModel(model) || !selectedVariant) {
                return;
            }
            onReplace(replaceVariant(model, selectedVariant.id, nextVariant));
        },
        [model, onReplace, selectedVariant]
    );

    const appearanceDraftResetKey = useMemo(() => {
        if (kind === "container") {
            return `${draftResetKey}|c:${containerModuleModes.background}|${containerModuleModes.stroke}|${containerModuleModes.corners}`;
        }
        return `${draftResetKey}|b:${buttonModuleModes.background}|${buttonModuleModes.border}|${buttonModuleModes.spacing}`;
    }, [draftResetKey, kind, containerModuleModes, buttonModuleModes]);

    const setFieldTransition = useCallback(
        (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => {
            if (!isUsableAppearanceModel(model)) {
                return;
            }
            onReplace(setGroupTransitionOnAllVariants(model, groupKey, transition));
        },
        [model, onReplace]
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
                            setFieldTransition={setFieldTransition}
                            inspectorData={inspectorData}
                            draftResetKey={appearanceDraftResetKey}
                            onSaving={() => {}}
                            containerModuleModes={containerModuleModes}
                            setContainerModuleMode={setContainerModuleMode}
                            containerMotionVisibility={containerMotionVisibility}
                            setContainerMotionVisible={setContainerMotionVisible}
                            motionFieldsConfigured={containerMotionFieldsConfigured}
                        />
                    ) : (
                        <CompactButtonAppearance
                            variant={selectedVariant}
                            commitVariant={commitVariant}
                            setFieldTransition={setFieldTransition}
                            draftResetKey={appearanceDraftResetKey}
                            inspectorData={inspectorData}
                            onSaving={() => {}}
                            buttonModuleModes={buttonModuleModes}
                            setButtonModuleMode={setButtonModuleMode}
                            buttonMotionVisibility={buttonMotionVisibility}
                            setButtonMotionVisible={setButtonMotionVisible}
                            motionFieldsConfigured={buttonMotionFieldsConfigured}
                        />
                    )}
                </>
            )}
        </div>
    );
}
