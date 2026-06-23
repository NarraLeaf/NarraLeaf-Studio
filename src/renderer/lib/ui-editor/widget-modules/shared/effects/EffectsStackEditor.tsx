import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
    EffectFilterStored,
    EffectShadowStored,
    ElementEffectValues,
    VisualEffectKind,
} from "@shared/types/ui-editor/effects";
import type { ShadowSlotKind } from "@shared/types/ui-editor/effects";
import { effectShadowStoredToCss, normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { parseShadowLikeFragment } from "@shared/types/ui-editor/shadowLayerCodec";
import {
    FILTER_PRESET_NEUTRAL,
    FILTER_PRESET_OPTIONS,
    parseSimpleFilter,
    serializeSimpleFilter,
    type FilterPresetId,
} from "@shared/types/ui-editor/effectFilterCodec";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Button } from "@/lib/components/elements/Button";
import { Select } from "@/lib/components/elements/Select";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { parseColorValue, colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import {
    clearEffectKindPatch,
    enableEffectKindPatch,
    EFFECT_KIND_LABEL,
    listEnabledKindsInOrder,
    listRemainingKinds,
    summarizeEffectKind,
} from "./effectAuthoringRegistry";
import { BLEND_MODE_SELECT_OPTIONS } from "./effectBlendOptions";

const PANEL_WIDTH = 280;
const PANEL_GAP = 8;
const PANEL_MARGIN = 8;
/** Above the effects detail panel (`z-[80]`) so narrow numeric input portals remain visible. */
const EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX = 90;
const COLOR_PICKER_PANEL_SELECTOR = "[data-color-picker-panel]";

function mergeEffects(prev: ElementEffectValues, patch: Partial<ElementEffectValues>): ElementEffectValues {
    return normalizeElementEffectValues({ ...prev, ...patch });
}

function ShadowStoredFields({
    value,
    onChange,
    slot,
    draftResetKey,
}: {
    value: EffectShadowStored;
    onChange: (next: EffectShadowStored) => void;
    slot: ShadowSlotKind;
    draftResetKey: string;
}) {
    if (value.storage === "css") {
        return (
            <div className="space-y-2">
                <textarea
                    className="w-full min-h-[4rem] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20"
                    rows={4}
                    value={value.css}
                    onChange={e => onChange({ storage: "css", css: e.target.value })}
                />
                <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => {
                        const p = parseShadowLikeFragment(value.css.trim());
                        if (!p.ok) {
                            return;
                        }
                        const { offsetX, offsetY, blur, spread, color } = p.value;
                        onChange({
                            storage: "layer",
                            layer: { offsetX, offsetY, blur, spread: spread ?? 0, color },
                        });
                    }}
                >
                    Structured
                </button>
            </div>
        );
    }
    const L = value.layer;
    const commitLayer = (layer: typeof L) => onChange({ storage: "layer", layer });
    const colorCv = parseColorValue(L.color, { hex: "#000000", alpha: 0.35 });

    return (
        <div className="grid grid-cols-2 gap-2 min-w-0">
            <div className="min-w-0">
                <span className="text-[10px] font-medium text-gray-500 block mb-0.5">X</span>
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(L.offsetX)}
                    draftResetKey={`${draftResetKey}-ox`}
                    onFiniteNumber={n => commitLayer({ ...L, offsetX: n })}
                    inputMode="decimal"
                    unit="px"
                    className="w-full min-w-0"
                />
            </div>
            <div className="min-w-0">
                <span className="text-[10px] font-medium text-gray-500 block mb-0.5">Y</span>
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(L.offsetY)}
                    draftResetKey={`${draftResetKey}-oy`}
                    onFiniteNumber={n => commitLayer({ ...L, offsetY: n })}
                    inputMode="decimal"
                    unit="px"
                    className="w-full min-w-0"
                />
            </div>
            <div className="min-w-0">
                <span className="text-[10px] font-medium text-gray-500 block mb-0.5">Blur</span>
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(Math.max(0, L.blur))}
                    draftResetKey={`${draftResetKey}-bl`}
                    onFiniteNumber={n => commitLayer({ ...L, blur: Math.max(0, n) })}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="px"
                    className="w-full min-w-0"
                />
            </div>
            <div className="min-w-0">
                <span className="text-[10px] font-medium text-gray-500 block mb-0.5">Spread</span>
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(L.spread)}
                    draftResetKey={`${draftResetKey}-sp`}
                    onFiniteNumber={n => commitLayer({ ...L, spread: n })}
                    inputMode="decimal"
                    unit="px"
                    className="w-full min-w-0"
                />
            </div>
            <div className="col-span-2 flex items-center gap-2 min-w-0">
                <ColorPickerTrigger
                    value={colorCv}
                    displayMode="icon"
                    allowOpacity
                    onChange={cv => commitLayer({ ...L, color: colorValueToCss(cv) })}
                />
                <span className="text-[10px] text-gray-500 truncate">Color</span>
            </div>
            <div className="col-span-2">
                <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={() =>
                        onChange({
                            storage: "css",
                            css: effectShadowStoredToCss({ storage: "layer", layer: L }, slot),
                        })
                    }
                >
                    Custom CSS
                </button>
            </div>
        </div>
    );
}

