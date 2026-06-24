export type UISliderOrientation = "horizontal" | "vertical";

export type UISliderChildSlot = "track" | "handle";

export type UISliderElementExtra = {
    sliderSlot?: UISliderChildSlot;
    runtimeVariantOverrideId?: string;
};

export type UISliderWidgetProps = {
    value: number;
    min: number;
    max: number;
    step: number;
    orientation: UISliderOrientation;
    trackElementId?: string | null;
    handleElementId?: string | null;
};

export type UISliderRange = {
    min: number;
    max: number;
    step: number;
};

export type UISliderRuntimeValue = UISliderRange & {
    value: number;
    normalizedValue: number;
};

export const defaultSliderWidgetProps: UISliderWidgetProps = {
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    orientation: "horizontal",
    trackElementId: null,
    handleElementId: null,
};

export function getUISliderChildSlot(extra: Record<string, unknown> | undefined): UISliderChildSlot | null {
    const slot = extra?.sliderSlot;
    return slot === "track" || slot === "handle" ? slot : null;
}

function finiteOr(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function normalizeSliderRange(input: Partial<UISliderRange> | undefined): UISliderRange {
    const base = defaultSliderWidgetProps;
    const min = finiteOr(input?.min, base.min);
    let max = finiteOr(input?.max, base.max);
    if (max <= min) {
        max = min + 1;
    }
    const rawStep = finiteOr(input?.step, base.step);
    const step = rawStep > 0 ? rawStep : 0;
    return { min, max, step };
}

export function clampSliderValue(value: unknown, rangeInput: Partial<UISliderRange> | undefined): number {
    const range = normalizeSliderRange(rangeInput);
    const raw = finiteOr(value, range.min);
    const clamped = Math.max(range.min, Math.min(range.max, raw));
    if (range.step <= 0) {
        return clamped;
    }
    const steps = Math.round((clamped - range.min) / range.step);
    const snapped = range.min + steps * range.step;
    return Math.max(range.min, Math.min(range.max, snapped));
}

export function sliderValueToNormalized(value: unknown, rangeInput: Partial<UISliderRange> | undefined): number {
    const range = normalizeSliderRange(rangeInput);
    const clamped = clampSliderValue(value, range);
    const span = range.max - range.min;
    return span > 0 ? Math.max(0, Math.min(1, (clamped - range.min) / span)) : 0;
}

export function normalizedSliderValueToMapped(normalizedValue: unknown, rangeInput: Partial<UISliderRange> | undefined): number {
    const range = normalizeSliderRange(rangeInput);
    const n = finiteOr(normalizedValue, 0);
    const normalized = Math.max(0, Math.min(1, n));
    return clampSliderValue(range.min + (range.max - range.min) * normalized, range);
}

export function normalizeSliderProps(raw: Record<string, unknown> | undefined): UISliderWidgetProps {
    const range = normalizeSliderRange(raw as Partial<UISliderRange> | undefined);
    const orientation = raw?.orientation === "vertical" ? "vertical" : "horizontal";
    const trackElementId = typeof raw?.trackElementId === "string" ? raw.trackElementId : null;
    const handleElementId = typeof raw?.handleElementId === "string" ? raw.handleElementId : null;
    return {
        ...range,
        value: clampSliderValue(raw?.value ?? defaultSliderWidgetProps.value, range),
        orientation,
        trackElementId,
        handleElementId,
    };
}

export function resolveSliderRuntimeValue(raw: Record<string, unknown> | undefined): UISliderRuntimeValue {
    const props = normalizeSliderProps(raw);
    return {
        min: props.min,
        max: props.max,
        step: props.step,
        value: props.value,
        normalizedValue: sliderValueToNormalized(props.value, props),
    };
}
