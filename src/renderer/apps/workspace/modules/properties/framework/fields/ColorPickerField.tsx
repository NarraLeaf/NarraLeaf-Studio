import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import {
    ColorPickerFieldDefinition,
    ColorPickerGroupFieldDefinition,
    ColorValue,
    ColorMode,
    ColorDisplayMode,
} from "../types";
import { FieldLayout } from "./FieldLayout";
import {
    clamp,
    colorValueToCss,
    hexToRgb,
    normalizeHex,
    rgbToHex,
} from "../utils/colorUtils";

const DEFAULT_COLOR_MODES: ColorMode[] = ["hex", "rgb", "hsl"];
const HUE_GRADIENT_STOPS = [
    "hsl(0, 100%, 50%)",
    "hsl(60, 100%, 50%)",
    "hsl(120, 100%, 50%)",
    "hsl(180, 100%, 50%)",
    "hsl(240, 100%, 50%)",
    "hsl(300, 100%, 50%)",
    "hsl(360, 100%, 50%)",
];

interface ColorState {
    hue: number;
    saturation: number;
    lightness: number;
    alpha: number;
    hex: string;
}

interface ColorPickerTriggerProps {
    value: ColorValue;
    displayMode?: ColorDisplayMode;
    colorModes?: ColorMode[];
    allowOpacity?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    onChange: (value: ColorValue) => void;
}

function rgbToHsl(r: number, g: number, b: number) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const delta = max - min;
        s = delta / (1 - Math.abs(2 * l - 1));
        switch (max) {
            case r:
                h = ((g - b) / delta) % 6;
                break;
            case g:
                h = (b - r) / delta + 2;
                break;
            case b:
                h = (r - g) / delta + 4;
                break;
        }
        h *= 60;
        if (h < 0) {
            h += 360;
        }
    }

    return {
        h,
        s: s * 100,
        l: l * 100,
    };
}

function hslToRgb(h: number, s: number, l: number) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h >= 0 && h < 60) {
        r = c;
        g = x;
    } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
    } else if (h >= 120 && h < 180) {
        g = c;
        b = x;
    } else if (h >= 180 && h < 240) {
        g = x;
        b = c;
    } else if (h >= 240 && h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    return {
        r: (r + m) * 255,
        g: (g + m) * 255,
        b: (b + m) * 255,
    };
}

function deriveColorState(value: ColorValue): ColorState {
    const normalizedHex = normalizeHex(value.hex) || "#FFFFFF";
    const { r, g, b } = hexToRgb(normalizedHex);
    const { h, s, l } = rgbToHsl(r, g, b);
    return {
        hue: h,
        saturation: s,
        lightness: l,
        alpha: clamp(value.alpha ?? 1, 0, 1),
        hex: normalizedHex,
    };
}

