import {
    useCallback,
    useEffect,
    useLayoutEffect,
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
const PANEL_SPACING = 6;
const PANEL_EDGE_PADDING = 8;
/** Ignore stale `value` from async setValue briefly after map drag (ms). */
const MAP_PUSH_STALE_MS = 180;

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

function rgbToHsv(r: number, g: number, b: number) {
    const rr = clamp(r / 255, 0, 1);
    const gg = clamp(g / 255, 0, 1);
    const bb = clamp(b / 255, 0, 1);
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const delta = max - min;
    let h = 0;

    if (delta !== 0) {
        if (max === rr) {
            h = ((gg - bb) / delta) % 6;
        } else if (max === gg) {
            h = (bb - rr) / delta + 2;
        } else {
            h = (rr - gg) / delta + 4;
        }
        h *= 60;
        if (h < 0) {
            h += 360;
        }
    }

    const v = max;
    const s = max === 0 ? 0 : delta / max;

    return {
        h,
        s,
        v,
    };
}

function hsvToRgb(h: number, s: number, v: number) {
    const normalizedHue = ((h % 360) + 360) % 360;
    const clampedS = clamp(s, 0, 1);
    const clampedV = clamp(v, 0, 1);
    const c = clampedV * clampedS;
    const x = c * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
    const m = clampedV - c;
    let r = 0;
    let g = 0;
    let b = 0;

    if (normalizedHue >= 0 && normalizedHue < 60) {
        r = c;
        g = x;
    } else if (normalizedHue >= 60 && normalizedHue < 120) {
        r = x;
        g = c;
    } else if (normalizedHue >= 120 && normalizedHue < 180) {
        g = c;
        b = x;
    } else if (normalizedHue >= 180 && normalizedHue < 240) {
        g = x;
        b = c;
    } else if (normalizedHue >= 240 && normalizedHue < 300) {
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

/** HSL has no unique hue for grays / white / black; rgbToHsl reports h=0. */
function isAchromaticHsl(s: number, l: number): boolean {
    return s < 0.01 || l < 0.01 || l > 99.99;
}

export function ColorPickerTrigger({
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
    const [adjustedPanelPosition, setAdjustedPanelPosition] = useState(panelPosition);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingMapRef = useRef(false);
    const [layoutTick, setLayoutTick] = useState(0);
    const [colorState, setColorState] = useState(() => deriveColorState(value));
    const colorStateRef = useRef(colorState);
    const pendingPushHexRef = useRef<string | null>(null);
    const lastMapPushAtRef = useRef(0);
    const lastMapInteractionRef = useRef(false);
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
            const incomingHex = normalizeHex(value.hex) || "#FFFFFF";

            if (isDraggingMapRef.current) {
                return prev;
            }

            // Async field.setValue: parent may still hold an older hex while local state already matches our last push.
            const mapPushStale =
                lastMapInteractionRef.current &&
                pendingPushHexRef.current != null &&
                performance.now() - lastMapPushAtRef.current < MAP_PUSH_STALE_MS &&
                incomingHex !== prev.hex &&
                prev.hex === pendingPushHexRef.current;

            if (mapPushStale) {
                return prev;
            }

            // Same hex: do not re-derive HSL (float/hex rounding differs from HSV map path and causes thumb flicker).
            if (incomingHex === prev.hex) {
                if (value.alpha !== undefined && Math.abs((value.alpha ?? 1) - prev.alpha) > 1e-6) {
                    const next = { ...prev, alpha: clamp(value.alpha, 0, 1) };
                    colorStateRef.current = next;
                    pendingPushHexRef.current = null;
                    lastMapInteractionRef.current = false;
                    return next;
                }
                pendingPushHexRef.current = null;
                lastMapInteractionRef.current = false;
                return prev;
            }

            const next = deriveColorState(value);
            if (value.alpha === undefined) {
                next.alpha = prev.alpha;
            }
            if (isAchromaticHsl(next.saturation, next.lightness)) {
                next.hue = prev.hue;
            }
            pendingPushHexRef.current = null;
            lastMapInteractionRef.current = false;
            colorStateRef.current = next;
            return next;
        });
    }, [value]);

    useEffect(() => {
        colorStateRef.current = colorState;
    }, [colorState]);

    useEffect(() => {
        isDraggingMapRef.current = isDragging;
    }, [isDragging]);

    const notifyChange = useCallback(
        (state: ColorState) => {
            pendingPushHexRef.current = state.hex;
            onChange({
                hex: state.hex,
                alpha: state.alpha,
            });
        },
        [onChange]
    );

    const mapDragNotifyRafRef = useRef<number | null>(null);

    const flushPendingMapDragNotify = useCallback(() => {
        if (mapDragNotifyRafRef.current != null) {
            cancelAnimationFrame(mapDragNotifyRafRef.current);
            mapDragNotifyRafRef.current = null;
        }
        lastMapPushAtRef.current = performance.now();
        lastMapInteractionRef.current = true;
        notifyChange(colorStateRef.current);
    }, [notifyChange]);

    const scheduleMapDragNotify = useCallback(() => {
        if (mapDragNotifyRafRef.current != null) {
            return;
        }
        mapDragNotifyRafRef.current = requestAnimationFrame(() => {
            mapDragNotifyRafRef.current = null;
            lastMapPushAtRef.current = performance.now();
            lastMapInteractionRef.current = true;
            notifyChange(colorStateRef.current);
        });
    }, [notifyChange]);

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
                colorStateRef.current = normalized;
                lastMapInteractionRef.current = false;
                notifyChange(normalized);
                return normalized;
            });
        },
        [notifyChange]
    );

    const syncAnchorRect = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const calculated = { left: rect.left, top: rect.bottom + PANEL_SPACING };
        setPanelPosition(calculated);
        setAdjustedPanelPosition(calculated);
        setAnchorRect(rect);
    }, []);

    const openPicker = useCallback(() => {
        if (disabled || readOnly) return;
        syncAnchorRect();
        setIsOpen(true);
    }, [disabled, readOnly, syncAnchorRect]);

    const closePicker = useCallback(() => {
        if (mapDragNotifyRafRef.current != null || isDraggingMapRef.current) {
            flushPendingMapDragNotify();
        }
        isDraggingMapRef.current = false;
        setIsDragging(false);
        setIsOpen(false);
        setAnchorRect(null);
    }, [flushPendingMapDragNotify]);

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
        setAdjustedPanelPosition(panelPosition);
    }, [panelPosition]);

    useLayoutEffect(() => {
        if (!isOpen || !panelRef.current) return;
        const rect = panelRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const topLimit = Math.max(PANEL_EDGE_PADDING, viewportHeight - rect.height - PANEL_EDGE_PADDING);
        const leftLimit = Math.max(PANEL_EDGE_PADDING, viewportWidth - rect.width - PANEL_EDGE_PADDING);
        const clampTop = (value: number) =>
            Math.min(Math.max(value, PANEL_EDGE_PADDING), topLimit);
        const clampLeft = (value: number) =>
            Math.min(Math.max(value, PANEL_EDGE_PADDING), leftLimit);

        let top = clampTop(panelPosition.top);
        let left = clampLeft(panelPosition.left);

        if (anchorRect) {
            const belowTop = clampTop(anchorRect.bottom + PANEL_SPACING);
            const aboveTop = clampTop(anchorRect.top - rect.height - PANEL_SPACING);
            const spaceBelow = viewportHeight - anchorRect.bottom;
            const spaceAbove = anchorRect.top;

            if (spaceBelow >= rect.height + PANEL_SPACING) {
                top = belowTop;
            } else if (spaceAbove >= rect.height + PANEL_SPACING) {
                top = aboveTop;
            } else if (spaceBelow >= spaceAbove) {
                top = belowTop;
            } else {
                top = aboveTop;
            }

            const spaceRight = viewportWidth - anchorRect.left;
            const spaceLeft = anchorRect.right;
            if (spaceRight >= rect.width) {
                left = clampLeft(anchorRect.left);
            } else if (spaceLeft >= rect.width) {
                left = clampLeft(anchorRect.right - rect.width);
            } else {
                left = clampLeft(anchorRect.left + (anchorRect.width - rect.width) / 2);
            }
        }

        const bottomOverflow = top + rect.height + PANEL_EDGE_PADDING - viewportHeight;
        if (bottomOverflow > 0) {
            top = Math.max(PANEL_EDGE_PADDING, top - bottomOverflow);
        }
        const topOverflow = PANEL_EDGE_PADDING - top;
        if (topOverflow > 0) {
            top = PANEL_EDGE_PADDING;
        }
        const rightOverflow = left + rect.width + PANEL_EDGE_PADDING - viewportWidth;
        if (rightOverflow > 0) {
            left = Math.max(PANEL_EDGE_PADDING, left - rightOverflow);
        }
        const leftOverflow = PANEL_EDGE_PADDING - left;
        if (leftOverflow > 0) {
            left = PANEL_EDGE_PADDING;
        }

        if (top !== adjustedPanelPosition.top || left !== adjustedPanelPosition.left) {
            setAdjustedPanelPosition({ left, top });
        }
    }, [isOpen, panelPosition, adjustedPanelPosition, anchorRect, layoutTick]);

    useEffect(() => {
        if (!isOpen) return;
        let rafId = 0;
        const handleLayoutChange = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            rafId = requestAnimationFrame(() => {
                syncAnchorRect();
            });
        };
        window.addEventListener("resize", handleLayoutChange);
        window.addEventListener("scroll", handleLayoutChange, true);
        return () => {
            window.removeEventListener("resize", handleLayoutChange);
            window.removeEventListener("scroll", handleLayoutChange, true);
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [isOpen, syncAnchorRect]);

    useEffect(() => {
        if (!isOpen || !panelRef.current) return;
        const observer = new ResizeObserver(() => {
            setLayoutTick((tick) => tick + 1);
        });
        observer.observe(panelRef.current);
        return () => {
            observer.disconnect();
        };
    }, [isOpen]);

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

    // 2D map is HSV(s,v) at fixed hue. rgbToHsl maps achromatic RGB to h=0 — preserve prior hue for grays/white/black.
    const handleMapInteraction = useCallback(
        (clientX: number, clientY: number) => {
            const rect = panelRef.current?.querySelector("[data-color-map]")?.getBoundingClientRect();
            if (!rect) return;
            const saturation = clamp((clientX - rect.left) / rect.width, 0, 1);
            const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
            setColorState((prev) => {
                const { r, g, b } = hsvToRgb(prev.hue, saturation, v);
                const { h, s, l } = rgbToHsl(r, g, b);
                const achromatic = isAchromaticHsl(s, l);
                const intermediate = {
                    ...prev,
                    hue: achromatic ? prev.hue : h,
                    saturation: s,
                    lightness: l,
                };
                const normalized: ColorState = {
                    ...intermediate,
                    hex: rgbToHex(r, g, b),
                };
                colorStateRef.current = normalized;
                return normalized;
            });
            scheduleMapDragNotify();
        },
        [scheduleMapDragNotify]
    );

    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (event: MouseEvent) => {
            handleMapInteraction(event.clientX, event.clientY);
        };
        const handleMouseUp = () => {
            flushPendingMapDragNotify();
            isDraggingMapRef.current = false;
            setIsDragging(false);
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, handleMapInteraction, flushPendingMapDragNotify]);

    useEffect(() => {
        return () => {
            if (mapDragNotifyRafRef.current != null) {
                cancelAnimationFrame(mapDragNotifyRafRef.current);
                mapDragNotifyRafRef.current = null;
            }
        };
    }, []);

    const displayColor = useMemo(() => colorValueToCss(colorState), [colorState]);
    const currentRgb = useMemo(() => {
        return hslToRgb(colorState.hue, colorState.saturation, colorState.lightness);
    }, [colorState]);
    const mapCoordinates = useMemo(() => {
        const { s, v } = rgbToHsv(
            currentRgb.r,
            currentRgb.g,
            currentRgb.b
        );
        return {
            saturation: s * 100,
            value: v * 100,
        };
    }, [currentRgb]);
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
                position: "fixed",
                // Above inspector anchored panels (e.g. Effects z-[80]), below modal menus (z-[100]+).
                zIndex: 90,
                left: adjustedPanelPosition.left,
                top: adjustedPanelPosition.top,
                maxHeight: `calc(100vh - ${PANEL_EDGE_PADDING * 2}px)`,
                overflowY: "auto",
            }}
        >
            <div
                className="relative h-32 rounded-xl border border-white/10 overflow-hidden cursor-crosshair"
                data-color-map
                onMouseDown={(event) => {
                    isDraggingMapRef.current = true;
                    setIsDragging(true);
                    handleMapInteraction(event.clientX, event.clientY);
                }}
            >
                <div
                    className="absolute inset-0"
                    style={{ backgroundColor: `hsl(${colorState.hue}, 100%, 50%)` }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background: "linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0) 100%)",
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
                        left: `${mapCoordinates.saturation}%`,
                        top: `${100 - mapCoordinates.value}%`,
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
