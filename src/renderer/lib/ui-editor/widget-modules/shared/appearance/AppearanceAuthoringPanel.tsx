import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorEnteredState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import { useTranslation } from "@/lib/i18n";
import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearancePropertyGroup,
    AppearancePropertyKey,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { ensureVariantExists, replaceVariant, setGroupTransitionOnAllVariants } from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { CompactContainerAppearance } from "./compact/CompactContainerAppearance";
import { CompactButtonAppearance } from "./compact/CompactButtonAppearance";
import { CompactTextAppearance } from "./compact/CompactTextAppearance";
import { moduleHasAnyAppearanceTransitionInModel } from "./appearanceMotion";
import { AppearanceReadOnlyProvider } from "./appearanceReadOnly";
import { AppearancePositionInLayoutProvider } from "./appearancePositionOwner";
import { findStateHost } from "./stateHost";
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
    /**
     * The inspector field's own `readOnly`, forwarded so the parts of this panel that render outside
     * the field's clamped subtree can honour it - see {@link AppearanceReadOnlyProvider}.
     */
    readOnly?: boolean;
};

export function AppearanceAuthoringPanel({
    kind,
    appearance,
    onReplace,
    inspectorData,
    draftResetKey,
    readOnly = false,
}: AppearanceAuthoringPanelProps) {
    const { t } = useTranslation();
    const elementId = inspectorData.element.id;
    const entered = useEditorEnteredState();
    // Which state this panel edits is not its own decision: the state bar above it enters one, the
    // canvas draws that one, and these modules edit that one. Keeping a second selection here is how
    // an author ends up editing a state they cannot see.
    //
    // Entered on an ancestor counts. A switch's parts are drawn in the switch's state, so with the
    // switch turned on the canvas shows the track's on variant - and a panel still editing the
    // resting one takes the author's new colour and puts it where they are not looking.
    const stateHost = useMemo(
        () => findStateHost(inspectorData.documentService.getDocument(), elementId),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [elementId, inspectorData.documentService, draftResetKey],
    );
    const stateOwnerId = entered?.elementId === elementId ? elementId : stateHost?.element.id ?? null;
    const shownVariantId = isUsableAppearanceModel(appearance)
        ? entered && entered.elementId === stateOwnerId
            ? entered.variantId ?? appearance.defaultVariantId
            : appearance.defaultVariantId
        : "";
    /** The state's name, for the variant this panel creates the first time it is edited in one. */
    const shownStateName =
        stateHost?.states.find(state => state.id === shownVariantId)?.name ?? shownVariantId;
    const selectedVariantId = shownVariantId;

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

    const model = appearance;
    const selectedVariant = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return null;
        }
        const own = model.variants.find(v => v.id === selectedVariantId);
        if (own) {
            return own;
        }
        // A part that has never been given a look in this state shows the resting one, so the fields
        // start from what is on screen; the first edit is what gives the state a variant of its own.
        const resting = model.variants.find(v => v.id === model.defaultVariantId) ?? model.variants[0] ?? null;
        return resting ? { ...resting, id: selectedVariantId, name: shownStateName } : null;
    }, [model, selectedVariantId, shownStateName]);

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
            onReplace(
                replaceVariant(
                    ensureVariantExists(model, selectedVariant.id, shownStateName),
                    selectedVariant.id,
                    nextVariant,
                ),
            );
        },
        [model, onReplace, selectedVariant, shownStateName]
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
            <p className="text-xs text-warning leading-relaxed px-1 py-2">
                {t("widgetAppearance.panel.invalidModel")}
            </p>
        );
    }

    // Named rather than returned directly so the provider can wrap it without re-indenting the whole
    // panel; nothing else about the tree changes.
    const body = (
        <div className="space-y-3 min-w-0">
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

    return (
        <AppearanceReadOnlyProvider value={readOnly}>
            <AppearancePositionInLayoutProvider value={stateHost !== null}>{body}</AppearancePositionInLayoutProvider>
        </AppearanceReadOnlyProvider>
    );
}
