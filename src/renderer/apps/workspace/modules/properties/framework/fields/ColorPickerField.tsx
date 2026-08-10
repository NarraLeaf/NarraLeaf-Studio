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
import { useTranslation } from "@/lib/i18n";
import { formatBrandLink } from "@shared/brand/brandLink";
import type { BrandColor } from "@shared/types/brand";
import {
    ColorPickerFieldDefinition,
    ColorPickerGroupFieldDefinition,
    ColorValue,
    ColorMode,
    ColorDisplayMode,
} from "../types";
import { FieldLayout } from "./FieldLayout";
import { useBrandColorLabel, useBrandPalette } from "./brandPalette";
import {
    clamp,
    colorValueToCss,
    hexToRgb,
    normalizeHex,
    normalizeHexInputDraft,
    parseColorValue,
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
const COLOR_PICKER_PANEL_Z_INDEX = 10000;
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
    /**
     * Look, do not touch. The panel still opens - a swatch shows a colour but does not tell you
     * which colour, and a frozen project has to stay readable - but every control inside it is
     * clamped. Use `disabled` for a trigger that should not respond at all.
     */
    readOnly?: boolean;
    /**
     * Accessible name for the trigger. Worth passing in `swatch` mode especially: that one renders
     * a bare coloured button with no text in it, so without this it is announced as "button".
     */
    ariaLabel?: string;
    onChange: (value: ColorValue) => void;
    /** Fired once when the picker panel closes, with the final settled color. */
    onCommit?: (value: ColorValue) => void;
    /**
     * Show the project palette as a row of swatches at the bottom of the panel. Off by default, and
     * each call site turns it on for itself: picking one emits a `ColorValue` carrying a `link`, and
     * a field whose write side still stores the literal would drop it silently.
     */
    brandPalette?: boolean;
    /**
     * Brand ids this picker must not offer. For the Brand panel editing the palette itself, where
     * an entry may not point at itself or at anything that would close a ring.
     */
    brandExclude?: string[];
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

function stopPickerPointerBubble(event: { stopPropagation: () => void }) {
    event.stopPropagation();
}

export function ColorPickerTrigger({
    value,
    displayMode = "icon",
    colorModes,
    allowOpacity = true,
    disabled = false,
    readOnly = false,
    ariaLabel,
    onChange,
    onCommit,
    brandPalette = false,
    brandExclude,
}: ColorPickerTriggerProps) {
    const { t } = useTranslation();
    // Subscribed unconditionally (hooks are), so a palette edit repaints an open picker's swatches.
    const palette = useBrandPalette();
    const brandColorLabel = useBrandColorLabel();
    const brandColors = useMemo(() => {
        if (!brandPalette) {
            return [];
        }
        const excluded = new Set(brandExclude ?? []);
        return palette.list().filter((color) => !excluded.has(color.id));
    }, [brandExclude, brandPalette, palette]);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0 });
    const [adjustedPanelPosition, setAdjustedPanelPosition] = useState(panelPosition);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingMapRef = useRef(false);
    const [layoutTick, setLayoutTick] = useState(0);
    /**
     * `value`, with a link's colour read from the palette as it stands right now.
     *
     * A caller hands us the `ColorValue` it parsed when *it* last rendered, and a palette edit does
     * not re-render it - the document did not change. Resolving here instead means the swatch and
     * the hex label follow the palette on the spot, in every one of the twenty-odd call sites,
     * without each of them having to subscribe. `palette` is a fresh instance after every edit, so
     * this memo and the sync effect below both notice.
     *
     * The author's own alpha wins over the entry's: it is this field's setting, not the palette's.
     */
    const resolvedValue = useMemo<ColorValue>(() => {
        if (!value.link) {
            return value;
        }
        const css = palette.resolveCss(value.link);
        if (!css) {
            return value;
        }
        const fromPalette = parseColorValue(css, { hex: value.hex, alpha: value.alpha ?? 1 });
        return { hex: fromPalette.hex, alpha: value.alpha ?? fromPalette.alpha, link: value.link };
    }, [palette, value]);
    const [colorState, setColorState] = useState(() => deriveColorState(resolvedValue));
    const [hexDraft, setHexDraft] = useState(() => colorState.hex);
    const [isEditingHex, setIsEditingHex] = useState(false);
    // The brand entry this value points at, if any. Kept beside `colorState` rather than inside it
    // because it is not part of the colour: every edit in the map, the hue bar or the numeric inputs
    // drops it, and only the opacity slider and a swatch pick carry it forward.
    const [activeBrandLink, setActiveBrandLink] = useState<string | undefined>(value.link);
    const activeBrandLinkRef = useRef(activeBrandLink);
    activeBrandLinkRef.current = activeBrandLink;
    const colorStateRef = useRef(colorState);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;
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
            const incomingHex = normalizeHex(resolvedValue.hex) || "#FFFFFF";

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
                if (resolvedValue.alpha !== undefined && Math.abs((resolvedValue.alpha ?? 1) - prev.alpha) > 1e-6) {
                    const next = { ...prev, alpha: clamp(resolvedValue.alpha, 0, 1) };
                    colorStateRef.current = next;
                    pendingPushHexRef.current = null;
                    lastMapInteractionRef.current = false;
                    return next;
                }
                pendingPushHexRef.current = null;
                lastMapInteractionRef.current = false;
                return prev;
            }

            const next = deriveColorState(resolvedValue);
            if (resolvedValue.alpha === undefined) {
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
    }, [resolvedValue]);

    useEffect(() => {
        colorStateRef.current = colorState;
    }, [colorState]);

    // What the field actually kept. A call site whose write side stores the resolved literal rather
    // than the link hands back a value with no link, and the ring clears - which is the truth.
    useEffect(() => {
        setActiveBrandLink(value.link);
    }, [value.link]);

    useEffect(() => {
        if (activeMode !== "hex") {
            if (isEditingHex) {
                setIsEditingHex(false);
            }
            setHexDraft(colorState.hex);
            return;
        }
        if (!isEditingHex) {
            setHexDraft(colorState.hex);
        }
    }, [activeMode, colorState.hex, isEditingHex]);

    useEffect(() => {
        isDraggingMapRef.current = isDragging;
    }, [isDragging]);

    const notifyChange = useCallback(
        (state: ColorState, link?: string) => {
            pendingPushHexRef.current = state.hex;
            onChange({
                hex: state.hex,
                alpha: state.alpha,
                ...(link ? { link } : {}),
            });
        },
        [onChange]
    );

    /**
     * Forget the brand link, because the author just made a colour of their own.
     *
     * Every path that moves the hue, saturation, lightness or the numeric inputs calls this: the
     * value stops being "the brand colour" the moment it stops being that colour. The opacity slider
     * does not - a link at an opacity is a thing the link grammar can say.
     */
    const dropBrandLink = useCallback(() => {
        if (activeBrandLinkRef.current === undefined) {
            return;
        }
        activeBrandLinkRef.current = undefined;
        setActiveBrandLink(undefined);
    }, []);

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
        (change: (prev: ColorState) => Partial<ColorState>, keepBrandLink = false) => {
            const link = keepBrandLink ? activeBrandLinkRef.current : undefined;
            if (!keepBrandLink) {
                dropBrandLink();
            }
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
                notifyChange(normalized, link);
                return normalized;
            });
        },
        [dropBrandLink, notifyChange]
    );

    const syncAnchorRect = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const calculated = { left: rect.left, top: rect.bottom + PANEL_SPACING };
        setPanelPosition(calculated);
        setAdjustedPanelPosition(calculated);
        setAnchorRect(rect);
    }, []);

    /**
     * Read-only opens the panel; it does not refuse to.
     *
     * Refusing was the old behaviour and it broke the rule the freeze pass is built on: a frozen
     * project must still be readable (`fieldReadOnlyStrategy.ts` makes the same exception for the
     * blueprint preview, for the same reason). A swatch is a colour you can see but not a value you
     * can read - "is this #40A8C4 or #3FA7C3" is answerable only inside the panel - and a Brand page
     * that is nothing but swatches would otherwise say nothing at all while frozen.
     *
     * Every control inside the panel is clamped instead; see `readOnly` below the map.
     */
    const openPicker = useCallback(() => {
        if (disabled) return;
        syncAnchorRect();
        setIsOpen(true);
    }, [disabled, syncAnchorRect]);

    const closePicker = useCallback(() => {
        if (mapDragNotifyRafRef.current != null || isDraggingMapRef.current) {
            flushPendingMapDragNotify();
        }
        isDraggingMapRef.current = false;
        setIsDragging(false);
        setIsOpen(false);
        setAnchorRect(null);
        onCommitRef.current?.({
            hex: colorStateRef.current.hex,
            alpha: colorStateRef.current.alpha,
            ...(activeBrandLinkRef.current ? { link: activeBrandLinkRef.current } : {}),
        });
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
        document.addEventListener("mousedown", handleOutside, true);
        return () => document.removeEventListener("mousedown", handleOutside, true);
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
            dropBrandLink();
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
        [dropBrandLink, scheduleMapDragNotify]
    );

    useEffect(() => {
        if (!isDragging) return;
        const handlePointerMove = (event: PointerEvent) => {
            event.preventDefault();
            handleMapInteraction(event.clientX, event.clientY);
        };
        const handlePointerUp = () => {
            flushPendingMapDragNotify();
            isDraggingMapRef.current = false;
            setIsDragging(false);
        };
        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
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

    // `colorState` is the colour the panel is editing and deliberately carries no link (every edit
    // in it clears one). The trigger, though, is showing the *field's* value, so it paints what the
    // link resolves to - otherwise a swatch keeps the colour the palette used to have.
    const displayColor = useMemo(
        () => colorValueToCss({ hex: colorState.hex, alpha: colorState.alpha, link: activeBrandLink ?? undefined }),
        [activeBrandLink, colorState],
    );
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
    const mapThumbPosition = useMemo(
        () => ({
            left: clamp(mapCoordinates.saturation, 3, 97),
            top: clamp(100 - mapCoordinates.value, 3, 97),
        }),
        [mapCoordinates],
    );

    const handleHexChange = useCallback(
        (next: string) => {
            const draft = normalizeHexInputDraft(next);
            setHexDraft(draft);
            const normalized = normalizeHex(draft);
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

    const handleHexBlur = useCallback(() => {
        setIsEditingHex(false);
        const normalized = normalizeHex(hexDraft);
        setHexDraft(normalized ?? colorStateRef.current.hex);
    }, [hexDraft]);

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
            // Opacity alone keeps the link: `nlbrand:<id>/<alpha>` is a thing the grammar can store,
            // and dimming the brand colour is not choosing a different one.
            applyColorState(
                () => ({
                    alpha: clamp(parsed, 0, 1),
                }),
                true,
            );
        },
        [applyColorState]
    );

    const handleBrandPick = useCallback(
        (color: BrandColor) => {
            // Resolved through the same parser the field reads with, so the swatch and whatever the
            // value paints as later can never disagree. No link on the result means the entry is
            // broken or circular; picking it would store a reference to a colour that does not exist.
            const picked = parseColorValue(formatBrandLink(color.id), colorStateRef.current);
            if (!picked.link) {
                return;
            }
            const { r, g, b } = hexToRgb(picked.hex);
            const { h, s, l } = rgbToHsl(r, g, b);
            activeBrandLinkRef.current = color.id;
            setActiveBrandLink(color.id);
            setColorState((prev) => {
                const next: ColorState = {
                    // The map's hue bar has nowhere to point for a grey, so it keeps the one it had.
                    hue: isAchromaticHsl(s, l) ? prev.hue : h,
                    saturation: s,
                    lightness: l,
                    // The author's opacity survives the pick: they chose which colour, not how much
                    // of it.
                    alpha: prev.alpha,
                    hex: picked.hex,
                };
                colorStateRef.current = next;
                lastMapInteractionRef.current = false;
                notifyChange(next, color.id);
                return next;
            });
        },
        [notifyChange],
    );

    const renderModeInputs = () => {
        if (activeMode === "hex") {
            return (
                <EnhancedInput
                    value={hexDraft}
                    onChange={handleHexChange}
                    onFocus={() => setIsEditingHex(true)}
                    onBlur={handleHexBlur}
                    inputMode="text"
                    readOnly={readOnly}
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
                            <div className="text-xs text-fg-muted">{label}</div>
                            <EnhancedInput
                                value={String(value)}
                                onChange={(next) => handleRgbChange(channel as "r" | "g" | "b", next)}
                                inputMode="numeric"
                                readOnly={readOnly}
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
                        <div className="text-xs text-fg-muted">{label}</div>
                        <EnhancedInput
                            value={String(value)}
                            onChange={(next) =>
                                handleHslChange(channel as "h" | "s" | "l", next)
                            }
                            inputMode="decimal"
                            readOnly={readOnly}
                        />
                    </div>
                ))}
            </div>
        );
    };

    const panelContent = (
        <div
            ref={panelRef}
            data-color-picker-panel
            className="nodrag nowheel w-80 rounded-2xl border border-edge bg-surface-raised p-4 shadow-2xl"
            style={{
                position: "fixed",
                zIndex: COLOR_PICKER_PANEL_Z_INDEX,
                left: adjustedPanelPosition.left,
                top: adjustedPanelPosition.top,
                maxHeight: `calc(100vh - ${PANEL_EDGE_PADDING * 2}px)`,
                overflowY: "auto",
            }}
            onMouseDown={stopPickerPointerBubble}
            onPointerDown={stopPickerPointerBubble}
            onWheel={stopPickerPointerBubble}
        >
            <div
                className={`relative h-32 rounded-xl border border-edge overflow-hidden ${
                    readOnly ? "cursor-default" : "cursor-crosshair"
                }`}
                data-color-map
                onPointerDown={readOnly ? undefined : (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
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
                    className="pointer-events-none absolute w-3 h-3 border border-white/90 rounded-full -translate-x-1/2 -translate-y-1/2"
                    style={{
                        left: `${mapThumbPosition.left}%`,
                        top: `${mapThumbPosition.top}%`,
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.9), 0 0 0 3px rgba(0,0,0,0.45)",
                    }}
                />
            </div>

            <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-fg-muted">
                    <span>{t("properties.color.hue")}</span>
                    <span>{Math.round(colorState.hue)}°</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={360}
                    value={colorState.hue}
                    disabled={readOnly}
                    onChange={(event) =>
                        applyColorState(() => ({ hue: Number(event.target.value) }))
                    }
                    className="w-full h-2 rounded-full appearance-none accent-transparent disabled:cursor-not-allowed"
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
                        className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold transition ${
                            activeMode === mode
                                ? "border-primary text-fg"
                                : "border-edge text-fg-muted hover:border-edge-strong"
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
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                        <span>{t("properties.color.opacity")}</span>
                        <span>{Math.round(colorState.alpha * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={colorState.alpha}
                        disabled={readOnly}
                        onChange={handleAlphaChange}
                        className="w-full h-2 rounded-full appearance-none accent-transparent disabled:cursor-not-allowed"
                        style={{ background: opacityGradient }}
                    />
                </div>
            )}

            {/* The project palette, last: the colour above is what the author is building, and these
                are the shortcut to stop building it. Same swatch shape as ProjectPalette's, copied
                rather than shared - that component is the rich-text toolbar's quick palette and has
                its own reasons to change. The hover name is a native `title`: this panel scrolls
                (`overflow-y: auto`), and the shared CSS Tooltip is clipped inside such a container. */}
            {brandColors.length > 0 && (
                <div className="mt-3 border-t border-edge pt-2">
                    <div className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">
                        {t("brand.picker.section")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {brandColors.map((color) => (
                            <button
                                key={color.id}
                                type="button"
                                disabled={readOnly}
                                className={`h-5 w-5 rounded-md border transition-transform disabled:cursor-not-allowed ${
                                    readOnly ? "" : "hover:scale-110"
                                } ${
                                    activeBrandLink === color.id
                                        ? "border-fg ring-2 ring-fg/80 ring-offset-1 ring-offset-surface-raised"
                                        : "border-edge-strong"
                                }`}
                                // Author data, not a theme colour - raw values are what this row is for.
                                style={{ backgroundColor: palette.resolveCss(color.id) ?? "transparent" }}
                                title={brandColorLabel(color)}
                                onClick={() => handleBrandPick(color)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    const isBareSwatch = displayMode === "swatch";
    const triggerContent = (
        <button
            ref={triggerRef}
            type="button"
            onClick={isOpen ? closePicker : openPicker}
            // `readOnly` deliberately does NOT disable this: it has to stay clickable to open the
            // panel, which is the only place the value is legible. `disabled` still does.
            disabled={disabled}
            aria-readonly={readOnly || undefined}
            aria-label={ariaLabel}
            className={
                isBareSwatch
                    // No box, no padding: the caller frames this one itself. It still needs a focus
                    // ring of its own - the frame around it is decoration and does not react to focus.
                    ? "nodrag nowheel block h-5 w-5 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/70"
                    : `
                nodrag nowheel flex items-center rounded-md border border-edge-strong bg-surface-raised px-3 py-2 text-sm
                text-fg transition focus:outline-none focus:ring-2 focus:ring-primary/50
                ${displayMode === "icon" ? "gap-2" : "gap-3"}
            `
            }
            onMouseDown={stopPickerPointerBubble}
            onPointerDown={stopPickerPointerBubble}
        >
            {isBareSwatch ? null : (
                <span
                    className="h-5 w-5 rounded-full border border-edge-strong"
                    style={{ backgroundColor: displayColor }}
                />
            )}
            {displayMode === "icon-hex" && (
                <span className="text-xs text-fg font-mono tracking-wide">
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
                brandPalette={field.brandPalette}
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
                // Opacity does not change which colour this is, so a brand link survives the row's
                // α input for the same reason it survives the picker's opacity slider.
                ...(currentValue.link ? { link: currentValue.link } : {}),
            });
        },
        [currentValue.hex, currentValue.link, setColor]
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
                    brandPalette={field.brandPalette}
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
                    disabled={field.disabled}
                    readOnly={field.readOnly}
                    leftIcon={<span className="text-xs text-fg-muted">α</span>}
                    className="flex-1"
                />
            </div>
        </FieldLayout>
    );
}