function ColorPickerTrigger({
    value,
    displayMode = "icon",
    colorModes,
    allowOpacity = true,
    disabled = false,
    readOnly = false,
    onChange,
}: ColorPickerTriggerProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [colorState, setColorState] = useState(() => deriveColorState(value));
    const actualModes = useMemo(
        () => (colorModes && colorModes.length > 0 ? colorModes : DEFAULT_COLOR_MODES),
        [colorModes]
    );
    const [activeMode, setActiveMode] = useState<ColorMode>(actualModes[0]);

    useEffect(() => {
        if (actualModes.includes(activeMode)) {
            return;
        }
        setActiveMode(actualModes[0]);
    }, [actualModes, activeMode]);

    useEffect(() => {
        setColorState((prev) => {
            const next = deriveColorState(value);
            if (value.alpha === undefined) {
                next.alpha = prev.alpha;
            }
            return next;
        });
    }, [value]);

    const notifyChange = useCallback(
        (state: ColorState) => {
            onChange({
                hex: state.hex,
                alpha: state.alpha,
            });
        },
        [onChange]
    );

    const applyColorState = useCallback(
        (change: (prev: ColorState) => Partial<ColorState>) => {
            setColorState((prev) => {
                const intermediate = {
                    ...prev,
                    ...change(prev),
                };
                const { r, g, b } = hslToRgb(
                    intermediate.hue,
                    intermediate.saturation,
                    intermediate.lightness
                );
                const normalized: ColorState = {
                    ...intermediate,
                    hex: rgbToHex(r, g, b),
                };
                notifyChange(normalized);
                return normalized;
            });
        },
        [notifyChange]
    );

    const openPicker = useCallback(() => {
        if (disabled || readOnly) return;
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPanelPosition({ left: rect.left, top: rect.bottom + 6 });
        setIsOpen(true);
    }, [disabled, readOnly]);

    const closePicker = useCallback(() => {
        setIsOpen(false);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const handleOutside = (event: MouseEvent) => {
            if (
                panelRef.current?.contains(event.target as Node) ||
                triggerRef.current?.contains(event.target as Node)
            ) {
                return;
            }
            closePicker();
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, [isOpen, closePicker]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closePicker();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, closePicker]);

    const handleMapInteraction = useCallback(
        (clientX: number, clientY: number) => {
            const rect = panelRef.current?.querySelector("[data-color-map]")?.getBoundingClientRect();
            if (!rect) return;
            const satur = clamp((clientX - rect.left) / rect.width, 0, 1) * 100;
            const light = clamp(1 - (clientY - rect.top) / rect.height, 0, 1) * 100;
            applyColorState(() => ({
                saturation: satur,
                lightness: light,
            }));
    },
    [applyColorState]
    );

    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (event: MouseEvent) => {
            handleMapInteraction(event.clientX, event.clientY);
        };
        const handleMouseUp = () => {
            setIsDragging(false);
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, handleMapInteraction]);

    const displayColor = useMemo(() => colorValueToCss(colorState), [colorState]);
    const currentRgb = useMemo(() => {
        return hslToRgb(colorState.hue, colorState.saturation, colorState.lightness);
    }, [colorState]);
    const opacityGradient = useMemo(() => {
        const r = Math.round(currentRgb.r);
        const g = Math.round(currentRgb.g);
        const b = Math.round(currentRgb.b);
        return `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0) 0%, rgba(${r}, ${g}, ${b}, 1) 100%)`;
    }, [currentRgb]);

    const handleHexChange = useCallback(
        (next: string) => {
            const normalized = normalizeHex(next);
            if (!normalized) return;
            const { r, g, b } = hexToRgb(normalized);
            const { h, s, l } = rgbToHsl(r, g, b);
            applyColorState(() => ({
                hue: h,
                saturation: s,
                lightness: l,
            }));
        },
        [applyColorState]
    );

    const handleRgbChange = useCallback(
        (channel: "r" | "g" | "b", raw: string) => {
            const parsed = Number.parseInt(raw, 10);
            if (!Number.isFinite(parsed)) return;
            const nextRgb = {
                r: clamp(channel === "r" ? parsed : currentRgb.r, 0, 255),
                g: clamp(channel === "g" ? parsed : currentRgb.g, 0, 255),
                b: clamp(channel === "b" ? parsed : currentRgb.b, 0, 255),
            };
            const { h, s, l } = rgbToHsl(nextRgb.r, nextRgb.g, nextRgb.b);
            applyColorState(() => ({
                hue: h,
                saturation: s,
                lightness: l,
            }));
        },
        [applyColorState, currentRgb]
    );

    const handleHslChange = useCallback(
        (channel: "h" | "s" | "l", raw: string) => {
            const parsed = Number.parseFloat(raw);
            if (!Number.isFinite(parsed)) return;
            const nextH =
                channel === "h" ? clamp(parsed, 0, 360) : colorState.hue;
            const nextS =
                channel === "s" ? clamp(parsed, 0, 100) : colorState.saturation;
            const nextL =
                channel === "l" ? clamp(parsed, 0, 100) : colorState.lightness;
            applyColorState(() => ({
                hue: nextH,
                saturation: nextS,
                lightness: nextL,
            }));
        },
        [applyColorState]
    );

    const handleAlphaChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const parsed = Number.parseFloat(event.target.value);
            if (!Number.isFinite(parsed)) return;
            applyColorState(() => ({
                alpha: clamp(parsed, 0, 1),
            }));
        },
        [applyColorState]
    );

    const renderModeInputs = () => {
        if (activeMode === "hex") {
            return (
                <EnhancedInput
                    value={colorState.hex}
                    onChange={handleHexChange}
                    inputMode="text"
                    className="mt-3"
                />
            );
        }

        if (activeMode === "rgb") {
            return (
                <div className="grid grid-cols-3 gap-2 mt-3">
                    {[
                        { label: "R", channel: "r", value: Math.round(currentRgb.r) },
                        { label: "G", channel: "g", value: Math.round(currentRgb.g) },
                        { label: "B", channel: "b", value: Math.round(currentRgb.b) },
                    ].map(({ label, channel, value }) => (
                        <div key={channel} className="space-y-1">
                            <div className="text-xs text-gray-400">{label}</div>
                            <EnhancedInput
                                value={String(value)}
                                onChange={(next) => handleRgbChange(channel as "r" | "g" | "b", next)}
                                inputMode="numeric"
                            />
                        </div>
                    ))}
                </div>
            );
        }

        return (
            <div className="grid grid-cols-3 gap-2 mt-3">
                {[
                    { label: "H", channel: "h", value: Math.round(colorState.hue) },
                    { label: "S", channel: "s", value: Math.round(colorState.saturation) },
                    { label: "L", channel: "l", value: Math.round(colorState.lightness) },
                ].map(({ label, channel, value }) => (
                    <div key={channel} className="space-y-1">
                        <div className="text-xs text-gray-400">{label}</div>
                        <EnhancedInput
                            value={String(value)}
                            onChange={(next) =>
                                handleHslChange(channel as "h" | "s" | "l", next)
                            }
                            inputMode="decimal"
                        />
                    </div>
                ))}
            </div>
        );
    };

    const panelContent = (
        <div
            ref={panelRef}
            className="w-80 rounded-2xl border border-white/10 bg-[#1e1f22] p-4 shadow-2xl"
            style={{
                position: "absolute",
                zIndex: 60,
                left: panelPosition.left,
                top: panelPosition.top,
            }}
        >
            <div
                className="relative h-32 rounded-xl border border-white/10 overflow-hidden cursor-crosshair"
                data-color-map
                onMouseDown={(event) => {
                    setIsDragging(true);
                    handleMapInteraction(event.clientX, event.clientY);
                }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        background: `linear-gradient(90deg, #ffffff 0%, hsl(${colorState.hue}, 100%, 50%) 100%)`,
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,1))",
                    }}
                />
                <span
                    className="absolute w-3 h-3 border border-white/80 rounded-full -translate-x-1/2 -translate-y-1/2"
                    style={{
                        left: `${colorState.saturation}%`,
                        top: `${100 - colorState.lightness}%`,
                        boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
                    }}
                />
            </div>

            <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Hue</span>
                    <span>{Math.round(colorState.hue)}°</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={360}
                    value={colorState.hue}
                    onChange={(event) =>
                        applyColorState(() => ({ hue: Number(event.target.value) }))
                    }
                    className="w-full h-2 rounded-full appearance-none accent-transparent"
                    style={{
                        background: `linear-gradient(90deg, ${HUE_GRADIENT_STOPS.join(", ")})`,
                    }}
                />
            </div>

            <div className="mt-3 flex gap-2">
                {actualModes.map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        className={`flex-1 rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                            activeMode === mode
                                ? "border-primary text-white"
                                : "border-white/10 text-gray-400 hover:border-white/40"
                        }`}
                        onClick={() => setActiveMode(mode)}
                    >
                        {mode.toUpperCase()}
                    </button>
                ))}
            </div>

            {renderModeInputs()}

            {allowOpacity && (
                <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Opacity</span>
                        <span>{Math.round(colorState.alpha * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={colorState.alpha}
                        onChange={handleAlphaChange}
                        className="w-full h-2 rounded-full appearance-none accent-transparent"
                        style={{ background: opacityGradient }}
                    />
                </div>
            )}
        </div>
    );

    const triggerContent = (
        <button
            ref={triggerRef}
            type="button"
            onClick={isOpen ? closePicker : openPicker}
            disabled={disabled || readOnly}
            className={`
                flex items-center rounded-md border border-white/20 bg-[#17181a] px-3 py-2 text-sm
                text-gray-200 transition focus:outline-none focus:ring-2 focus:ring-primary/50
                ${displayMode === "icon" ? "gap-2" : "gap-3"}
            `}
        >
            <span
                className="h-5 w-5 rounded-full border border-white/30"
                style={{ backgroundColor: displayColor }}
            />
            {displayMode === "icon-hex" && (
                <span className="text-xs text-gray-200 font-mono tracking-wide">
                    {colorState.hex}
                </span>
            )}
        </button>
    );

    if (typeof document === "undefined") {
        return (
            <>
                {triggerContent}
                {isOpen && panelContent}
            </>
        );
    }

    return (
        <>
            {triggerContent}
            {isOpen && createPortal(panelContent, document.body)}
        </>
    );
}

