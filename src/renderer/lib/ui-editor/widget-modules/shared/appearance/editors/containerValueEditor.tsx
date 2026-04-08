import { Droplets, Eye, EyeOff, Maximize2, Square } from "lucide-react";
import type { ImageFillFieldDefinition } from "@/apps/workspace/modules/properties/framework/types";
import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { ImageFillField } from "@/apps/workspace/modules/properties/framework/fields/ImageFillField";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { ContainerAppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import {
    BORDER_STYLE_OPTIONS,
    CornerIcon,
    FILL_TYPE_OPTIONS,
    STROKE_ALIGN_OPTIONS,
    STROKE_JOIN_OPTIONS,
    STROKE_SIDE_OPTIONS,
    controlButtonClass,
} from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { getRectangleLikeProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { isValidStrokeSideSpec, parseStrokeSideSpec } from "@/lib/ui-editor/widget-modules/shared/chrome/strokeSideSpec";

export type ContainerValueEditorProps = {
    fieldKey: ContainerAppearancePropertyKey;
    value: unknown;
    onChange: (next: unknown) => void;
    draftResetKey: string;
    inspectorData: UIInspectorData;
    onSaving: (saving: boolean) => void;
};

const formatPercentDisplay = (v: number) => String(Math.round(v * 10000) / 100);

export function ContainerAppearanceValueEditor({
    fieldKey,
    value,
    onChange,
    draftResetKey,
    inspectorData,
    onSaving,
}: ContainerValueEditorProps) {
    const rl = getRectangleLikeProps(inspectorData.element);

    switch (fieldKey) {
        case "backgroundColor": {
            const raw = typeof value === "string" ? value : String(value ?? "");
            const cv = parseColorValue(raw, { hex: "#ffffff", alpha: 1 });
            return (
                <ColorPickerTrigger
                    value={cv}
                    displayMode="icon"
                    allowOpacity={false}
                    onChange={(next: ColorValue) => onChange(colorValueToCss(next))}
                />
            );
        }
        case "borderRadius":
        case "borderRadiusTL":
        case "borderRadiusTR":
        case "borderRadiusBL":
        case "borderRadiusBR": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
            const cornerPos =
                fieldKey === "borderRadius"
                    ? ("tl" as const)
                    : fieldKey.endsWith("TL")
                      ? ("tl" as const)
                      : fieldKey.endsWith("TR")
                        ? ("tr" as const)
                        : fieldKey.endsWith("BL")
                          ? ("bl" as const)
                          : ("br" as const);
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={String(n)}
                    draftResetKey={`${draftResetKey}-${fieldKey}`}
                    onFiniteNumber={v => {
                        if (v < 0) return;
                        onChange(v);
                    }}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="px"
                    leftIcon={<CornerIcon position={cornerPos} />}
                    className="w-full min-w-0"
                />
            );
        }
        case "borderRadiusLinked": {
            const b = Boolean(value);
            return (
                <button
                    type="button"
                    onClick={() => onChange(!b)}
                    aria-pressed={b}
                    className={controlButtonClass(b)}
                    title="Link corner radii"
                >
                    <span className="text-[10px] font-medium px-1">Link</span>
                </button>
            );
        }
        case "cornerAdvanced": {
            const b = Boolean(value);
            return (
                <button
                    type="button"
                    onClick={() => onChange(!b)}
                    aria-pressed={b}
                    aria-label="Toggle corner breakdown"
                    className={controlButtonClass(b)}
                >
                    <Maximize2 className="w-4 h-4" />
                </button>
            );
        }
        case "borderColor": {
            const raw = typeof value === "string" ? value : String(value ?? "");
            const cv = parseColorValue(raw, { hex: "#000000", alpha: 1 });
            return (
                <ColorPickerTrigger
                    value={cv}
                    displayMode="icon"
                    allowOpacity={false}
                    onChange={(next: ColorValue) => onChange(colorValueToCss(next))}
                />
            );
        }
        case "borderWidth": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={String(n)}
                    draftResetKey={`${draftResetKey}-bw`}
                    onFiniteNumber={v => {
                        if (v < 0) return;
                        onChange(v);
                    }}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="px"
                    leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                    className="w-full min-w-0"
                />
            );
        }
        case "borderStyle": {
            const v = String(value ?? "solid");
            return (
                <Select
                    value={v}
                    options={BORDER_STYLE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "backgroundImage": {
            const v = typeof value === "string" ? value : String(value ?? "");
            return (
                <input
                    type="text"
                    className="w-full min-w-0 rounded-lg border border-white/10 bg-transparent px-2 py-1.5 text-xs text-gray-200"
                    value={v}
                    onChange={e => onChange(e.target.value)}
                    placeholder="URL or asset ref"
                />
            );
        }
        case "backgroundFit": {
            const v = String(value ?? "cover");
            return (
                <Select
                    value={v}
                    options={[
                        { value: "cover", label: "Cover" },
                        { value: "contain", label: "Contain" },
                        { value: "stretch", label: "Stretch" },
                        { value: "tile", label: "Tile" },
                    ]}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "imageFill": {
            const fillField: ImageFillFieldDefinition<UIInspectorData> = {
                type: "imageFill",
                id: "appearance.container.imageFill",
                label: "Image fill",
                getValue: () => {
                    if (value && typeof value === "object" && "mode" in (value as object)) {
                        return value as ImageFill;
                    }
                    return normalizeImageFill(rl);
                },
                setValue: (_d, v) => onChange(v),
            };
            return <ImageFillField field={fillField} data={inspectorData} onSaving={onSaving} />;
        }
        case "fillType": {
            const v = String(value ?? "color");
            return (
                <Select
                    value={v === "image" ? "image" : "color"}
                    options={FILL_TYPE_OPTIONS}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "fillVisible": {
            const visible = Boolean(value);
            return (
                <button
                    type="button"
                    onClick={() => onChange(!visible)}
                    aria-pressed={visible}
                    aria-label="Toggle fill visibility"
                    className={controlButtonClass(visible)}
                >
                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
            );
        }
        case "fillOpacity": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 1;
            const percent = formatPercentDisplay(n);
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={percent}
                    draftResetKey={`${draftResetKey}-fo`}
                    onFiniteNumber={v => {
                        const clamped = Math.min(100, Math.max(0, v));
                        onChange(clamped / 100);
                    }}
                    inputMode="decimal"
                    unit="%"
                    min={0}
                    max={100}
                    precision={null}
                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                    className="w-full min-w-0"
                />
            );
        }
        case "strokeVisible": {
            const visible = Boolean(value);
            return (
                <button
                    type="button"
                    onClick={() => onChange(!visible)}
                    aria-pressed={visible}
                    aria-label="Toggle border visibility"
                    className={controlButtonClass(visible)}
                >
                    {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
            );
        }
        case "strokeOpacity": {
            const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 1;
            const percent = formatPercentDisplay(n);
            return (
                <NumericDraftEnhancedInput
                    committedDisplay={percent}
                    draftResetKey={`${draftResetKey}-so`}
                    onFiniteNumber={v => {
                        const clamped = Math.min(100, Math.max(0, v));
                        onChange(clamped / 100);
                    }}
                    inputMode="decimal"
                    unit="%"
                    min={0}
                    max={100}
                    precision={null}
                    className="w-full min-w-0"
                />
            );
        }
        case "strokeAlign": {
            const v = String(value ?? "center");
            return (
                <Select
                    value={v}
                    options={STROKE_ALIGN_OPTIONS}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "strokeSide": {
            const v = String(value ?? "all");
            if (!isValidStrokeSideSpec(v)) {
                return <span className="text-xs text-amber-200/90">{v}</span>;
            }
            const parsed = parseStrokeSideSpec(v);
            const isMultiSide = parsed.kind === "edges" && parsed.edges.size > 1;
            if (isMultiSide) {
                return (
                    <div className="space-y-1 min-w-0">
                        <p className="text-xs text-gray-500 leading-snug">
                            Multiple sides — use the compact Border panel to edit.
                        </p>
                        <span className="text-xs font-mono text-gray-300 break-all">{v}</span>
                    </div>
                );
            }
            return (
                <Select
                    value={v}
                    options={STROKE_SIDE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        case "borderJoin": {
            const v = String(value ?? "miter");
            return (
                <Select
                    value={v}
                    options={STROKE_JOIN_OPTIONS}
                    fullWidth
                    onChange={next => onChange(String(next))}
                />
            );
        }
        default:
            return (
                <span className="text-xs text-gray-500">
                    {String(value ?? "")}
                </span>
            );
    }
}
