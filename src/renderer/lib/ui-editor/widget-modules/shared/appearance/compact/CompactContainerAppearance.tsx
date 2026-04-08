import { useEffect } from "react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceRowValue,
    AppearanceVariant,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { RectangleLikeProps, StrokeJoin } from "@shared/types/ui-editor/rectangleLike";
import { Droplets, Eye, EyeOff, Maximize2, Square } from "lucide-react";
import {
    BORDER_STYLE_OPTIONS,
    CornerIcon,
    STROKE_ALIGN_OPTIONS,
    STROKE_JOIN_OPTIONS,
    STROKE_SIDE_OPTIONS,
    controlButtonClass,
} from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { InlineMenuTriggerButton } from "@/lib/ui-editor/widget-modules/shared/chrome/InlineMenuTriggerButton";
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
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";

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
}: Props) {
    const rl = getRectangleLikeProps(inspectorData.element);

    const backgroundMode = containerModuleModes.background;
    const strokeMode = containerModuleModes.stroke;
    const cornersMode = containerModuleModes.corners;
    const backgroundMotionVisible = containerMotionVisibility.background;
    const strokeMotionVisible = containerMotionVisibility.stroke;
    const cornersMotionVisible = containerMotionVisibility.corners;

    useEffect(() => {
        (["background", "stroke", "corners"] as const).forEach(mid => {
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

    const strokeVisible = Boolean(getStroke("strokeVisible") ?? true);

    const buildStrokeMenu = (): ContextMenuDef => [
        {
            id: "stroke-style",
            label: "Border Style",
            submenu: BORDER_STYLE_OPTIONS.map(option => ({
                id: `stroke-style-${option.value}`,
                label: option.label,
                icon: option.icon,
                onClick: () => {
                    commitVariant(
                        updateRowValueForModuleEditOrEnsure(
                            variant,
                            CONTAINER_MODULE_KEYS.stroke,
                            "borderStyle",
                            strokeMode,
                            option.value
                        )
                    );
                },
            })),
        },
        { separator: true, id: "stroke-style-separator" },
        {
            id: "stroke-join",
            label: "Corner Join",
            submenu: STROKE_JOIN_OPTIONS.map(option => ({
                id: `stroke-join-${option.value}`,
                label: option.label,
                onClick: () => {
                    commitVariant(
                        updateRowValueForModuleEditOrEnsure(
                            variant,
                            CONTAINER_MODULE_KEYS.stroke,
                            "borderJoin",
                            strokeMode,
                            option.value as StrokeJoin
                        )
                    );
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
                title="Stroke"
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
                <div className="flex gap-2 flex-nowrap items-stretch min-w-0">
                    <div className="flex-1 min-w-0">
                        <Select
                            value={String(getStroke("strokeAlign") ?? "center")}
                            options={STROKE_ALIGN_OPTIONS}
                            fullWidth
                            onChange={next =>
                                patchStroke("strokeAlign", String(next) as RectangleLikeProps["strokeAlign"])
                            }
                        />
                    </div>
                    <div className="min-w-0 basis-28 shrink grow-0">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={String(readFiniteNumber(getStroke("borderWidth"), 0))}
                                draftResetKey={`${draftResetKey}-bw`}
                                onFiniteNumber={width => {
                                    if (width < 0) return;
                                    patchStroke("borderWidth", width);
                                }}
                                inputMode="numeric"
                                type="number"
                                min={0}
                                unit="px"
                                leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                                className="w-full min-w-0"
                            />
                            {strokeMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="borderWidth"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <InlineMenuTriggerButton menu={buildStrokeMenu()} ariaLabel="Open stroke settings" className="z-10 shrink-0" />
                </div>

                <div className="flex flex-wrap gap-1 mt-1">
                    {STROKE_SIDE_OPTIONS.map(opt => {
                        const current = String(getStroke("strokeSide") ?? "all");
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                title={opt.label}
                                aria-label={opt.label}
                                aria-pressed={current === opt.id}
                                className={controlButtonClass(current === opt.id)}
                                onClick={() => patchStroke("strokeSide", opt.id)}
                            >
                                {opt.icon}
                            </button>
                        );
                    })}
                </div>

                <div className="flex gap-2 flex-nowrap items-center min-w-0 pt-1">
                    <div className="flex items-center gap-1 shrink-0">
                        <ColorPickerTrigger
                            value={parseColorValue(String(getStroke("borderColor") ?? ""), {
                                hex: "#000000",
                                alpha: 1,
                            })}
                            displayMode="icon"
                            allowOpacity={false}
                            disabled={!strokeVisible}
                            onChange={(next: ColorValue) => patchStroke("borderColor", colorValueToCss(next))}
                        />
                        {strokeMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="borderColor"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={formatPercentDisplay(readFiniteNumber(getStroke("strokeOpacity"), 1))}
                                draftResetKey={`${draftResetKey}-so`}
                                onFiniteNumber={value => {
                                    const clamped = Math.min(100, Math.max(0, value));
                                    patchStroke("strokeOpacity", clamped / 100);
                                }}
                                inputMode="decimal"
                                unit="%"
                                min={0}
                                max={100}
                                precision={null}
                                leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                                disabled={!strokeVisible}
                                className="w-full min-w-0"
                            />
                            {strokeMotionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="strokeOpacity"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => patchStroke("strokeVisible", !strokeVisible)}
                            aria-pressed={strokeVisible}
                            aria-label="Toggle stroke visibility"
                            className={controlButtonClass(strokeVisible)}
                        >
                            {strokeVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        {strokeMotionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="strokeVisible"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
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
        </div>
    );
}