function FilterStoredFields({
    value,
    onChange,
    draftResetKey,
}: {
    value: EffectFilterStored;
    onChange: (next: EffectFilterStored) => void;
    draftResetKey: string;
}) {
    if (value.storage === "css") {
        return (
            <div className="space-y-2">
                <textarea
                    className="w-full min-h-[4rem] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20"
                    rows={4}
                    value={value.css}
                    onChange={e => onChange({ storage: "css", css: e.target.value })}
                />
                <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => {
                        const p = parseSimpleFilter(value.css.trim());
                        if (p.kind === "preset") {
                            onChange({ storage: "preset", preset: p.preset, amount: p.amount });
                        } else {
                            onChange({ storage: "preset", preset: "brightness", amount: 1 });
                        }
                    }}
                >
                    Preset mode
                </button>
            </div>
        );
    }
    return (
        <div className="space-y-2 min-w-0">
            <Select
                value={value.preset}
                options={[...FILTER_PRESET_OPTIONS]}
                fullWidth
                size="md"
                portalMenu
                menuPlacement="auto"
                onChange={v => {
                    const nextPreset = String(v) as FilterPresetId;
                    const neutral = FILTER_PRESET_NEUTRAL[nextPreset];
                    onChange({
                        storage: "preset",
                        preset: nextPreset,
                        amount: Number.isFinite(value.amount) ? value.amount : neutral,
                    });
                }}
            />
            <NumericDraftEnhancedInput
                popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                committedDisplay={String(value.amount)}
                draftResetKey={`${draftResetKey}-flt-amt`}
                onFiniteNumber={n =>
                    onChange({
                        storage: "preset",
                        preset: value.preset,
                        amount: n,
                    })
                }
                inputMode="decimal"
                className="w-full min-w-0"
            />
            <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() =>
                    onChange({
                        storage: "css",
                        css: serializeSimpleFilter(value.preset, value.amount),
                    })
                }
            >
                Custom CSS
            </button>
        </div>
    );
}

