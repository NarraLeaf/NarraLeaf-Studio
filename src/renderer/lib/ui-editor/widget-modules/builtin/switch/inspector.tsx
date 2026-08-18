import { UI_SWITCH_ON_VARIANT_ID, type UISwitchWidgetProps } from "@shared/types/ui-editor/switch";
import {
    DEFAULT_STATE_MOTION_DURATION_MS,
    DEFAULT_STATE_MOTION_EASING,
    getStateMotions,
    MAX_STATE_MOTION_DURATION_MS,
    upsertStateMotion,
} from "@shared/types/ui-editor/stateMotion";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import { APPEARANCE_TWEEN_EASING_OPTIONS } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useWorkspace } from "@/apps/workspace/context";
import { Button } from "@/lib/components/elements/Button";
import { Switch } from "@/lib/components/elements/Switch";
import { cn } from "@/lib/utils/cn";
import { Services } from "@/lib/workspace/services/services";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { CompactModuleCard } from "@/lib/ui-editor/widget-modules/shared/appearance/compact/CompactModuleCard";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { i18nStore, translate, useTranslation } from "@/lib/i18n";
import {
    createSwitchPartProps,
    getSwitchProps,
    patchSwitchProps,
    resolveSwitchPartGeometry,
} from "./helpers";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveElement(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function getLiveSwitchProps(data: UIInspectorData): UISwitchWidgetProps {
    return getSwitchProps(liveElement(data));
}

function patchSwitch(data: UIInspectorData, partial: Partial<UISwitchWidgetProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, patchSwitchProps(live, partial));
}

function ToggleRow({
    label,
    checked,
    disabled,
    onChange,
    className,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
    className?: string;
}) {
    // A `div` rather than a wrapping `label`: the shared `Switch` renders a `<button>`, which is
    // labelable, and a label around one re-dispatches the click it just received - a toggle that
    // fires twice looks like a toggle that does nothing.
    return (
        <div className={cn("flex items-center justify-between gap-2 min-w-0", className)}>
            <span className="text-xs font-medium text-fg-muted min-w-0 truncate">{label}</span>
            <Switch
                size="sm"
                checked={checked}
                disabled={disabled}
                onCheckedChange={onChange}
                aria-label={label}
            />
        </div>
    );
}

/**
 * The literal side of `checked`: the same toggle as before, shown only while nothing is bound.
 * `readOnly` cannot reach here - `renderLiteralEditor` is handed only the data - but the framework
 * wraps a frozen custom field in a `disabled` `<fieldset>`, and the shared `Switch` is a `<button>`,
 * so the browser disables it anyway. Same arrangement as the slider's literal editor.
 */
function SwitchCheckedLiteralEditor({
    data,
    liveElement,
}: {
    data: UIInspectorData;
    liveElement: UIInspectorData["element"];
}) {
    const { t } = useTranslation();
    return (
        <ToggleRow
            label={t("widgets.switch.defaultChecked")}
            checked={getSwitchProps(liveElement).checked}
            onChange={checked => patchSwitch(data, { checked })}
        />
    );
}

const SwitchCheckedBlueprintValueField = createBlueprintValueField({
    propPath: "checked",
    valueType: "boolean",
    valueLabel: "boolean",
    title: "widgets.blueprintValue.switchCheckedTitle",
    clearLabel: "widgets.blueprintValue.literalValue",
    getDisplayName: ({ liveElement }) =>
        translate("widgets.blueprintValue.nameValue", {
            name: liveElement.name ?? translate("widgets.defaults.switch.name"),
        }),
    getLiteralValue: ({ liveElement }) => getSwitchProps(liveElement).checked,
    renderLiteralEditor: ({ data, liveElement }) => (
        <SwitchCheckedLiteralEditor data={data} liveElement={liveElement} />
    ),
});

function SwitchStateField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const current = getLiveSwitchProps(props.data);
    return (
        <CompactModuleCard title={t("widgets.switch.state")}>
            <SwitchCheckedBlueprintValueField {...props} />
            <ToggleRow
                label={t("widgets.switch.interactionDisabled")}
                checked={current.interactionDisabled}
                disabled={props.readOnly}
                onChange={interactionDisabled => patchSwitch(props.data, { interactionDisabled })}
            />
        </CompactModuleCard>
    );
}

/**
 * How far the switch slides its thumb while it is on, and how long that takes.
 *
 * Lives on the switch because it is the switch doing it: the thumb keeps one position, the one an
 * author drags it to, and this is the offset laid over it for the length of the on state. Four
 * numbers, no gesture - anything richer is a control the author builds from containers.
 */
