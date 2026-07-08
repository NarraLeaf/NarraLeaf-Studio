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
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { CompactContainerAppearance } from "./compact/CompactContainerAppearance";
import { CompactButtonAppearance } from "./compact/CompactButtonAppearance";
import { CompactTextAppearance } from "./compact/CompactTextAppearance";
import { moduleHasAnyAppearanceTransitionInModel } from "./appearanceMotion";
import {
    BUTTON_MODULE_KEYS as BUTTON_KEYS,
    CONTAINER_MODULE_KEYS as CONTAINER_KEYS,
    TEXT_MODULE_KEYS as TEXT_KEYS,
} from "./compact/appearanceModuleState";
import type {
    ButtonAppearanceModuleId,
    ContainerAppearanceModuleId,
    ModuleEditMode,
    TextAppearanceModuleId,
} from "./compact/appearanceModuleState";

const DEFAULT_CONTAINER_MODULE_MODES: Record<ContainerAppearanceModuleId, ModuleEditMode> = {
    background: "default",
    stroke: "default",
    corners: "default",
    transform: "default",
    effects: "default",
};

const DEFAULT_BUTTON_MODULE_MODES: Record<ButtonAppearanceModuleId, ModuleEditMode> = {
    background: "default",
    border: "default",
    spacing: "default",
    transform: "default",
    effects: "default",
};

const DEFAULT_TEXT_MODULE_MODES: Record<TextAppearanceModuleId, ModuleEditMode> = {
    typography: "default",
    transform: "default",
    effects: "default",
};

const DEFAULT_CONTAINER_MOTION_VISIBILITY: Record<ContainerAppearanceModuleId, boolean> = {
    background: false,
    stroke: false,
    corners: false,
    transform: false,
    effects: false,
};

const DEFAULT_BUTTON_MOTION_VISIBILITY: Record<ButtonAppearanceModuleId, boolean> = {
    background: false,
    border: false,
    spacing: false,
    transform: false,
    effects: false,
};

const DEFAULT_TEXT_MOTION_VISIBILITY: Record<TextAppearanceModuleId, boolean> = {
    typography: false,
    transform: false,
    effects: false,
};

function deriveContainerMotionVisibility(model: AppearanceModel): Record<ContainerAppearanceModuleId, boolean> {
    return {
        background: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.background),
        stroke: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.stroke),
        corners: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.corners),
        transform: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.transform),
        effects: moduleHasAnyAppearanceTransitionInModel(model, CONTAINER_KEYS.effects),
    };
}

function deriveButtonMotionVisibility(model: AppearanceModel): Record<ButtonAppearanceModuleId, boolean> {
    return {
        background: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.background),
        border: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.border),
        spacing: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.spacing),
        transform: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.transform),
        effects: moduleHasAnyAppearanceTransitionInModel(model, BUTTON_KEYS.effects),
    };
}

function deriveTextMotionVisibility(model: AppearanceModel): Record<TextAppearanceModuleId, boolean> {
    return {
        typography: moduleHasAnyAppearanceTransitionInModel(model, TEXT_KEYS.typography),
        transform: moduleHasAnyAppearanceTransitionInModel(model, TEXT_KEYS.transform),
        effects: moduleHasAnyAppearanceTransitionInModel(model, TEXT_KEYS.effects),
    };
}

