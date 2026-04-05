import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { Select } from "@/lib/components/elements/Select";
import { Services } from "@/lib/workspace/services/services";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { FieldLayout } from "./FieldLayout";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { ImageFill, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import type { ImageFillFieldDefinition } from "../types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { Asset } from "@/lib/workspace/services/assets/types";

const MODE_OPTIONS: { value: ImageFillMode; label: string }[] = [
    { value: "cover", label: "Cover" },
    { value: "contain", label: "Contain" },
    { value: "stretch", label: "Stretch" },
    { value: "crop", label: "Crop" },
    { value: "tile", label: "Tile" },
];

const PANEL_WIDTH = 360;
const PANEL_SPACING = 12;
const PANEL_MIN_MARGIN = 12;
const DEFAULT_FILL_MODE: ImageFillMode = "cover";

interface PanelPosition {
    top: number;
    left: number;
}

interface ImageFillFieldProps<TData extends UIInspectorData = UIInspectorData> {
    field: ImageFillFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function ImageFillField<TData extends UIInspectorData>({
    field,
    data,
    onSaving,
}: ImageFillFieldProps<TData>) {
    const { context } = useWorkspace();
    const stateService =
        context?.services.get<UIEditorStateService>(Services.UIEditorState) ?? null;
    const selection = stateService?.getSelection();
    const surfaceId = selection?.type === "element" ? selection.data?.surfaceId ?? null : null;
    const element = data.element;
    const layout = element.layout;

    const rawFill = field.getValue(data);
    const allowedModes = field.allowedFillModes;
    const normalizedFill: ImageFill = useMemo(() => {
        const base: ImageFill = {
            mode: rawFill?.mode ?? DEFAULT_FILL_MODE,
            assetId: rawFill?.assetId ?? null,
            cropPlacement: rawFill?.cropPlacement,
        };
        if (allowedModes?.length && !allowedModes.includes(base.mode)) {
            return { ...base, mode: allowedModes[0] };
        }
        return base;
    }, [allowedModes, rawFill]);

    const modeOptionsForUi = useMemo(() => {
        if (!allowedModes?.length) {
            return MODE_OPTIONS;
        }
        return MODE_OPTIONS.filter(option => allowedModes.includes(option.value));
    }, [allowedModes]);

    const { url, metadata, loading } = useAssetObjectUrl(normalizedFill.assetId ?? null);
    const [isOpen, setIsOpen] = useState(false);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const previewRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [panelPosition, setPanelPosition] = useState<PanelPosition>({ top: 0, left: 0 });

    const applyValue = useCallback(
        async (next: ImageFill) => {
            onSaving(true);
            try {
                await field.setValue(data, next);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving],
    );

    const handleModeChange = useCallback(
        (value: string | number | undefined) => {
            if (!value) {
                return;
            }
            const nextMode = value as ImageFillMode;
            void applyValue({
                ...normalizedFill,
                mode: nextMode,
            });
        },
        [applyValue, normalizedFill],
    );

    const computeCropPlacement = useCallback(() => {
        const imageWidth = metadata?.metadata.width ?? 0;
        const imageHeight = metadata?.metadata.height ?? 0;
        const elementWidth = Math.max(1, Math.abs(layout.width));
        const elementHeight = Math.max(1, Math.abs(layout.height));
        if (elementWidth === 0 || elementHeight === 0 || imageWidth === 0 || imageHeight === 0) {
            return null;
        }
        const scale = Math.max(elementWidth / imageWidth, elementHeight / imageHeight);
        const scaledWidth = imageWidth * scale;
        const scaledHeight = imageHeight * scale;
        const widthPct = (scaledWidth / elementWidth) * 100;
        const heightPct = (scaledHeight / elementHeight) * 100;
        const leftPct = (100 - widthPct) / 2;
        const topPct = (100 - heightPct) / 2;
        return {
            leftPct,
            topPct,
            widthPct,
            heightPct,
        };
    }, [layout.height, layout.width, metadata]);

    useEffect(() => {
        if (normalizedFill.mode !== "crop" || !normalizedFill.assetId || normalizedFill.cropPlacement) {
            return;
        }
        const placement = computeCropPlacement();
        if (!placement) {
            return;
        }
        void applyValue({
            ...normalizedFill,
            cropPlacement: placement,
        });
    }, [
        applyValue,
        computeCropPlacement,
        layout.height,
        layout.width,
        metadata,
        normalizedFill.assetId,
        normalizedFill.cropPlacement,
        normalizedFill.mode,
    ]);

    useEffect(() => {
        if (!stateService) {
            return;
        }
        const override = stateService.getInteractionOverride();
        const isElementSelected =
            selection?.type === "element" && selection.data?.elementIds.includes(element.id);
        const cropAllowed = !allowedModes?.length || allowedModes.includes("crop");
        if (isOpen && normalizedFill.mode === "crop" && cropAllowed && surfaceId && isElementSelected) {
            stateService.setInteractionOverride({
                kind: "imageCrop",
                surfaceId,
                elementId: element.id,
                source: "imageFillPopover",
            });
            return;
        }
        if (override?.kind === "imageCrop" && override.source === "imageFillPopover") {
            stateService.setInteractionOverride(null);
        }
    }, [allowedModes, element.id, normalizedFill.mode, isOpen, selection, surfaceId, stateService]);

    useEffect(() => {
        return () => {
            if (!stateService) {
                return;
            }
            const o = stateService.getInteractionOverride();
            if (o?.kind === "imageCrop" && o.source === "imageFillPopover") {
                stateService.setInteractionOverride(null);
            }
        };
    }, [stateService]);

    useEffect(() => {
        if (!isOpen) {
            setSelectorOpen(false);
        }
    }, [isOpen]);

    const handlePanelPosition = useCallback(() => {
        if (!triggerRef.current) {
            return;
        }
        const rect = triggerRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelHeight = panelRef.current?.offsetHeight ?? 360;

        const left = Math.min(
            Math.max(rect.left, PANEL_MIN_MARGIN),
            viewportWidth - PANEL_WIDTH - PANEL_MIN_MARGIN,
        );

        const topBelow = rect.bottom + PANEL_SPACING;
        const topAbove = rect.top - PANEL_SPACING - panelHeight;
        let top = topBelow;

        if (top + panelHeight > viewportHeight - PANEL_MIN_MARGIN && topAbove >= PANEL_MIN_MARGIN) {
            top = topAbove;
        } else {
            top = Math.min(
                Math.max(top, PANEL_MIN_MARGIN),
                viewportHeight - panelHeight - PANEL_MIN_MARGIN,
            );
        }

        setPanelPosition({ top, left });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) {
            return;
        }
        handlePanelPosition();
        const reposition = () => handlePanelPosition();
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, { passive: true });
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition);
        };
    }, [handlePanelPosition, isOpen]);

    const panelModeLabel = useMemo(
        () =>
            modeOptionsForUi.find(option => option.value === normalizedFill.mode)?.label ??
            normalizedFill.mode,
        [modeOptionsForUi, normalizedFill.mode],
    );
    const panelTitle = field.label?.trim() ? field.label : "Image Fill";
    const previewLabel = normalizedFill.assetId ? "Image selected" : "No image";

    const togglePanel = useCallback(() => {
        setIsOpen(true);
    }, []);

    const handleSelectImage = useCallback(
        (assets: Asset[]) => {
            const selected = assets[0];
            if (!selected) {
                return;
            }
            void applyValue({
                ...normalizedFill,
                assetId: selected.id,
            });
            setSelectorOpen(false);
        },
        [applyValue, normalizedFill],
    );

    const panelContent =
        typeof document !== "undefined" && isOpen
            ? createPortal(
                  <div
                      ref={panelRef}
                      className="fixed z-50 rounded-2xl border border-white/20 bg-[#0b0d12] shadow-2xl p-4 text-gray-200"
                      style={{
                          top: panelPosition.top,
                          left: panelPosition.left,
                          width: PANEL_WIDTH,
                      }}
                  >
                      <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold">{panelTitle}</span>
                          <button
                              type="button"
                              onClick={() => setIsOpen(false)}
                              className="p-1 rounded-full hover:bg-white/10"
                              aria-label="Close image fill editor"
                          >
                              <X className="w-4 h-4" />
                          </button>
                      </div>

                      <div className="space-y-3">
                          <div>
                              <span className="text-xs text-gray-400 uppercase tracking-widest">Mode</span>
                              <Select
                                  options={modeOptionsForUi.map(option => ({ value: option.value, label: option.label }))}
                                  value={normalizedFill.mode}
                                  onChange={handleModeChange}
                                  fullWidth
                                  size="md"
                                  className="mt-1"
                                  placeholder="Select mode"
                              />
                          </div>

                          <div>
                              <span className="text-xs text-gray-400 uppercase tracking-widest">Preview</span>
                              <button
                                  ref={previewRef}
                                  type="button"
                                  onClick={() => setSelectorOpen(true)}
                                  className="relative mt-2 w-full aspect-[4/3] rounded-xl border border-white/10 bg-[#13161b] overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/70"
                              >
                                  {url ? (
                                      <img
                                          src={url}
                                          alt="Fill preview"
                                          className="absolute inset-0 h-full w-full object-cover"
                                          draggable={false}
                                      />
                                  ) : (
                                      <div className="flex h-full w-full flex-col items-center justify-center text-xs text-gray-500">
                                          <span className="font-semibold">Select an image</span>
                                          <span>Asset browser opens on click</span>
                                      </div>
                                  )}
                                  {loading && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs text-gray-100">
                                          Loading…
                                      </div>
                                  )}
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 text-[10px] uppercase tracking-[0.3em] text-white transition hover:opacity-100">
                                      Change image
                                  </div>
                              </button>
                              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                                  <span>{previewLabel}</span>
                                  <span>{panelModeLabel}</span>
                              </div>
                          </div>
                      </div>
                  </div>,
                  document.body,
              )
            : null;

    const previewFallback = (
        <div className="flex h-28 w-full items-center justify-center rounded-lg border border-white/10 bg-[#0f1115] text-xs text-gray-500">
            {previewLabel}
        </div>
    );

    return (
        <>
            <FieldLayout field={field}>
                <button
                    type="button"
                    ref={triggerRef}
                    onClick={togglePanel}
                    className="w-full text-left"
                >
                    <div className="rounded-xl border border-white/10 bg-[#0f1115] p-3 space-y-2">
                        {url ? (
                            <img
                                src={url}
                                alt="Fill preview"
                                className="h-28 w-full rounded-lg object-cover"
                                draggable={false}
                            />
                        ) : (
                            previewFallback
                        )}
                        <div className="flex items-center justify-between text-xs text-gray-400">
                            <span>{previewLabel}</span>
                            <span className="uppercase tracking-[0.2em]">{panelModeLabel}</span>
                        </div>
                        <div className="text-[10px] text-gray-500">Click to open editor</div>
                    </div>
                </button>
            </FieldLayout>

            {panelContent}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelectImage}
                selectedIds={normalizedFill.assetId ? [normalizedFill.assetId] : []}
                anchorRef={previewRef}
                title="Select Fill Image"
                multiple={false}
            />
        </>
    );
}