interface ColorPickerFieldProps<TData> {
    field: ColorPickerFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function ColorPickerField<TData>({ field, data, onSaving }: ColorPickerFieldProps<TData>) {
    const currentValue = field.getValue(data);

    const handleChange = useCallback(
        async (next: ColorValue) => {
            onSaving(true);
            try {
                await field.setValue(data, next);
            } catch (error) {
                console.error("ColorPickerField: failed to save color", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving]
    );

    return (
        <FieldLayout field={field}>
            <ColorPickerTrigger
                value={currentValue}
                displayMode={field.displayMode ?? "icon-hex"}
                colorModes={field.colorModes}
                allowOpacity={field.allowOpacity}
                disabled={field.disabled}
                readOnly={field.readOnly}
                onChange={handleChange}
            />
        </FieldLayout>
    );
}

interface ColorPickerGroupFieldProps<TData> {
    field: ColorPickerGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function ColorPickerGroupField<TData>({
    field,
    data,
    onSaving,
}: ColorPickerGroupFieldProps<TData>) {
    const currentValue = field.getValue(data);
    const alphaPercent = Math.round((currentValue.alpha ?? 1) * 100);

    const setColor = useCallback(
        async (value: ColorValue) => {
            onSaving(true);
            try {
                await field.setValue(data, value);
            } catch (error) {
                console.error("ColorPickerGroupField: failed to save color", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving]
    );

    const handleAlphaChange = useCallback(
        (raw: string) => {
            const parsed = Number.parseFloat(raw);
            if (!Number.isFinite(parsed)) return;
            const next = clamp(parsed / 100, 0, 1);
            setColor({
                hex: currentValue.hex,
                alpha: next,
            });
        },
        [currentValue.hex, setColor]
    );

    return (
        <FieldLayout field={field}>
            <div className="flex items-center gap-3">
                <ColorPickerTrigger
                    value={currentValue}
                    displayMode={field.displayMode}
                    colorModes={field.colorModes}
                    allowOpacity={false}
                    disabled={field.disabled}
                    readOnly={field.readOnly}
                    onChange={setColor}
                />
                <EnhancedInput
                    value={String(alphaPercent)}
                    onChange={handleAlphaChange}
                    inputMode="numeric"
                    unit="%"
                    type="number"
                    min={0}
                    max={100}
                    leftIcon={<span className="text-xs text-gray-400">α</span>}
                    className="flex-1"
                />
            </div>
        </FieldLayout>
    );
}
