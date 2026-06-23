import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceRowValue,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
import type { VisualEffectKind } from "@shared/types/ui-editor/effects";
import { EFFECT_APPEARANCE_KEY_BY_KIND } from "@shared/types/ui-editor/effects";
import { EffectsStackEditor } from "@/lib/ui-editor/widget-modules/shared/effects/EffectsStackEditor";
import { diffPatchElementEffectValues, readElementEffectValuesFromGetter } from "@/lib/ui-editor/widget-modules/shared/effects/effectValuesBridge";
import {
    getRowValueForModuleEdit,
    type ModuleEditMode,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    draftResetKey: string;
    moduleKeys: readonly AppearancePropertyKey[];
    editMode: ModuleEditMode;
    onModeChange: (mode: ModuleEditMode) => void;
    motionVisible: boolean;
    onMotionVisibleChange: (visible: boolean) => void;
    moduleMotionFieldsConfigured: boolean;
    supportedKinds: readonly VisualEffectKind[];
};

export function CompactEffectsAppearance({
    variant,
    commitVariant,
    setFieldTransition,
    draftResetKey,
    moduleKeys,
    editMode,
    onModeChange,
    motionVisible,
    onMotionVisibleChange,
    moduleMotionFieldsConfigured,
    supportedKinds,
}: Props) {
    const get = (key: AppearancePropertyKey) => getRowValueForModuleEdit(variant, key, editMode);
    const patch = (key: AppearancePropertyKey, value: AppearanceRowValue) => {
        commitVariant(updateRowValueForModuleEditOrEnsure(variant, moduleKeys, key, editMode, value));
    };

    const includeTextShadow = supportedKinds.includes("textShadow");
    const values = readElementEffectValuesFromGetter(get, { includeTextShadow });
    const onValuesChange = (next: typeof values) => {
        diffPatchElementEffectValues(values, next, patch, { includeTextShadow });
    };

    return (
        <CompactModuleCard
            title="Effects"
            headerHoverAction={
                <ModuleMotionMenuButton
                    enabled={motionVisible}
                    hasConfiguredFields={moduleMotionFieldsConfigured}
                    onEnabledChange={onMotionVisibleChange}
                />
            }
            headerRight={
                <CompactModuleStateHeader
                    variant={variant}
                    commitVariant={commitVariant}
                    moduleKeys={moduleKeys}
                    mode={editMode}
                    onModeChange={onModeChange}
                />
            }
        >
            <EffectsStackEditor
                values={values}
                onChange={onValuesChange}
                supportedKinds={supportedKinds}
                draftResetKey={draftResetKey}
                renderTrailingOnRow={kind =>
                    motionVisible ? (
                        <AppearanceFieldMotionButton
                            variant={variant}
                            setFieldTransition={setFieldTransition}
                            groupKey={EFFECT_APPEARANCE_KEY_BY_KIND[kind] as AppearancePropertyKey}
                            draftResetKey={draftResetKey}
                        />
                    ) : null
                }
            />
        </CompactModuleCard>
    );
}
