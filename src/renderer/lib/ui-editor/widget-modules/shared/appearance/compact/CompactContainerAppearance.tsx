import { useEffect } from "react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIElement } from "@shared/types/ui-editor/document";
import { getSupportedEffectKindsForWidgetType } from "@shared/types/ui-editor/effects";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceRowValue,
    AppearanceVariant,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { RectangleLikeProps, StrokeJoin } from "@shared/types/ui-editor/rectangleLike";
import { Droplets, Maximize2, Move } from "lucide-react";
import { CornerIcon, STROKE_ALIGN_OPTIONS, STROKE_JOIN_OPTIONS, controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import {
    CONTAINER_MODULE_KEYS,
    type ContainerAppearanceModuleId,
    getRowValueForModuleEdit,
    moduleFullyHasExclusiveState,
    type ModuleEditMode,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";
import { CompactBackgroundAppearance } from "./CompactBackgroundAppearance";
import { BorderStrokeCompactRows } from "./BorderStrokeCompactRows";
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";
import { CompactEffectsAppearance } from "./CompactEffectsAppearance";

type Props = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
    onSaving: (saving: boolean) => void;
    containerModuleModes: Record<ContainerAppearanceModuleId, ModuleEditMode>;
    setContainerModuleMode: (module: ContainerAppearanceModuleId, mode: ModuleEditMode) => void;
    containerMotionVisibility: Record<ContainerAppearanceModuleId, boolean>;
    setContainerMotionVisible: (module: ContainerAppearanceModuleId, visible: boolean) => void;
    /** Per-module: any variant has motion on an animatable key in that module. */
    motionFieldsConfigured: Record<ContainerAppearanceModuleId, boolean>;
    /** Baseline for image-fill preview (default: flat rectangle props on element). */
    resolveInspectorRectangleLike?: (element: UIElement) => RectangleLikeProps;
};

function patchManyInModule(
    variant: AppearanceVariant,
    moduleKeys: readonly ContainerAppearancePropertyKey[],
    editMode: ModuleEditMode,
    updates: { key: ContainerAppearancePropertyKey; value: AppearanceRowValue }[]
): AppearanceVariant {
    let v = variant;
    for (const u of updates) {
        v = updateRowValueForModuleEditOrEnsure(v, moduleKeys, u.key, editMode, u.value);
    }
    return v;
}

export function CompactContainerAppearance({
    variant,
    commitVariant,
    setFieldTransition,
    inspectorData,
    draftResetKey,
    onSaving,
    containerModuleModes,
    setContainerModuleMode,
    containerMotionVisibility,
    setContainerMotionVisible,
    motionFieldsConfigured,
    resolveInspectorRectangleLike = getRectangleLikeProps,
}: Props) {
    const rl = resolveInspectorRectangleLike(inspectorData.element);

    const backgroundMode = containerModuleModes.background;
    const strokeMode = containerModuleModes.stroke;
    const cornersMode = containerModuleModes.corners;
    const transformMode = containerModuleModes.transform;
    const effectsMode = containerModuleModes.effects;
    const backgroundMotionVisible = containerMotionVisibility.background;
    const strokeMotionVisible = containerMotionVisibility.stroke;
    const cornersMotionVisible = containerMotionVisibility.corners;
    const transformMotionVisible = containerMotionVisibility.transform;
    const effectsMotionVisible = containerMotionVisibility.effects;

    useEffect(() => {
        (["background", "stroke", "corners", "transform", "effects"] as const).forEach(mid => {
            const m = containerModuleModes[mid];
            if (m !== "default" && !moduleFullyHasExclusiveState(variant, CONTAINER_MODULE_KEYS[mid], m)) {
                setContainerModuleMode(mid, "default");
            }
        });
    }, [variant, containerModuleModes, setContainerModuleMode]);

    const getStroke = (key: ContainerAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, strokeMode);
    const getCorners = (key: ContainerAppearancePropertyKey) => getRowValueForModuleEdit(variant, key, cornersMode);
    const patchStroke = (key: ContainerAppearancePropertyKey, value: AppearanceRowValue) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(variant, CONTAINER_MODULE_KEYS.stroke, key, strokeMode, value)
        );
    };
    const patchCorners = (key: ContainerAppearancePropertyKey, value: AppearanceRowValue) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(variant, CONTAINER_MODULE_KEYS.corners, key, cornersMode, value)
        );
    };

    const getTransform = (key: ContainerAppearancePropertyKey) =>
        getRowValueForModuleEdit(variant, key, transformMode);
    const patchTransform = (key: ContainerAppearancePropertyKey, value: AppearanceRowValue) => {
        commitVariant(
            updateRowValueForModuleEditOrEnsure(variant, CONTAINER_MODULE_KEYS.transform, key, transformMode, value)
        );
    };

    const buildBorderMoreMenu = (): ContextMenuDef => [
        {
            id: "border-align",
            label: "Border align",
            submenu: STROKE_ALIGN_OPTIONS.map(option => ({
                id: `border-align-${option.value}`,
                label: option.label,
                onClick: () => {
                    patchStroke("strokeAlign", String(option.value) as RectangleLikeProps["strokeAlign"]);
                },
            })),
        },
        { separator: true, id: "border-more-separator" },
        {
            id: "border-join",
            label: "Corner join",
            submenu: STROKE_JOIN_OPTIONS.map(option => ({
                id: `border-join-${option.value}`,
                label: option.label,
                onClick: () => {
                    patchStroke("borderJoin", option.value as StrokeJoin);
                },
            })),
        },
    ];

    const cornerAdvanced = Boolean(getCorners("cornerAdvanced"));
    const borderRadiusLinked = Boolean(getCorners("borderRadiusLinked"));
    const brTL = readFiniteNumber(getCorners("borderRadiusTL"), 0);
    const brTR = readFiniteNumber(getCorners("borderRadiusTR"), 0);
    const brBL = readFiniteNumber(getCorners("borderRadiusBL"), 0);
    const brBR = readFiniteNumber(getCorners("borderRadiusBR"), 0);
    const borderRadiusUniform = readFiniteNumber(getCorners("borderRadius"), brTL);
    const allCornersEqual = brTL === brTR && brTL === brBL && brTL === brBR;
    const showUniformPlaceholder = cornerAdvanced && !allCornersEqual;
    const uniformDisplay = showUniformPlaceholder ? "" : String(cornerAdvanced ? brTL : borderRadiusUniform);
    const uniformPlaceholder = showUniformPlaceholder ? "-" : undefined;

    const toggleCornerAdvanced = () => {
        const next = !cornerAdvanced;
        let v = variant;
        v = updateRowValueForModuleEditOrEnsure(v, CONTAINER_MODULE_KEYS.corners, "cornerAdvanced", cornersMode, next);
        v = updateRowValueForModuleEditOrEnsure(v, CONTAINER_MODULE_KEYS.corners, "borderRadiusLinked", cornersMode, !next);
        if (!next) {
            const uniform = brTL;
            v = patchManyInModule(v, CONTAINER_MODULE_KEYS.corners, cornersMode, [
                { key: "borderRadius", value: uniform },
                { key: "borderRadiusTL", value: uniform },
                { key: "borderRadiusTR", value: uniform },
                { key: "borderRadiusBL", value: uniform },
                { key: "borderRadiusBR", value: uniform },
            ]);
        }
        commitVariant(v);
    };

    return (
        <div className="space-y-3 min-w-0">
            <CompactBackgroundAppearance
                variant={variant}
                commitVariant={commitVariant}
                inspectorData={inspectorData}
                draftResetKey={draftResetKey}
                onSaving={onSaving}
                moduleKeys={CONTAINER_MODULE_KEYS.background}
                editMode={backgroundMode}
                onModeChange={m => setContainerModuleMode("background", m)}
                imageFillBaseline={rl}
                imageFillFieldId="compact.container.imageFill"
                motionVisible={backgroundMotionVisible}
                onMotionVisibleChange={visible => setContainerMotionVisible("background", visible)}
                moduleMotionFieldsConfigured={motionFieldsConfigured.background}
                setFieldTransition={setFieldTransition}
            />

            <CompactModuleCard
                title="Border"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={strokeMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.stroke}
                        onEnabledChange={visible => setContainerMotionVisible("stroke", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={CONTAINER_MODULE_KEYS.stroke}
                        mode={strokeMode}
                        onModeChange={m => setContainerModuleMode("stroke", m)}
                    />
                }
            >
                <BorderStrokeCompactRows
                    elementId={inspectorData.element.id}
                    draftResetKey={draftResetKey}
                    variant={variant}
                    setFieldTransition={setFieldTransition}
                    motionVisible={strokeMotionVisible}
                    borderStyleValue={String(getStroke("borderStyle") ?? "solid")}
                    onBorderStyleChange={next => patchStroke("borderStyle", next)}
                    borderWidth={readFiniteNumber(getStroke("borderWidth"), 0)}
                    onBorderWidthChange={width => patchStroke("borderWidth", width)}
                    strokeSideRaw={String(getStroke("strokeSide") ?? "all")}
                    onStrokeSideChange={next => patchStroke("strokeSide", next)}
                    borderColorCss={String(getStroke("borderColor") ?? "")}
                    onBorderColorChange={(next: ColorValue) => patchStroke("borderColor", colorValueToCss(next))}
                    strokeOpacity01={readFiniteNumber(getStroke("strokeOpacity"), 1)}
                    onStrokeOpacity01Change={o => patchStroke("strokeOpacity", o)}
                    moreMenu={buildBorderMoreMenu()}
                    moreMenuAriaLabel="More border options"
                />
            </CompactModuleCard>

            <CompactModuleCard
                title="Corners"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={cornersMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.corners}
                        onEnabledChange={visible => setContainerMotionVisible("corners", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={CONTAINER_MODULE_KEYS.corners}
                        mode={cornersMode}
                        onModeChange={m => setContainerModuleMode("corners", m)}
                    />
                }
            >
                <div className="flex gap-2 flex-nowrap items-stretch min-w-0">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={uniformDisplay}
                                draftResetKey={`${draftResetKey}-br-u`}
                                onFiniteNumber={radius => {
                                    if (radius < 0) return;
                                    const linked = borderRadiusLinked;
                                    const patch: { key: ContainerAppearancePropertyKey; value: AppearanceRowValue }[] = [
                                        { key: "borderRadius", value: radius },
                                    ];
                                    if (linked || !cornerAdvanced) {
                                        patch.push(
                                            { key: "borderRadiusTL", value: radius },
                                            { key: "borderRadiusTR", value: radius },
                                            { key: "borderRadiusBL", value: radius },
                                            { key: "borderRadiusBR", value: radius }
                                        );
                                    }
                                    commitVariant(patchManyInModule(variant, CONTAINER_MODULE_KEYS.corners, cornersMode, patch));
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                unit="px"
                                leftIcon={<CornerIcon position="tl" />}
                                className="w-full min-w-0"
                                placeholder={uniformPlaceholder}
                                selectAllOnFocus
                            />
                            {cornersMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="borderRadius"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={toggleCornerAdvanced}
                        aria-pressed={cornerAdvanced}
                        aria-label="Toggle corner breakdown"
                        className={controlButtonClass(cornerAdvanced)}
                    >
                        <Maximize2 className="w-4 h-4" />
                    </button>
                </div>

                {cornerAdvanced && (
                    <>
                        <div className="flex gap-2 flex-nowrap mt-2">
                            <button
                                type="button"
                                onClick={() => patchCorners("borderRadiusLinked", !borderRadiusLinked)}
                                aria-pressed={borderRadiusLinked}
                                className={controlButtonClass(borderRadiusLinked)}
                                title="Link corner radii"
                            >
                                <span className="text-[10px] font-medium px-1">Link</span>
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2 min-w-0">
                            {(
                                [
                                    ["borderRadiusTL", "tl"],
                                    ["borderRadiusTR", "tr"],
                                    ["borderRadiusBL", "bl"],
                                    ["borderRadiusBR", "br"],
                                ] as const
                            ).map(([key, pos]) => (
                                <div key={key} className="flex items-center gap-1 min-w-0">
                                    <NumericDraftEnhancedInput
                                        committedDisplay={String(readFiniteNumber(getCorners(key), 0))}
                                        draftResetKey={`${draftResetKey}-${key}`}
                                        onFiniteNumber={v => {
                                            if (v < 0) return;
                                            let next = updateRowValueForModuleEditOrEnsure(
                                                variant,
                                                CONTAINER_MODULE_KEYS.corners,
                                                key,
                                                cornersMode,
                                                v
                                            );
                                            if (borderRadiusLinked) {
                                                next = patchManyInModule(next, CONTAINER_MODULE_KEYS.corners, cornersMode, [
                                                    { key: "borderRadiusTL", value: v },
                                                    { key: "borderRadiusTR", value: v },
                                                    { key: "borderRadiusBL", value: v },
                                                    { key: "borderRadiusBR", value: v },
                                                ]);
                                            }
                                            commitVariant(next);
                                        }}
                                        inputMode="numeric"
                                        type="number"
                                        min={0}
                                        unit="px"
                                        leftIcon={<CornerIcon position={pos} />}
                                        className="w-full min-w-0"
                                        disabled={borderRadiusLinked}
                                        selectAllOnFocus
                                    />
                                    {cornersMotionVisible ? (
                                        <AppearanceFieldMotionButton
                                            variant={variant}
                                            setFieldTransition={setFieldTransition}
                                            groupKey={key}
                                            draftResetKey={draftResetKey}
                                        />
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </CompactModuleCard>

            <CompactModuleCard
                title="Transform"
                headerHoverAction={
                    <ModuleMotionMenuButton
                        enabled={transformMotionVisible}
                        hasConfiguredFields={motionFieldsConfigured.transform}
                        onEnabledChange={visible => setContainerMotionVisible("transform", visible)}
                    />
                }
                headerRight={
                    <CompactModuleStateHeader
                        variant={variant}
                        commitVariant={commitVariant}
                        moduleKeys={CONTAINER_MODULE_KEYS.transform}
                        mode={transformMode}
                        onModeChange={m => setContainerModuleMode("transform", m)}
                    />
                }
            >
                <div className="flex flex-wrap gap-2 min-w-0">
                    <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-gray-400">X offset</span>
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTransform("transformOffsetX"), 0))}
                                draftResetKey={`${draftResetKey}-tox`}
                                onFiniteNumber={v => patchTransform("transformOffsetX", v)}
                                inputMode="numeric"
                                type="number"
                                unit="px"
                                leftIcon={<Move className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {transformMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="transformOffsetX"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex min-w-[6rem] flex-1 flex-col gap-1">
                        <span className="text-xs font-medium text-gray-400">Y offset</span>
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getTransform("transformOffsetY"), 0))}
                                draftResetKey={`${draftResetKey}-toy`}
                                onFiniteNumber={v => patchTransform("transformOffsetY", v)}
                                inputMode="numeric"
                                type="number"
                                unit="px"
                                leftIcon={<Move className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                            {transformMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="transformOffsetY"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Zoom</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(readFiniteNumber(getTransform("transformScale"), 1))}
                            draftResetKey={`${draftResetKey}-ts`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(500, Math.max(1, value));
                                patchTransform("transformScale", clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={1}
                            max={500}
                            precision={null}
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformScale"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Rotation</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={String(readFiniteNumber(getTransform("transformRotation"), 0))}
                            draftResetKey={`${draftResetKey}-tr`}
                            onFiniteNumber={v => patchTransform("transformRotation", v)}
                            inputMode="numeric"
                            type="number"
                            unit="°"
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformRotation"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>

                <div className="mt-2 flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-gray-400">Opacity</span>
                    <div className="flex items-center gap-1 min-w-0">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatPercentDisplay(
                                readFiniteNumber(getTransform("transformOpacity"), 1)
                            )}
                            draftResetKey={`${draftResetKey}-top`}
                            onFiniteNumber={value => {
                                const clamped = Math.min(100, Math.max(0, value));
                                patchTransform("transformOpacity", clamped / 100);
                            }}
                            inputMode="decimal"
                            unit="%"
                            min={0}
                            max={100}
                            precision={null}
                            leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                            className="w-full min-w-0 flex-1"
                            selectAllOnFocus
                        />
                        {transformMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="transformOpacity"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
            </CompactModuleCard>

            <CompactEffectsAppearance
                variant={variant}
                commitVariant={commitVariant}
                setFieldTransition={setFieldTransition}
                draftResetKey={draftResetKey}
                moduleKeys={CONTAINER_MODULE_KEYS.effects}
                editMode={effectsMode}
                onModeChange={m => setContainerModuleMode("effects", m)}
                motionVisible={effectsMotionVisible}
                onMotionVisibleChange={visible => setContainerMotionVisible("effects", visible)}
                moduleMotionFieldsConfigured={motionFieldsConfigured.effects}
                supportedKinds={getSupportedEffectKindsForWidgetType(inspectorData.element.type)}
            />
        </div>
    );
}