export type AppearanceAuthoringPanelProps = {
    kind: "container" | "button" | "image" | "text";
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
    const [textModuleModes, setTextModuleModes] = useState(DEFAULT_TEXT_MODULE_MODES);
    const [containerMotionVisibility, setContainerMotionVisibility] = useState(DEFAULT_CONTAINER_MOTION_VISIBILITY);
    const [buttonMotionVisibility, setButtonMotionVisibility] = useState(DEFAULT_BUTTON_MOTION_VISIBILITY);
    const [textMotionVisibility, setTextMotionVisibility] = useState(DEFAULT_TEXT_MOTION_VISIBILITY);

    const setContainerModuleMode = useCallback((module: ContainerAppearanceModuleId, mode: ModuleEditMode) => {
        setContainerModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setButtonModuleMode = useCallback((module: ButtonAppearanceModuleId, mode: ModuleEditMode) => {
        setButtonModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setTextModuleMode = useCallback((module: TextAppearanceModuleId, mode: ModuleEditMode) => {
        setTextModuleModes(prev => ({ ...prev, [module]: mode }));
    }, []);

    const setContainerMotionVisible = useCallback((module: ContainerAppearanceModuleId, visible: boolean) => {
        setContainerMotionVisibility(prev => ({ ...prev, [module]: visible }));
    }, []);

    const setButtonMotionVisible = useCallback((module: ButtonAppearanceModuleId, visible: boolean) => {
        setButtonMotionVisibility(prev => ({ ...prev, [module]: visible }));
    }, []);

    const setTextMotionVisible = useCallback((module: TextAppearanceModuleId, visible: boolean) => {
        setTextMotionVisibility(prev => ({ ...prev, [module]: visible }));
    }, []);

    useEffect(() => {
        setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
        setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
        setTextModuleModes(DEFAULT_TEXT_MODULE_MODES);
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

    const textMotionFieldsConfigured = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return DEFAULT_TEXT_MOTION_VISIBILITY;
        }
        return deriveTextMotionVisibility(model);
    }, [model]);

    useEffect(() => {
        if (!isUsableAppearanceModel(model)) {
            return;
        }
        setContainerMotionVisibility(deriveContainerMotionVisibility(model));
        setButtonMotionVisibility(deriveButtonMotionVisibility(model));
        setTextMotionVisibility(deriveTextMotionVisibility(model));
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
        // Include variant id so draft-backed inputs (NumericDraftEnhancedInput, etc.) reset when switching variants.
        const variantSeg = selectedVariantId ? `|v:${selectedVariantId}` : "";
        if (kind === "button") {
            return `${draftResetKey}${variantSeg}|b:${buttonModuleModes.background}|${buttonModuleModes.border}|${buttonModuleModes.spacing}|${buttonModuleModes.transform}|${buttonModuleModes.effects}`;
        }
        if (kind === "text") {
            return `${draftResetKey}${variantSeg}|t:${textModuleModes.typography}|${textModuleModes.transform}|${textModuleModes.effects}`;
        }
        return `${draftResetKey}${variantSeg}|c:${containerModuleModes.background}|${containerModuleModes.stroke}|${containerModuleModes.corners}|${containerModuleModes.transform}|${containerModuleModes.effects}`;
    }, [draftResetKey, kind, selectedVariantId, containerModuleModes, buttonModuleModes, textModuleModes]);

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

    const variantOptions = model.variants.map(v => ({ value: v.id, label: v.name || "Untitled variant" }));

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
        setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
        setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
        setTextModuleModes(DEFAULT_TEXT_MODULE_MODES);
    };

    const handleRemoveVariant = () => {
        if (!selectedVariant || model.variants.length <= 1) {
            return;
        }
        const removedId = selectedVariant.id;
        const nextModel = removeVariant(model, removedId);
        onReplace(nextModel);
        setSelectedVariantId(nextModel.defaultVariantId);
        setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
        setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
        setTextModuleModes(DEFAULT_TEXT_MODULE_MODES);
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
                        onChange={v => {
                            const id = String(v);
                            setSelectedVariantId(id);
                            setContainerModuleModes(DEFAULT_CONTAINER_MODULE_MODES);
                            setButtonModuleModes(DEFAULT_BUTTON_MODULE_MODES);
                            setTextModuleModes(DEFAULT_TEXT_MODULE_MODES);
                        }}
                    />
                </div>
                <button
                    type="button"
                    title="Add variant (duplicate current)"
                    onClick={handleAddVariant}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-fill-subtle text-fg-muted hover:bg-fill"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Set as default variant"
                    onClick={handleSetDefault}
                    disabled={!selectedVariant || model.defaultVariantId === selectedVariant.id}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-fill-subtle text-fg-muted hover:bg-fill disabled:opacity-40"
                >
                    <Star className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Delete variant"
                    onClick={handleRemoveVariant}
                    disabled={model.variants.length <= 1}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-fill-subtle text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            <div className="min-w-0">
                <label className="text-2xs tracking-wide text-fg-subtle block mb-1">Variant name</label>
                <EnhancedInput
                    key={selectedVariant?.id}
                    value={selectedVariant?.name ?? ""}
                    onChange={handleRenameVariant}
                    className="text-xs"
                />
            </div>

            {selectedVariant && (
                <>
                    {kind === "button" ? (
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
                    ) : kind === "text" ? (
                        <CompactTextAppearance
                            variant={selectedVariant}
                            commitVariant={commitVariant}
                            setFieldTransition={setFieldTransition}
                            draftResetKey={appearanceDraftResetKey}
                            inspectorData={inspectorData}
                            onSaving={() => {}}
                            textModuleModes={textModuleModes}
                            setTextModuleMode={setTextModuleMode}
                            textMotionVisibility={textMotionVisibility}
                            setTextMotionVisible={setTextMotionVisible}
                            motionFieldsConfigured={textMotionFieldsConfigured}
                        />
                    ) : (
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
                            resolveInspectorRectangleLike={
                                kind === "image" ? getImageWidgetRectangleProps : undefined
                            }
                        />
                    )}
                </>
            )}
        </div>
    );
}
