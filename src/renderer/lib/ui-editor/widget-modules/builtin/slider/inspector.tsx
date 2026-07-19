import { SlidersHorizontal, SlidersVertical } from "lucide-react";
import { normalizeSliderRange, type UISliderOrientation, type UISliderWidgetProps } from "@shared/types/ui-editor/slider";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useWorkspace } from "@/apps/workspace/context";
import { Button } from "@/lib/components/elements/Button";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Services } from "@/lib/workspace/services/services";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { CompactModuleCard } from "@/lib/ui-editor/widget-modules/shared/appearance/compact/CompactModuleCard";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { i18nStore, translate, useTranslation } from "@/lib/i18n";
import { getSliderProps, patchSliderProps } from "./helpers";

const SliderBlueprintValueField = createBlueprintValueField({
    propPath: "value",
    valueType: "float",
    valueLabel: "float",
    title: "widgets.blueprintValue.sliderTitle",
    clearLabel: "widgets.blueprintValue.literalValue",
    getDisplayName: ({ liveElement }) =>
        translate("widgets.blueprintValue.nameValue", {
            name: liveElement.name ?? translate("widgets.defaults.slider.name"),
        }),
    getLiteralValue: ({ liveElement }) => getSliderProps(liveElement).value,
    renderLiteralEditor: ({ data, liveElement }) => (
        <SliderValueLiteralEditor data={data} liveElement={liveElement} />
    ),
});