function EffectDetailBody({
    kind,
    values,
    onChange,
    draftResetKey,
}: {
    kind: VisualEffectKind;
    values: ElementEffectValues;
    onChange: (next: ElementEffectValues) => void;
    draftResetKey: string;
}) {
    const patch = useCallback(
        (partial: Partial<ElementEffectValues>) => onChange(mergeEffects(values, partial)),
        [values, onChange]
    );

    switch (kind) {
        case "blur":
            return (
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(Math.max(0, values.effectBlur))}
                    draftResetKey={`${draftResetKey}-pop-blur`}
                    onFiniteNumber={v => patch({ effectBlur: Math.max(0, v) })}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="px"
                    leftIcon={<Sparkles className="w-4 h-4 text-gray-400" />}
                    className="w-full min-w-0"
                />
            );
        case "backgroundBlur":
            return (
                <NumericDraftEnhancedInput
                    popoverZIndex={EFFECTS_DETAIL_NUMERIC_POPOVER_Z_INDEX}
                    committedDisplay={String(Math.max(0, values.effectBackgroundBlur))}
                    draftResetKey={`${draftResetKey}-pop-bblur`}
                    onFiniteNumber={v => patch({ effectBackgroundBlur: Math.max(0, v) })}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    unit="px"
                    className="w-full min-w-0"
                />
            );
        case "shadow":
            return values.effectShadow ? (
                <ShadowStoredFields
                    value={values.effectShadow}
                    onChange={next => patch({ effectShadow: next })}
                    slot="outer"
                    draftResetKey={`${draftResetKey}-sh`}
                />
            ) : null;
        case "textShadow":
            return values.effectTextShadow ? (
                <ShadowStoredFields
                    value={values.effectTextShadow}
                    onChange={next => patch({ effectTextShadow: next })}
                    slot="outer"
                    draftResetKey={`${draftResetKey}-tsh`}
                />
            ) : null;
        case "innerShadow":
            return values.effectInnerShadow ? (
                <ShadowStoredFields
                    value={values.effectInnerShadow}
                    onChange={next => patch({ effectInnerShadow: next })}
                    slot="inner"
                    draftResetKey={`${draftResetKey}-ish`}
                />
            ) : null;
        case "glow":
            return values.effectGlow ? (
                <ShadowStoredFields
                    value={values.effectGlow}
                    onChange={next => patch({ effectGlow: next })}
                    slot="glow"
                    draftResetKey={`${draftResetKey}-gl`}
                />
            ) : null;
        case "blend":
            return (
                <Select
                    value={values.effectBlend}
                    options={[...BLEND_MODE_SELECT_OPTIONS]}
                    fullWidth
                    size="md"
                    portalMenu
                    menuPlacement="auto"
                    onChange={v => patch({ effectBlend: String(v) })}
                />
            );
        case "filter":
            return values.effectFilter ? (
                <FilterStoredFields
                    value={values.effectFilter}
                    onChange={next => patch({ effectFilter: next })}
                    draftResetKey={`${draftResetKey}-flt`}
                />
            ) : null;
        default:
            return null;
    }
}

function EffectsAnchoredPanel({
    open,
    anchorEl,
    onClose,
    children,
}: {
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    children: ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: 0, top: 0 });

    const reposition = useCallback(() => {
        if (!anchorEl) {
            return;
        }
        const rect = anchorEl.getBoundingClientRect();
        const ph = panelRef.current?.offsetHeight ?? 320;
        let left = rect.right - PANEL_WIDTH;
        let top = rect.bottom + PANEL_GAP;
        if (left < PANEL_MARGIN) {
            left = PANEL_MARGIN;
        }
        if (left + PANEL_WIDTH > window.innerWidth - PANEL_MARGIN) {
            left = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
        }
        if (top + ph > window.innerHeight - PANEL_MARGIN) {
            top = rect.top - ph - PANEL_GAP;
        }
        if (top < PANEL_MARGIN) {
            top = PANEL_MARGIN;
        }
        setPos({ left, top });
    }, [anchorEl]);

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }
        reposition();
        const raf = requestAnimationFrame(() => requestAnimationFrame(reposition));
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        let ro: ResizeObserver | undefined;
        if (panelRef.current && typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(() => reposition());
            ro.observe(panelRef.current);
        }
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
            ro?.disconnect();
        };
    }, [open, reposition, children]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            const targetElement = target instanceof Element ? target : target.parentElement;
            if (
                anchorEl?.contains(target) ||
                panelRef.current?.contains(target) ||
                Boolean(targetElement?.closest(COLOR_PICKER_PANEL_SELECTOR))
            ) {
                return;
            }
            onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handlePointerDown, true);
        }, 0);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, anchorEl, onClose]);

    if (!open || !anchorEl || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[80] flex max-h-[min(70vh,calc(100vh-24px))] w-[280px] max-w-[calc(100vw-16px)] flex-col overflow-visible rounded-xl border border-white/10 bg-[#17181c] p-3 shadow-2xl"
            style={{
                left: pos.left,
                top: pos.top,
            }}
            onMouseDown={e => e.stopPropagation()}
        >
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-visible space-y-2">{children}</div>
        </div>,
        document.body
    );
}

