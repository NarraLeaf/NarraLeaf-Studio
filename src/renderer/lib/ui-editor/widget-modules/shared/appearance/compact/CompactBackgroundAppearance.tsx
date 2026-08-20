import { useTranslation } from "@/lib/i18n";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { ImageFillField } from "@/apps/workspace/modules/properties/framework/fields/ImageFillField";
import { parseColorValue, serializeColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { ColorValue, ImageFillFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceRowValue,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { DEFAULT_GRADIENT_FILL, normalizeGradientFill } from "@shared/types/ui-editor/gradientFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { Droplets, Eye, EyeOff, Settings2 } from "lucide-react";
import { FILL_TYPE_OPTIONS, controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { GradientFillEditor } from "../GradientFillEditor";
import { formatPercentDisplay, readFiniteNumber } from "./appearanceCompactHelpers";
import {
    getRowValueForModuleEdit,
    type ModuleEditMode,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";
import { CompactModuleCard } from "./CompactModuleCard";
import { CompactModuleStateHeader } from "./CompactModuleStateHeader";
import { AppearanceFieldMotionButton, ModuleMotionMenuButton } from "./AppearanceMotionControls";

export type CompactBackgroundAppearanceProps = {
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
    onSaving: (saving: boolean) => void;
    /** Keys owned by this module (used for conditional state rows). */
    moduleKeys: readonly string[];
    editMode: ModuleEditMode;
    onModeChange: (mode: ModuleEditMode) => void;
    /** Baseline for `normalizeImageFill` when `imageFill` row is empty (container: element props; button: synthesized). */
    imageFillBaseline: RectangleLikeProps;
    /** Stable id for the nested ImageFillField definition. */
    imageFillFieldId: string;
    motionVisible: boolean;
    onMotionVisibleChange: (visible: boolean) => void;
    /** Any variant has a motion config on an animatable key in this module. */
    moduleMotionFieldsConfigured: boolean;
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
};

/**
 * Solid RGB for the picker; layer transparency uses `fillOpacity` / `fillVisible`, not color alpha.
 *
 * The brand link, if the row holds one, is carried through untouched. Only the *alpha* is this
 * module's business to override - which colour the row points at is not - and dropping the link here
 * would leave the picker unable to ring the swatch the row is actually following.
 */
function backgroundColorPickerValue(raw: AppearanceRowValue | undefined): ColorValue {
    const s = String(raw ?? "").trim();
    if (!s || s.toLowerCase() === "transparent") {
        return { hex: "#ffffff", alpha: 1 };
    }
    const parsed = parseColorValue(s, { hex: "#ffffff", alpha: 1 });
    return { hex: parsed.hex, alpha: 1, ...(parsed.link ? { link: parsed.link } : {}) };
}

/**
 * The `backgroundColor` motion control, shown but off, while the fill is a gradient.
 *
 * Motion interpolates one colour into another, and a gradient is not a colour - two gradients may
 * differ in kind and in stop count, with no defined path between them. Leaving the live control in
 * place would let an author configure a duration and an easing that could never run; removing it
 * would answer their next question ("where did that go?") with nothing at all. So it stays, greyed,
 * and says why on hover - and the two keys that *do* still move a gradient, `fillOpacity` and
 * `fillVisible`, keep their own live controls beside it.
 */
function GradientMotionUnavailableButton() {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            disabled
            aria-label={t("widgetAppearance.gradient.motionUnavailableAria")}
            data-tip={t("widgetAppearance.gradient.motionUnavailable")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
            <Settings2 className="w-4 h-4" strokeWidth={1.75} />
        </button>
    );
}

function patchManyBackground(
    variant: AppearanceVariant,
    moduleKeys: readonly string[],
    editMode: ModuleEditMode,
    updates: { key: string; value: AppearanceRowValue }[]
): AppearanceVariant {
    let v = variant;
    for (const u of updates) {
        v = updateRowValueForModuleEditOrEnsure(v, moduleKeys, u.key, editMode, u.value);
    }
    return v;
}

export function CompactBackgroundAppearance({
    variant,
    commitVariant,
    inspectorData,
    draftResetKey,
    onSaving,
    moduleKeys,
    editMode,
    onModeChange,
    imageFillBaseline,
    imageFillFieldId,
    motionVisible,
    onMotionVisibleChange,
    moduleMotionFieldsConfigured,
    setFieldTransition,
}: CompactBackgroundAppearanceProps) {
    const { t } = useTranslation();
    const getBg = (key: string) => getRowValueForModuleEdit(variant, key, editMode);

    const patchBg = (key: string, value: AppearanceRowValue) => {
        commitVariant(updateRowValueForModuleEditOrEnsure(variant, moduleKeys, key, editMode, value));
    };

    const fillTypeRaw = String(getBg("fillType") ?? "color");
    // A deliberate safety net, widened rather than removed: a row can hold whatever the document on
    // disk holds, and `"color"` is the reading that always paints something. Add the next fill kind
    // here as well as to `FILL_TYPE_OPTIONS`, or the option will select a value this collapses away.
    const fillType: RectangleLikeProps["fillType"] =
        fillTypeRaw === "image" ? "image" : fillTypeRaw === "gradient" ? "gradient" : "color";
    const storedGradient = normalizeGradientFill(getBg("gradientFill"));

    const imageFillFieldDef: ImageFillFieldDefinition<UIInspectorData> = {
        type: "imageFill",
        id: imageFillFieldId,
        label: t("widgetAppearance.fields.imageFill"),
        getValue: () => {
            const raw = getBg("imageFill");
            if (raw && typeof raw === "object" && "mode" in (raw as object)) {
                return raw as ImageFill;
            }
            return normalizeImageFill(imageFillBaseline);
        },
        setValue: (_d, imgVal) => {
            commitVariant(
                patchManyBackground(variant, moduleKeys, editMode, [
                    { key: "fillType", value: "image" },
                    { key: "imageFill", value: imgVal },
                ])
            );
        },
    };

    return (
        <CompactModuleCard
            title={t("widgetAppearance.background.title")}
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
            <Select
                value={fillType}
                options={FILL_TYPE_OPTIONS}
                fullWidth
                onChange={next => {
                    const s = String(next) as RectangleLikeProps["fillType"];
                    if (s === "gradient" && !storedGradient) {
                        // Seeded in the same commit as the type, exactly as picking an image writes
                        // `fillType` and `imageFill` together: a gradient row with no gradient in it
                        // would paint nothing, and the seed is two brand slots, so the author's first
                        // sight of it is their own project's colours.
                        commitVariant(
                            patchManyBackground(variant, moduleKeys, editMode, [
                                { key: "fillType", value: s },
                                { key: "gradientFill", value: DEFAULT_GRADIENT_FILL },
                            ])
                        );
                        return;
                    }
                    patchBg("fillType", s);
                }}
            />

            {fillType === "color" && (
                <div className="flex flex-wrap gap-2 items-center min-w-0 mt-2">
                    <div className="flex items-center gap-1 shrink-0">
                        <ColorPickerTrigger
                            value={backgroundColorPickerValue(getBg("backgroundColor"))}
                            displayMode="icon"
                            brandPalette
                            allowOpacity={false}
                            onChange={(next: ColorValue) =>
                                // Alpha pinned to 1 for the same reason the picker hides the slider:
                                // this row's transparency is `fillOpacity`. A link survives that -
                                // `serializeColorValue` writes the id, not the colour it resolves to.
                                patchBg(
                                    "backgroundColor",
                                    serializeColorValue({ hex: next.hex, alpha: 1, ...(next.link ? { link: next.link } : {}) })
                                )
                            }
                        />
                        {motionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="backgroundColor"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={formatPercentDisplay(readFiniteNumber(getBg("fillOpacity"), 1))}
                                draftResetKey={`${draftResetKey}-bg-fill-op`}
                                onFiniteNumber={value => {
                                    const clamped = Math.min(100, Math.max(0, value));
                                    patchBg("fillOpacity", clamped / 100);
                                }}
                                inputMode="decimal"
                                unit="%"
                                min={0}
                                max={100}
                                precision={null}
                                leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                            />
                            {motionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="fillOpacity"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => patchBg("fillVisible", !Boolean(getBg("fillVisible") ?? true))}
                            aria-pressed={Boolean(getBg("fillVisible") ?? true)}
                            aria-label={t("widgetAppearance.background.toggleVisibilityAria")}
                            className={controlButtonClass(Boolean(getBg("fillVisible") ?? true))}
                        >
                            {Boolean(getBg("fillVisible") ?? true) ? (
                                <Eye className="w-4 h-4" />
                            ) : (
                                <EyeOff className="w-4 h-4" />
                            )}
                        </button>
                        {motionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="fillVisible"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
            )}

            {fillType === "gradient" && (
                <div className="flex flex-wrap gap-2 items-center min-w-0 mt-2">
                    <div className="flex items-center gap-1 shrink-0">
                        <GradientFillEditor
                            value={storedGradient ?? DEFAULT_GRADIENT_FILL}
                            draftResetKey={`${draftResetKey}-bg-gradient`}
                            onChange={next => patchBg("gradientFill", next)}
                        />
                        {motionVisible ? <GradientMotionUnavailableButton /> : null}
                    </div>
                    <div className="flex-1 min-w-[6rem]">
                        <div className="flex items-center gap-1 min-w-0">
                            <NumericDraftEnhancedInput
                                committedDisplay={formatPercentDisplay(readFiniteNumber(getBg("fillOpacity"), 1))}
                                draftResetKey={`${draftResetKey}-bg-grad-op`}
                                onFiniteNumber={value => {
                                    const clamped = Math.min(100, Math.max(0, value));
                                    patchBg("fillOpacity", clamped / 100);
                                }}
                                inputMode="decimal"
                                unit="%"
                                min={0}
                                max={100}
                                precision={null}
                                leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                            />
                            {motionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="fillOpacity"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => patchBg("fillVisible", !Boolean(getBg("fillVisible") ?? true))}
                            aria-pressed={Boolean(getBg("fillVisible") ?? true)}
                            aria-label={t("widgetAppearance.background.toggleVisibilityAria")}
                            className={controlButtonClass(Boolean(getBg("fillVisible") ?? true))}
                        >
                            {Boolean(getBg("fillVisible") ?? true) ? (
                                <Eye className="w-4 h-4" />
                            ) : (
                                <EyeOff className="w-4 h-4" />
                            )}
                        </button>
                        {motionVisible ? (
                            <AppearanceFieldMotionButton
                                variant={variant}
                                setFieldTransition={setFieldTransition}
                                groupKey="fillVisible"
                                draftResetKey={draftResetKey}
                            />
                        ) : null}
                    </div>
                </div>
            )}

            {fillType === "image" && (
                <div className="space-y-2 min-w-0 mt-2">
                    <ImageFillField field={imageFillFieldDef} data={inspectorData} onSaving={onSaving} />
                    <div className="flex flex-wrap gap-2 items-center min-w-0">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                                <NumericDraftEnhancedInput
                                    committedDisplay={formatPercentDisplay(readFiniteNumber(getBg("fillOpacity"), 1))}
                                    draftResetKey={`${draftResetKey}-bg-img-op`}
                                    onFiniteNumber={value => {
                                        const clamped = Math.min(100, Math.max(0, value));
                                        patchBg("fillOpacity", clamped / 100);
                                    }}
                                    inputMode="decimal"
                                    unit="%"
                                    min={0}
                                    max={100}
                                    precision={null}
                                    leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
                                    className="w-full min-w-0"
                                />
                                {motionVisible ? (
                                    <AppearanceFieldMotionButton
                                        variant={variant}
                                        setFieldTransition={setFieldTransition}
                                        groupKey="fillOpacity"
                                        draftResetKey={draftResetKey}
                                    />
                                ) : null}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                onClick={() => patchBg("fillVisible", !Boolean(getBg("fillVisible") ?? true))}
                                aria-pressed={Boolean(getBg("fillVisible") ?? true)}
                                aria-label={t("widgetAppearance.background.toggleVisibilityAria")}
                                className={controlButtonClass(Boolean(getBg("fillVisible") ?? true))}
                            >
                                {Boolean(getBg("fillVisible") ?? true) ? (
                                    <Eye className="w-4 h-4" />
                                ) : (
                                    <EyeOff className="w-4 h-4" />
                                )}
                            </button>
                            {motionVisible ? (
                                <AppearanceFieldMotionButton
                                    variant={variant}
                                    setFieldTransition={setFieldTransition}
                                    groupKey="fillVisible"
                                    draftResetKey={draftResetKey}
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
            )}
        </CompactModuleCard>
    );
}