function finiteOr(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getLiveSliderProps(data: UIInspectorData): UISliderWidgetProps {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    return getSliderProps(live);
}

function patchSlider(data: UIInspectorData, partial: Partial<UISliderWidgetProps>): void {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    data.documentService.updateElementProps(live.id, patchSliderProps(live, partial));
}

function FieldLabel({ children }: { children: string }) {
    return <span className="text-xs font-medium text-fg-muted">{children}</span>;
}

function SliderNumberControl({
    label,
    value,
    draftResetKey,
    onFiniteNumber,
    min,
    unit,
}: {
    label: string;
    value: number;
    draftResetKey: string;
    onFiniteNumber: (value: number) => void;
    min?: number;
    unit?: string;
}) {
    return (
        <div className="flex min-w-[5.25rem] flex-1 flex-col gap-1">
            <FieldLabel>{label}</FieldLabel>
            <NumericDraftEnhancedInput
                committedDisplay={String(value)}
                draftResetKey={draftResetKey}
                onFiniteNumber={onFiniteNumber}
                inputMode="decimal"
                type="number"
                min={min}
                unit={unit}
                className="w-full min-w-0"
                selectAllOnFocus
            />
        </div>
    );
}

function SliderValueLiteralEditor({ data, liveElement }: { data: UIInspectorData; liveElement: UIInspectorData["element"] }) {
    const current = getSliderProps(liveElement);
    return (
        <NumericDraftEnhancedInput
            committedDisplay={String(current.value)}
            draftResetKey={`${liveElement.id}-slider-value`}
            onFiniteNumber={value => patchSlider(data, { value })}
            inputMode="decimal"
            type="number"
            min={current.min}
            max={current.max}
            className="w-full min-w-0"
            selectAllOnFocus
        />
    );
}

function OrientationButton({
    orientation,
    active,
    onClick,
}: {
    orientation: UISliderOrientation;
    active: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    const Icon = orientation === "horizontal" ? SlidersHorizontal : SlidersVertical;
    const label = orientation === "horizontal" ? t("widgets.horizontal") : t("widgets.vertical");
    return (
        <button
            type="button"
            className={`flex h-8 w-8 items-center justify-center border text-fg transition first:rounded-l-md last:rounded-r-md ${
                active
                    ? "border-primary/50 bg-primary/15 text-fg"
                    : "border-edge bg-fill-subtle hover:bg-fill"
            }`}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
        >
            <Icon className="h-4 w-4" />
        </button>
    );
}

function SliderValueField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const current = getLiveSliderProps(props.data);
    const range = normalizeSliderRange(current);
    return (
        <CompactModuleCard title={t("widgets.slider.value")}>
            <SliderBlueprintValueField {...props} />
            <div className="mt-2 flex flex-wrap gap-2 min-w-0">
                <SliderNumberControl
                    label={t("widgets.slider.min")}
                    value={range.min}
                    draftResetKey={`${props.data.element.id}-min`}
                    onFiniteNumber={min => patchSlider(props.data, { min })}
                />
                <SliderNumberControl
                    label={t("widgets.slider.max")}
                    value={range.max}
                    draftResetKey={`${props.data.element.id}-max`}
                    onFiniteNumber={max => patchSlider(props.data, { max })}
                />
                <SliderNumberControl
                    label={t("widgets.slider.step")}
                    value={range.step}
                    min={0}
                    draftResetKey={`${props.data.element.id}-step`}
                    onFiniteNumber={step => patchSlider(props.data, { step: Math.max(0, finiteOr(step, 0)) })}
                />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
                <FieldLabel>{t("widgets.direction")}</FieldLabel>
                <div className="flex shrink-0 items-center">
                    <OrientationButton
                        orientation="horizontal"
                        active={current.orientation === "horizontal"}
                        onClick={() => patchSlider(props.data, { orientation: "horizontal" })}
                    />
                    <OrientationButton
                        orientation="vertical"
                        active={current.orientation === "vertical"}
                        onClick={() => patchSlider(props.data, { orientation: "vertical" })}
                    />
                </div>
            </div>
        </CompactModuleCard>
    );
}

function sliderPartContainerProps(kind: "track" | "handle"): Record<string, unknown> {
    const props = {
        ...defaultContainerWidgetProps,
        layoutKind: "free" as const,
        clipContent: true,
        backgroundColor: kind === "track" ? "#64748b" : "#f8fafc",
        borderColor: kind === "track" ? "#64748b" : "#0f172a",
        borderWidth: kind === "track" ? 0 : 1,
        borderStyle: "solid",
        borderRadius: 999,
        borderRadiusTL: 999,
        borderRadiusTR: 999,
        borderRadiusBL: 999,
        borderRadiusBR: 999,
        fillVisible: true,
        strokeVisible: kind === "handle",
        strokeOpacity: kind === "handle" ? 0.2 : 0,
        strokeAlign: "inside" as const,
        fillOpacity: 1,
    };
    return {
        ...props,
        appearance: createInitialContainerAppearance(props),
    };
}

function SliderPartsField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { documentService, element, surfaceId } = props.data;
    const document = documentService.getDocument();
    const live = document.elements[element.id] ?? element;
    const current = getSliderProps(live);
    const trackExists = Boolean(current.trackElementId && document.elements[current.trackElementId]);
    const handleExists = Boolean(current.handleElementId && document.elements[current.handleElementId]);
    const stateService =
        isInitialized && context
            ? context.services.get<UIEditorStateService>(Services.UIEditorState)
            : null;

    const selectPart = (elementId: string | null | undefined) => {
        if (!elementId || !surfaceId || !stateService) {
            return;
        }
        stateService.setUIElementSelection({
            editor: "ui",
            surfaceId,
            elementIds: [elementId],
            primaryId: elementId,
        });
    };

    const repairParts = () => {
        const action = () => {
            const latest = documentService.getDocument().elements[element.id] ?? live;
            const latestProps = getSliderProps(latest);
            let trackId = latestProps.trackElementId;
            let handleId = latestProps.handleElementId;
            if (!trackId || !documentService.getDocument().elements[trackId]) {
                const track = documentService.createElement(element.id, "nl.container", {
                    x: 16,
                    y: Math.max(0, latest.layout.height / 2 - 3),
                    width: Math.max(24, latest.layout.width - 32),
                    height: 6,
                });
                documentService.updateElementExtra(track.id, { sliderSlot: "track" });
                documentService.updateElementProps(track.id, sliderPartContainerProps("track"));
                trackId = track.id;
            }
            if (!handleId || !documentService.getDocument().elements[handleId]) {
                const handle = documentService.createElement(element.id, "nl.container", {
                    x: Math.max(0, latest.layout.width / 2 - 9),
                    y: Math.max(0, latest.layout.height / 2 - 11),
                    width: 18,
                    height: 22,
                });
                documentService.updateElementExtra(handle.id, { sliderSlot: "handle" });
                documentService.updateElementProps(handle.id, sliderPartContainerProps("handle"));
                handleId = handle.id;
            }
            const refreshed = documentService.getDocument().elements[element.id] ?? latest;
            documentService.updateElementProps(element.id, patchSliderProps(refreshed, {
                trackElementId: trackId,
                handleElementId: handleId,
            }));
        };
        if (surfaceId) {
            documentService.runSurfaceHistoryTransaction(surfaceId, action);
        } else {
            action();
        }
    };

    return (
        <CompactModuleCard title={t("widgets.slider.parts")}>
            <div className="grid grid-cols-2 gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!trackExists}
                    onClick={() => selectPart(current.trackElementId)}
                >
                    {t("widgets.slider.track")}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!handleExists}
                    onClick={() => selectPart(current.handleElementId)}
                >
                    {t("widgets.slider.handle")}
                </Button>
            </div>
            {!trackExists || !handleExists ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    fullWidth
                    className="h-8 text-xs"
                    onClick={repairParts}
                >
                    {t("widgets.slider.repairParts")}
                </Button>
            ) : null}
        </CompactModuleCard>
    );
}

export function createSliderInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;
    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.slider:${element.id}`,
        title: element.name ?? t("widgets.slider.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "slider.value",
                        type: "custom",
                        component: SliderValueField,
                    }),
                    defineField<D, any>({
                        id: "slider.parts",
                        type: "custom",
                        component: SliderPartsField,
                    }),
                ],
            },
            {
                id: "interaction",
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
