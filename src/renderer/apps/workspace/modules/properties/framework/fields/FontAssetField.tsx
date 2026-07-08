import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { Type } from "lucide-react";
import {
    AssetSelector,
    type AssetSelectorVirtualGroup,
} from "@/apps/workspace/modules/assets/components/AssetSelector";
import {
    EDITOR_BUILTIN_FONT_VIRTUAL_GROUP,
    getBuiltinEditorFontDisplayName,
} from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { FontAssetFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

const FONT_ASSET_SELECTOR_VIRTUAL_GROUPS: AssetSelectorVirtualGroup[] = [EDITOR_BUILTIN_FONT_VIRTUAL_GROUP];

interface FontAssetFieldProps<TData extends UIInspectorData = UIInspectorData> {
    field: FontAssetFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function FontAssetField<TData extends UIInspectorData>({
    field,
    data,
    onSaving,
}: FontAssetFieldProps<TData>) {
    const { context } = useWorkspace();
    const assetsService = useMemo(() => {
        if (!context) {
            return null;
        }
        return context.services.get<AssetsService>(Services.Assets);
    }, [context]);

    const assetId = field.getValue(data);
    const { cssFamily, loading: fontLoading, error: fontError } = useEditorFontFamily(assetId);

    const [selectorOpen, setSelectorOpen] = useState(false);
    const previewRef = useRef<HTMLButtonElement | null>(null);

    const assetName = useMemo(() => {
        if (!assetId) {
            return null;
        }
        const builtinName = getBuiltinEditorFontDisplayName(assetId);
        if (builtinName) {
            return builtinName;
        }
        if (!assetsService) {
            return null;
        }
        return assetsService.getAssets()[AssetType.Font]?.[assetId]?.name ?? null;
    }, [assetId, assetsService]);

    const previewLabel = assetId ? assetName ?? "Font" : "No font";

    const applyAssetId = useCallback(
        (next: string | null) => {
            onSaving(true);
            try {
                field.setValue(data, next);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving],
    );

    const handleConfirm = useCallback(
        (assets: Asset[]) => {
            const selected = assets[0];
            if (!selected) {
                return;
            }
            applyAssetId(selected.id);
            setSelectorOpen(false);
        },
        [applyAssetId],
    );

    const handleClear = useCallback(
        (e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            applyAssetId(null);
        },
        [applyAssetId],
    );

    return (
        <>
            <FieldLayout field={field}>
                <button
                    type="button"
                    ref={previewRef}
                    onClick={() => setSelectorOpen(true)}
                    className="relative mt-1 w-full rounded-xl border border-edge bg-[#13161b] px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-primary/70"
                >
                    <div className="flex items-center gap-2 text-xs text-fg-muted tracking-widest">
                        <Type className="h-3.5 w-3.5 shrink-0" />
                        <span>Preview</span>
                    </div>
                    <div
                        className="mt-2 text-sm text-fg truncate"
                        style={cssFamily ? { fontFamily: cssFamily } : undefined}
                    >
                        {fontLoading ? "Loading…" : "Aa Bb Cc 123"}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                        <span className="truncate">{previewLabel}</span>
                        {assetId ? (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="shrink-0 rounded px-2 py-0.5 text-2xs tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted"
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 text-2xs tracking-[0.3em] text-white transition hover:opacity-100">
                        Choose font
                    </div>
                </button>
            </FieldLayout>

            {assetId && fontError ? (
                <p className="mt-1 text-2xs text-amber-400/90 leading-snug">
                    Font could not be loaded ({fontError}). Preview may fall back until the asset is valid.
                </p>
            ) : null}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Font}
                virtualGroups={FONT_ASSET_SELECTOR_VIRTUAL_GROUPS}
                virtualGroupsPlacement="before"
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleConfirm}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={previewRef}
                title="Select Font"
                multiple={false}
            />
        </>
    );
}