const ROW_BTN =
    "grid h-7 w-7 shrink-0 place-items-center rounded border border-white/10 bg-black/25 text-gray-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:pointer-events-none";

export type EffectsStackEditorProps = {
    values: ElementEffectValues;
    onChange: (next: ElementEffectValues) => void;
    supportedKinds: readonly VisualEffectKind[];
    draftResetKey: string;
    renderTrailingOnRow?: (kind: VisualEffectKind) => ReactNode;
};

export function EffectsStackEditor({
    values,
    onChange,
    supportedKinds,
    draftResetKey,
    renderTrailingOnRow,
}: EffectsStackEditorProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [openKind, setOpenKind] = useState<VisualEffectKind | null>(null);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [pendingAdd, setPendingAdd] = useState<VisualEffectKind | null>(null);

    const closePanel = useCallback(() => {
        setOpenKind(null);
        setAnchorEl(null);
    }, []);

    const enabled = listEnabledKindsInOrder(values, supportedKinds);
    const remaining = listRemainingKinds(values, supportedKinds);
    const addOptions = remaining.map(k => ({ value: k, label: EFFECT_KIND_LABEL[k] }));

    const addSelected = useCallback(() => {
        if (!pendingAdd) {
            return;
        }
        onChange(mergeEffects(values, enableEffectKindPatch(pendingAdd)));
        setPendingAdd(null);
    }, [pendingAdd, onChange, values]);

    const removeKind = useCallback(
        (kind: VisualEffectKind) => {
            closePanel();
            onChange(mergeEffects(values, clearEffectKindPatch(kind)));
        },
        [closePanel, onChange, values]
    );

    return (
        <div ref={rootRef} className="flex flex-col gap-2 min-w-0">
            <div className="flex gap-1.5 items-stretch min-w-0">
                <div className="flex-1 min-w-0">
                    <Select
                        placeholder="Add effect"
                        value={pendingAdd ?? undefined}
                        options={addOptions}
                        fullWidth
                        size="md"
                        portalMenu
                        menuPlacement="auto"
                        disabled={addOptions.length === 0}
                        onChange={v => setPendingAdd(v as VisualEffectKind)}
                    />
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    className="shrink-0 self-stretch px-3"
                    aria-label="Add effect"
                    disabled={!pendingAdd || addOptions.length === 0}
                    onClick={addSelected}
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>

            {enabled.map(kind => (
                <div key={kind} className="flex flex-col gap-0 min-w-0 rounded-md border border-white/10 bg-black/15 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] font-medium text-gray-400 shrink-0 w-[4.5rem]">
                            {EFFECT_KIND_LABEL[kind]}
                        </span>
                        <span className="text-[10px] text-gray-500 truncate flex-1 min-w-0 font-mono">
                            {summarizeEffectKind(kind, values)}
                        </span>
                        <button
                            type="button"
                            className={ROW_BTN}
                            aria-label="Edit effect"
                            onClick={e => {
                                const next = openKind === kind ? null : kind;
                                setOpenKind(next);
                                setAnchorEl(next ? e.currentTarget : null);
                            }}
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                        </button>
                        {renderTrailingOnRow?.(kind)}
                        <button
                            type="button"
                            className={ROW_BTN}
                            aria-label="Remove effect"
                            onClick={() => removeKind(kind)}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ))}

            <EffectsAnchoredPanel open={openKind != null} anchorEl={anchorEl} onClose={closePanel}>
                {openKind ? (
                    <EffectDetailBody
                        kind={openKind}
                        values={values}
                        onChange={onChange}
                        draftResetKey={`${draftResetKey}-${openKind}`}
                    />
                ) : null}
            </EffectsAnchoredPanel>
        </div>
    );
}