function SwitchMotionField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { documentService, element } = props.data;
    const live = documentService.getDocument().elements[element.id] ?? element;
    const thumbId = getSwitchProps(live).thumbElementId;
    if (!thumbId) {
        return null;
    }
    const motions = getStateMotions(live.props);
    const current = motions.find(
        motion => motion.state === UI_SWITCH_ON_VARIANT_ID && motion.target === thumbId,
    ) ?? {
        state: UI_SWITCH_ON_VARIANT_ID,
        target: thumbId,
        offsetX: 0,
        offsetY: 0,
        durationMs: DEFAULT_STATE_MOTION_DURATION_MS,
        easing: DEFAULT_STATE_MOTION_EASING,
    };
    const write = (patch: Partial<typeof current>) => {
        documentService.updateElementProps(live.id, {
            ...(live.props ?? {}),
            stateMotions: upsertStateMotion(motions, { ...current, ...patch }),
        });
    };
    const draftKey = `${live.id}:${thumbId}`;

    return (
        <CompactModuleCard title={t("widgets.switch.motionTitle")}>
            <div className="grid grid-cols-2 gap-2">
                <NumericDraftEnhancedInput
                    committedDisplay={String(current.offsetX)}
                    draftResetKey={`${draftKey}-x`}
                    onFiniteNumber={value => write({ offsetX: value })}
                    inputMode="decimal"
                    type="number"
                    unit="X"
                    className="w-full min-w-0"
                />
                <NumericDraftEnhancedInput
                    committedDisplay={String(current.offsetY)}
                    draftResetKey={`${draftKey}-y`}
                    onFiniteNumber={value => write({ offsetY: value })}
                    inputMode="decimal"
                    type="number"
                    unit="Y"
                    className="w-full min-w-0"
                />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <NumericDraftEnhancedInput
                    committedDisplay={formatStorySecondsValue(current.durationMs)}
                    draftResetKey={`${draftKey}-duration`}
                    onFiniteNumber={seconds =>
                        write({
                            durationMs: Math.max(
                                0,
                                Math.min(MAX_STATE_MOTION_DURATION_MS, storySecondsToMs(seconds)),
                            ),
                        })
                    }
                    inputMode="decimal"
                    type="number"
                    min={0}
                    unit="s"
                    className="w-full min-w-0"
                />
                <Select
                    value={current.easing}
                    options={APPEARANCE_TWEEN_EASING_OPTIONS.map(option => ({
                        value: option.value,
                        labelKey: option.labelKey,
                    }))}
                    fullWidth
                    onChange={value => write({ easing: String(value) as typeof current.easing })}
                />
            </div>
        </CompactModuleCard>
    );
}

function SwitchPartsField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { documentService, element, surfaceId } = props.data;
    const document = documentService.getDocument();
    const live = document.elements[element.id] ?? element;
    const current = getSwitchProps(live);
    const trackExists = Boolean(current.trackElementId && document.elements[current.trackElementId]);
    const thumbExists = Boolean(current.thumbElementId && document.elements[current.thumbElementId]);
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

    const runInHistory = (action: () => void) => {
        if (surfaceId) {
            documentService.runSurfaceHistoryTransaction(surfaceId, action);
        } else {
            action();
        }
    };

    const repairParts = () => {
        runInHistory(() => {
            const latest = documentService.getDocument().elements[element.id] ?? live;
            const latestProps = getSwitchProps(latest);
            const { inset, trackW, trackH, thumbSize, travel } = resolveSwitchPartGeometry(latest.layout);
            let trackId = latestProps.trackElementId;
            let thumbId = latestProps.thumbElementId;
            if (!trackId || !documentService.getDocument().elements[trackId]) {
                const track = documentService.createElement(element.id, "nl.container", {
                    x: 0,
                    y: 0,
                    width: trackW,
                    height: trackH,
                });
                documentService.updateElementExtra(track.id, { switchSlot: "track" });
                documentService.updateElementProps(track.id, createSwitchPartProps("track"));
                trackId = track.id;
            }
            if (!thumbId || !documentService.getDocument().elements[thumbId]) {
                const thumb = documentService.createElement(element.id, "nl.container", {
                    x: inset,
                    y: inset,
                    width: thumbSize,
                    height: thumbSize,
                });
                documentService.updateElementExtra(thumb.id, { switchSlot: "thumb" });
                documentService.updateElementProps(thumb.id, createSwitchPartProps("thumb"));
                thumbId = thumb.id;
            }
            const refreshed = documentService.getDocument().elements[element.id] ?? latest;
            documentService.updateElementProps(element.id, patchSwitchProps(refreshed, {
                trackElementId: trackId,
                thumbElementId: thumbId,
            }));
        });
    };

    const partsComplete = trackExists && thumbExists;
    return (
        <CompactModuleCard title={t("widgets.switch.parts")}>
            <div className="grid grid-cols-2 gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!trackExists}
                    onClick={() => selectPart(current.trackElementId)}
                >
                    {t("widgets.switch.track")}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!thumbExists}
                    onClick={() => selectPart(current.thumbElementId)}
                >
                    {t("widgets.switch.thumb")}
                </Button>
            </div>
            {partsComplete ? null : (
                <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    fullWidth
                    className="text-xs"
                    disabled={props.readOnly}
                    onClick={repairParts}
                >
                    {t("widgets.switch.repairParts")}
                </Button>
            )}
        </CompactModuleCard>
    );
}

export function createSwitchInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;
    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.switch:${element.id}`,
        title: element.name ?? t("widgets.switch.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "switch.state",
                        type: "custom",
                        component: SwitchStateField,
                    }),
                    defineField<D, any>({
                        id: "switch.parts",
                        type: "custom",
                        component: SwitchPartsField,
                    }),
                    defineField<D, any>({
                        id: "switch.motion",
                        type: "custom",
                        component: SwitchMotionField,
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
